import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { catalogueProducts, staffMemberships, workbookImportPlanRows } from "@/db/schema";
import { ingestProductImageFromRemoteUrl } from "@/lib/media/product-images";
import { withTenantContext, type DbTransaction } from "@/lib/tenant/context";
import { SUPPORTED_ENTITY_SHEETS, type SupportedEntitySheet, WORKBOOK_CONTRACT } from "@/lib/workbook/contract";
import { recordApplyRowAuditInTx } from "@/lib/workbook/apply/audit";
import { assertCapabilities, splitDeferred } from "@/lib/workbook/apply/capability";
import { ApplyUnitError, describeApplyFailure } from "@/lib/workbook/apply/errors";
import { HANDLERS } from "@/lib/workbook/apply/handlers";
import { rowRef } from "@/lib/workbook/apply/handlers/shared";
import type { ApplyRuntime, ImageIngester, SavedRow, Unit, UnitGuard } from "@/lib/workbook/apply/handlers/types";
import { LINK_ENTITY_OF_SHEET, writeTypedLinkInTx } from "@/lib/workbook/apply/links";
import type { AppliedLink, ApplyCounts, ApplyFailure, ApplyImageOutcome, ApplySummary, RowApplyResult } from "@/lib/workbook/apply/model";
import { heartbeat, lockPlanRows, writeRowImage, writeRowOutcome } from "@/lib/workbook/apply/repository";
import { loadScopeTokens, recordIdentity, type TokenScope, tokenKey } from "@/lib/workbook/apply/revisions";
import type { PlanRowRecord } from "@/lib/workbook/validation/plan-repository";
import type { ReviewSnapshot } from "@/lib/workbook/validation/snapshot";

/* The workbook apply engine (QOS-217, plan sections 1.2–1.3). A reviewed
   plan is applied in contract sheet order, one unit per database
   transaction: the catalogue service call(s), the typed source link, the
   audit event and the checkpoint commit together or not at all. A failed
   unit is rolled back whole and recorded in its own short transaction; the
   attempt goes on with the next unit, and rows that depend on the failed
   one fail `dependency_unresolved`. Nothing here publishes, approves a
   translation or posts stock. */

const SHEET_ORDER = new Map(WORKBOOK_CONTRACT.sheets.map((sheet, index) => [sheet.name, index]));
const SUPPORTED = new Set<string>(SUPPORTED_ENTITY_SHEETS);
const SAVED_STATES = new Set(["applied", "already_applied"]);

/** A row the engine applies: a supported sheet, Create or Update, with an operation. */
export function isApplicable(row: Pick<PlanRowRecord, "sheet" | "classification" | "operation">) {
  return SUPPORTED.has(row.sheet) && (row.classification === "create" || row.classification === "update") && row.operation !== null;
}

export function isSaved(row: Pick<PlanRowRecord, "applyState">) {
  return row.applyState !== null && SAVED_STATES.has(row.applyState);
}

function graphOrder(a: PlanRowRecord, b: PlanRowRecord) {
  return (SHEET_ORDER.get(a.sheet) ?? 999) - (SHEET_ORDER.get(b.sheet) ?? 999) || a.rowNumber - b.rowNumber;
}

const RECIPE_CHILDREN = new Set(["Recipe Lines", "Prep Steps", "Modifier Effects"]);

function versionKeyOf(row: PlanRowRecord) {
  return (row.after?.recipe_version_key ?? row.before?.recipe_version_key ?? "").trim();
}

/**
 * Units in graph order (contract sheet order, then row number). A product
 * create carries its default Variants row (QOS creates a product with its
 * default price); a menu create carries the Menu Branches rows created with
 * it (a menu needs a location). Everything else is one row per unit.
 */
export function planUnits(rows: PlanRowRecord[]): Unit[] {
  const applicable = rows.filter(isApplicable).sort(graphOrder);
  const grouped = new Set<string>();
  const units: Unit[] = [];
  for (const row of applicable) {
    if (grouped.has(row.id)) continue;
    const unit: Unit = { sheet: row.sheet as SupportedEntitySheet, rows: [row] };
    if (row.sheet === "Products" && row.operation === "create") {
      const variant = applicable.find(
        (candidate) =>
          candidate.sheet === "Variants" &&
          candidate.operation === "create" &&
          !grouped.has(candidate.id) &&
          candidate.after?.is_default === "TRUE" &&
          candidate.after?.product_key === row.entityKey,
      );
      if (variant) {
        unit.rows.push(variant);
        grouped.add(variant.id);
      }
    }
    if (RECIPE_CHILDREN.has(row.sheet)) {
      // One whole-list service call per recipe version: every line (step, effect) row of that version is one unit.
      const version = versionKeyOf(row);
      for (const candidate of applicable) {
        if (candidate === row || candidate.sheet !== row.sheet || grouped.has(candidate.id) || versionKeyOf(candidate) !== version) continue;
        unit.rows.push(candidate);
        grouped.add(candidate.id);
      }
    }
    if (row.sheet === "Menus" && row.operation === "create") {
      for (const branch of applicable.filter(
        (candidate) => candidate.sheet === "Menu Branches" && candidate.operation === "create" && candidate.after?.menu_key === row.entityKey,
      )) {
        unit.rows.push(branch);
        grouped.add(branch.id);
      }
    }
    units.push(unit);
  }
  return units;
}

/** Revision tokens of every snapshot record, as the plan was checked against them. */
export function baselineTokens(snapshot: ReviewSnapshot) {
  const tokens = new Map<string, string>();
  for (const sheet of SUPPORTED_ENTITY_SHEETS) {
    for (const row of snapshot.records[sheet].values()) {
      tokens.set(tokenKey(sheet, recordIdentity(sheet, row)), row.expected_revision ?? "");
    }
  }
  return tokens;
}

export function rowsByKey(rows: PlanRowRecord[]) {
  const index = new Map<string, Map<string, PlanRowRecord>>();
  for (const row of rows) {
    if (!row.entityKey) continue;
    const bySheet = index.get(row.sheet) ?? new Map<string, PlanRowRecord>();
    if (!bySheet.has(row.entityKey)) bySheet.set(row.entityKey, row);
    index.set(row.sheet, bySheet);
  }
  return index;
}

/* ------------------------------------------------------------------ */
/* Revision guard                                                      */
/* ------------------------------------------------------------------ */

/**
 * Checks each target's current revision against the plan immediately before
 * the mutation. A token this attempt's own earlier unit left behind counts as
 * the plan's (menu saves and default flags touch siblings); a change by
 * anyone else is a `stale_revision`. After the mutation the scope's new
 * tokens are remembered, but only for records nobody else changed.
 */
function createGuard(tx: DbTransaction, run: ApplyRuntime) {
  const before = new Map<string, string>();
  const scopes: TokenScope[] = [];
  const guard: UnitGuard = {
    async enter(scope, targets) {
      const tokens = await loadScopeTokens(tx, run.tenantId, scope);
      for (const [key, token] of tokens) before.set(key, token);
      scopes.push(scope);
      for (const target of targets) {
        const identity = target.before ? recordIdentity(target.sheet, target.before) : (target.targetPublicId ?? "");
        const key = tokenKey(target.sheet, identity);
        const current = tokens.get(key);
        if (current === undefined) {
          throw new ApplyUnitError("target_not_found", "The record this row changes no longer exists.");
        }
        const expected = run.selfWritten.get(key) ?? target.targetRevision;
        if (current !== expected) {
          throw new ApplyUnitError("stale_revision", "The record changed after the review. Revalidate and retry.");
        }
      }
    },
  };
  async function settle() {
    const pending = new Map<string, string>();
    for (const scope of scopes) {
      for (const [key, token] of await loadScopeTokens(tx, run.tenantId, scope)) {
        const prior = before.get(key);
        if (prior === undefined || prior === (run.selfWritten.get(key) ?? run.baseline.get(key))) pending.set(key, token);
      }
    }
    return pending;
  }
  return { guard, settle };
}

/* ------------------------------------------------------------------ */
/* Units                                                               */
/* ------------------------------------------------------------------ */

async function recheckActor(tx: DbTransaction, run: ApplyRuntime) {
  const [membership] = await tx
    .select({ role: staffMemberships.role, status: staffMemberships.status })
    .from(staffMemberships)
    .where(and(eq(staffMemberships.tenantId, run.tenantId), eq(staffMemberships.id, run.membership.membershipId)))
    .limit(1);
  if (!membership || membership.status !== "active" || membership.role !== run.membership.role) {
    throw new ApplyUnitError("forbidden", "Your membership changed during the apply.");
  }
}

function deferredOf(row: PlanRowRecord) {
  return row.deferredFields.map((field) => ({ column: field.column, owner: field.owner }));
}

type UnitResult =
  | { status: "applied"; saved: SavedRow[]; links: Map<string, AppliedLink[]> }
  | { status: "already_applied" }
  | { status: "failed"; failure: ApplyFailure };

async function runUnit(run: ApplyRuntime, unit: Unit, counts: ApplyCounts): Promise<UnitResult> {
  try {
    const committed = await withTenantContext(run.db, run.tenantId, async (tx) => {
      const locked = await lockPlanRows(
        tx,
        run.tenantId,
        unit.rows.map((row) => row.id),
      );
      if (locked.some(isSaved)) return { status: "already_applied" as const };
      await recheckActor(tx, run);
      for (const row of unit.rows) assertCapabilities(row);

      const { guard, settle } = createGuard(tx, run);
      const saved = await HANDLERS[unit.sheet]({ tx, db: tx as unknown as DbClient, run, guard }, unit);
      const pending = await settle();

      const links = new Map<string, AppliedLink[]>();
      for (const entry of saved) {
        const { extended } = splitDeferred(entry.row.sheet, entry.row.deferredFields);
        for (const { field, extension } of extended) {
          await extension.apply({ tx, tenantId: run.tenantId, sheet: entry.row.sheet, column: field.column, value: field.value, targetPublicId: entry.publicId, actorSubject: run.actor.subject });
        }
        // Creates and updates both get a link so a later import of the same
        // workbook key resolves to this record instead of a name-only conflict.
        const link = await writeTypedLinkInTx(tx, {
          tenantId: run.tenantId,
          namespace: run.namespace,
          sheet: entry.row.sheet,
          sourceKey: entry.row.entityKey,
          targetPublicId: entry.publicId,
          planId: run.plan.id,
          applyId: run.apply.id,
          subject: run.actor.subject,
        });
        if (link) links.set(entry.row.id, [link]);
        for (const extra of entry.extraLinks ?? []) {
          const written = await writeTypedLinkInTx(tx, {
            tenantId: run.tenantId,
            namespace: run.namespace,
            sheet: entry.row.sheet,
            entityType: extra.entityType,
            sourceKey: extra.sourceKey,
            targetPublicId: extra.targetPublicId,
            planId: run.plan.id,
            applyId: run.apply.id,
            subject: run.actor.subject,
          });
          if (written) links.set(entry.row.id, [...(links.get(entry.row.id) ?? []), written]);
        }
      }

      await run.hooks.beforeCheckpoint?.({ sheet: unit.sheet, rows: unit.rows.map((row) => row.rowNumber) });

      for (const entry of saved) {
        const { extended, kept } = splitDeferred(entry.row.sheet, entry.row.deferredFields);
        await recordApplyRowAuditInTx(tx, {
          tenantId: run.tenantId,
          actor: run.actor,
          planPublicId: run.plan.publicId,
          applyPublicId: run.apply.publicId,
          sheet: entry.row.sheet,
          row: entry.row.rowNumber,
          key: entry.row.entityKey,
          operation: entry.row.operation ?? "",
          entityPublicId: entry.publicId,
          columns: [...entry.fieldsApplied, ...extended.map(({ field }) => field.column)],
          deferred: kept.map((field) => field.column),
        });
        const result: RowApplyResult = {
          operation: entry.row.operation,
          fieldsApplied: [...entry.fieldsApplied, ...extended.map(({ field }) => field.column)],
          deferred: kept.map((field) => ({ column: field.column, owner: field.owner })),
          ...(links.get(entry.row.id) ? { links: links.get(entry.row.id) } : {}),
          ...(entry.imageUrl ? { image: { status: "skipped" as const, reason: "pending" } } : {}),
          ...(entry.parentPublicId ? { parentPublicId: entry.parentPublicId } : {}),
          ...(entry.versionPublicId ? { versionPublicId: entry.versionPublicId } : {}),
          ...(entry.records && entry.records.length > 0 ? { records: entry.records } : {}),
        };
        await writeRowOutcome(tx, run.tenantId, entry.row.id, { state: "applied", applyId: run.apply.id, appliedPublicId: entry.publicId, applied: true, result });
      }
      await heartbeat(tx, run.tenantId, run.apply.id, { ...counts, applied: counts.applied + saved.length });
      return { status: "applied" as const, saved, links, pending };
    });
    if (committed.status === "applied") {
      for (const [key, token] of committed.pending) run.selfWritten.set(key, token);
      for (const entry of committed.saved) run.saved.set(entry.row.id, entry.publicId);
      return { status: "applied", saved: committed.saved, links: committed.links };
    }
    return committed;
  } catch (error) {
    const failure = describeApplyFailure(error);
    if (failure.code === "unexpected") {
      console.error("Workbook apply unit failed", { plan: run.plan.publicId, sheet: unit.sheet, rows: unit.rows.map((row) => row.rowNumber) }, error);
    }
    return { status: "failed", failure };
  }
}

async function recordFailure(run: ApplyRuntime, unit: Unit, failure: ApplyFailure, counts: ApplyCounts) {
  await withTenantContext(run.db, run.tenantId, async (tx) => {
    const [primary, ...grouped] = unit.rows;
    for (const row of [primary!, ...grouped]) {
      const error = row === primary ? failure : { ...failure, responsible: rowRef(primary!) };
      await writeRowOutcome(tx, run.tenantId, row.id, {
        state: "failed",
        applyId: run.apply.id,
        error,
        result: { operation: row.operation, fieldsApplied: [], deferred: deferredOf(row) },
      });
    }
    await heartbeat(tx, run.tenantId, run.apply.id, counts);
  });
}

/**
 * An unchanged row the operator matched to an existing record (Match
 * existing) changes no record, but its workbook key is linked to that record
 * so the next upload resolves it without asking again (QOS-200 follow-up).
 * The membership is rechecked first; each link is written in its own
 * savepoint, and a key or record already linked elsewhere is simply left
 * unlinked: this never fails the attempt.
 */
async function rememberMatches(tx: DbTransaction, run: ApplyRuntime, idle: PlanRowRecord[]) {
  const remembered = new Map<string, AppliedLink>();
  const matched = idle.filter(
    (row) =>
      row.classification === "unchanged" &&
      row.decision?.kind === "match_existing" &&
      row.targetPublicId &&
      row.entityKey &&
      row.entityKey !== row.targetPublicId &&
      LINK_ENTITY_OF_SHEET[row.sheet],
  );
  if (matched.length === 0) return remembered;
  try {
    await recheckActor(tx, run);
  } catch {
    return remembered;
  }
  for (const row of matched) {
    try {
      const link = await tx.transaction((savepoint) =>
        writeTypedLinkInTx(savepoint as unknown as DbTransaction, {
          tenantId: run.tenantId,
          namespace: run.namespace,
          sheet: row.sheet,
          sourceKey: row.entityKey,
          targetPublicId: row.targetPublicId!,
          planId: run.plan.id,
          applyId: run.apply.id,
          subject: run.actor.subject,
        }),
      );
      if (link) remembered.set(row.id, link);
    } catch {
      // Linked elsewhere: the row stays unlinked and the next upload asks again.
    }
  }
  return remembered;
}

/* ------------------------------------------------------------------ */
/* Images                                                              */
/* ------------------------------------------------------------------ */

/** The flat importer's image path: an approved image is kept, otherwise the URL is fetched and attached. */
export const defaultImageIngester: ImageIngester = async ({ db, tenantId, membership, productPublicId, url, subject }) => {
  const [product] = await withTenantContext(db, tenantId, (tx) =>
    tx
      .select({ primaryMediaAssetId: catalogueProducts.primaryMediaAssetId })
      .from(catalogueProducts)
      .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.publicId, productPublicId)))
      .limit(1),
  );
  if (product?.primaryMediaAssetId) return "already_present";
  await ingestProductImageFromRemoteUrl(db, tenantId, membership, productPublicId, url, subject);
  return "uploaded";
};

/** Images never run inside a unit: the record is saved first and an image failure never fails the row (D-IMAGE). */
async function ingestImages(run: ApplyRuntime, saved: SavedRow[]) {
  for (const entry of saved) {
    if (!entry.imageUrl) continue;
    let image: ApplyImageOutcome;
    try {
      const status = await (run.hooks.ingestImage ?? defaultImageIngester)({
        db: run.db,
        tenantId: run.tenantId,
        membership: run.membership,
        productPublicId: entry.publicId,
        url: entry.imageUrl,
        subject: run.actor.subject,
      });
      image = { status };
    } catch (error) {
      image = { status: "failed", reason: error instanceof Error ? error.message.slice(0, 200) : "Image could not be fetched." };
    }
    await withTenantContext(run.db, run.tenantId, async (tx) => {
      const [row] = await tx
        .select({ applyResult: workbookImportPlanRows.applyResult })
        .from(workbookImportPlanRows)
        .where(and(eq(workbookImportPlanRows.tenantId, run.tenantId), eq(workbookImportPlanRows.id, entry.row.id)))
        .limit(1);
      if (row?.applyResult) await writeRowImage(tx, run.tenantId, entry.row.id, { ...row.applyResult, image });
    });
  }
}

/* ------------------------------------------------------------------ */
/* Attempt                                                             */
/* ------------------------------------------------------------------ */

/**
 * Runs every unit of a plan and records each row's outcome. Rows that are
 * not Create/Update are recorded `not_applied` (or `deferred_only` when they
 * only carry deferred values) without any catalogue write; rows saved by an
 * earlier attempt keep their outcome and count as already applied.
 */
export async function executeUnits(run: ApplyRuntime, rows: PlanRowRecord[]): Promise<{ counts: ApplyCounts; summary: ApplySummary }> {
  const counts: ApplyCounts = { applied: 0, alreadyApplied: 0, failed: 0, notApplied: 0, deferredValues: 0 };
  const affected: Record<string, string[]> = {};
  const failures: NonNullable<ApplySummary["failures"]> = [];

  for (const row of rows) counts.deferredValues += row.deferredFields.length;
  counts.alreadyApplied = rows.filter(isSaved).length;

  const idle = rows.filter((row) => !isApplicable(row) && !isSaved(row));
  if (idle.length > 0) {
    await withTenantContext(run.db, run.tenantId, async (tx) => {
      const remembered = await rememberMatches(tx, run, idle);
      for (const row of idle) {
        const link = remembered.get(row.id);
        await writeRowOutcome(tx, run.tenantId, row.id, {
          state: row.classification === "unchanged" && row.deferredFields.length > 0 ? "deferred_only" : "not_applied",
          applyId: run.apply.id,
          result: { operation: null, fieldsApplied: [], deferred: deferredOf(row), reason: row.classification, ...(link ? { links: [link] } : {}) },
        });
      }
    });
    counts.notApplied = idle.length;
  }

  for (const unit of planUnits(rows)) {
    if (unit.rows.every(isSaved)) continue;
    const outcome = await runUnit(run, unit, counts);
    if (outcome.status === "applied") {
      counts.applied += outcome.saved.length;
      for (const entry of outcome.saved) affected[entry.row.sheet] = [...(affected[entry.row.sheet] ?? []), entry.publicId];
      await ingestImages(run, outcome.saved);
    } else if (outcome.status === "already_applied") {
      counts.alreadyApplied += unit.rows.length;
    } else {
      counts.failed += unit.rows.length;
      for (const row of unit.rows) failures.push({ sheet: row.sheet, row: row.rowNumber, key: row.entityKey, code: outcome.failure.code });
      await recordFailure(run, unit, outcome.failure, counts);
    }
  }
  return { counts, summary: { affected, failures } };
}
