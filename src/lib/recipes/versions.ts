import { and, eq, inArray, max } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type InventoryUnitRecord,
  type RecipeRecord,
  type RecipeVersionLineRecord,
  type RecipeVersionRecord,
  type RecipeVersionStepRecord,
  inventoryItems,
  inventoryUnits,
  recipes,
  recipeVersionLines,
  recipeVersions,
  recipeVersionSnapshots,
  recipeVersionSteps,
} from "@/db/schema";
import { auditActorClassFromStaffRole, recordTenantAuditEventInTx } from "@/lib/audit/tenant-audit";
import { InventoryConflictError, InventoryDetailError, InventoryError } from "@/lib/inventory/errors";
import { microsToDecimalString } from "@/lib/inventory/quantity-math";
import {
  asBody,
  loadTenantUnitsInTx,
  parseExpectedVersion,
  parseOptionalDate,
  parseOptionalText,
  requireInventoryAdministrator,
  tenantToday,
  uniqueViolationConstraint,
  versionConflict,
} from "@/lib/inventory/shared";
import { buildPreparedEdges, findPreparedCycle, type PreparedFamilyGraphInput } from "@/lib/recipes/cycles";
import { previousDay } from "@/lib/recipes/dates";
import {
  assertEffectsApprovableInTx,
  assertTargetedLinesKeptInTx,
  copyEffectsToDraftInTx,
  effectSummariesInTx,
} from "@/lib/recipes/effects-service";
import { loadRecipeDetailInTx } from "@/lib/recipes/recipes";
import {
  assertDraft,
  assertMicrosPrecision,
  assertRecipeActive,
  generateLinePublicId,
  generateStepPublicId,
  generateVersionPublicId,
  LABEL_MAX_LENGTH,
  loadRecipeByPublicIdInTx,
  loadReferencedItemInTx,
  loadReferencedUnitInTx,
  loadVersionByPublicIdInTx,
  MAX_LINES,
  MAX_STEPS,
  parseOptionalLabel,
  parseUnitQuantity,
  RECIPE_NOTES_MAX_LENGTH,
  STEP_TEXT_MAX_LENGTH,
} from "@/lib/recipes/shared";
import type { RecipeDetailView, RecipeView, VersionView } from "@/lib/recipes/views";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-198 recipe versions. A family has at most one open draft. Only a draft
   can change: its yield, notes, ordered ingredient lines and ordered
   preparation steps. Approving a draft fixes its business-effective date,
   ends the previous approved version on that date and writes an insert-only
   snapshot. Approved and discarded versions are read-only; editing an
   approved recipe always means "create a draft from this version".

   Line quantities describe the whole stated yield. Lines and steps are
   replaced as an ordered list: rows are updated, inserted or marked removed
   (never deleted) and positions renumbered 0..n-1. Every write locks the
   family row first, then the version row, and records one audit event in
   the same transaction. Nothing here produces, posts or moves stock. */

export type Context = { tenantId: string; actorSubject: string; membership: ActiveStaffMembership };

export type ApprovalEffect = {
  versionNumber: number;
  effectiveFrom: string;
  /** The version this approval ended, if any. */
  supersededVersion: number | null;
  /** Business dates the superseded version still covers, inclusive. */
  supersededCovers: { from: string; to: string } | null;
  /** From this date on, consumption resolves to the approved version. */
  resolvesFrom: string;
  scheduled: boolean;
  backdated: boolean;
  /** No sales are posted yet, so no past usage is recomputed. */
  postedUsageAffected: 0;
};

export async function lockDraftInTx(
  tx: DbClient,
  tenantId: string,
  recipePublicId: string,
  versionPublicId: string,
  expectedVersion: number,
) {
  const recipe = await loadRecipeByPublicIdInTx(tx, tenantId, recipePublicId, "update");
  const version = await loadVersionByPublicIdInTx(tx, tenantId, recipe.id, versionPublicId, "update");
  assertRecipeActive(recipe);
  assertDraft(version);
  if (version.version !== expectedVersion) {
    throw versionConflict();
  }
  return { recipe, version };
}

export async function bumpVersionInTx(tx: DbClient, version: RecipeVersionRecord, actorSubject: string, values: Partial<RecipeVersionRecord> = {}) {
  const [updated] = await tx
    .update(recipeVersions)
    .set({ ...values, version: version.version + 1, updatedAt: new Date(), updatedBySubject: actorSubject })
    .where(and(eq(recipeVersions.id, version.id), eq(recipeVersions.version, version.version)))
    .returning();
  if (!updated) {
    throw versionConflict();
  }
  return updated;
}

export async function auditVersionInTx(
  tx: DbClient,
  context: Context,
  action:
    | "recipe.version.effects.update"
    | "recipe.version.create"
    | "recipe.version.update"
    | "recipe.version.discard"
    | "recipe.version.lines.update"
    | "recipe.version.steps.update"
    | "recipe.version.approve",
  recipe: RecipeRecord,
  version: RecipeVersionRecord,
  changeSummary: Record<string, unknown>,
) {
  await recordTenantAuditEventInTx(tx, {
    tenantId: context.tenantId,
    actorSubject: context.actorSubject,
    actorClass: auditActorClassFromStaffRole(context.membership.role),
    action,
    entityType: "recipe_version",
    entityPublicId: version.publicId,
    entityVersion: version.version,
    changeSummary: { recipePublicId: recipe.publicId, versionNumber: version.versionNumber, ...changeSummary },
  });
}

async function unitCodes(tx: DbClient, tenantId: string) {
  return new Map((await loadTenantUnitsInTx(tx, tenantId)).map((unit) => [unit.id, unit]));
}

function yieldSummary(version: RecipeVersionRecord, units: Map<string, InventoryUnitRecord>) {
  return {
    yieldQuantity: version.yieldQuantityMicros === null ? null : microsToDecimalString(version.yieldQuantityMicros),
    yieldUnit: version.yieldUnitId ? units.get(version.yieldUnitId)?.code ?? null : null,
    notes: version.notes,
  };
}

async function activeLinesInTx(tx: DbClient, tenantId: string, versionId: string) {
  return (
    await tx
      .select()
      .from(recipeVersionLines)
      .where(
        and(
          eq(recipeVersionLines.tenantId, tenantId),
          eq(recipeVersionLines.recipeVersionId, versionId),
          eq(recipeVersionLines.status, "active"),
        ),
      )
  ).sort((a, b) => a.position - b.position);
}

async function activeStepsInTx(tx: DbClient, tenantId: string, versionId: string) {
  return (
    await tx
      .select()
      .from(recipeVersionSteps)
      .where(
        and(
          eq(recipeVersionSteps.tenantId, tenantId),
          eq(recipeVersionSteps.recipeVersionId, versionId),
          eq(recipeVersionSteps.status, "active"),
        ),
      )
  ).sort((a, b) => a.position - b.position);
}

async function lineSummaries(tx: DbClient, tenantId: string, lines: RecipeVersionLineRecord[], units: Map<string, InventoryUnitRecord>) {
  const itemIds = [...new Set(lines.map((line) => line.itemId))];
  const items = itemIds.length
    ? await tx
        .select({ id: inventoryItems.id, publicId: inventoryItems.publicId, nameEn: inventoryItems.nameEn })
        .from(inventoryItems)
        .where(and(eq(inventoryItems.tenantId, tenantId), inArray(inventoryItems.id, itemIds)))
    : [];
  const byId = new Map(items.map((item) => [item.id, item]));
  return lines.map((line) => ({
    linePublicId: line.publicId,
    position: line.position,
    itemPublicId: byId.get(line.itemId)?.publicId ?? null,
    itemNameEn: byId.get(line.itemId)?.nameEn ?? null,
    quantity: microsToDecimalString(line.quantityMicros),
    quantityMicros: line.quantityMicros.toString(),
    unit: units.get(line.unitId)?.code ?? null,
    unitPublicId: units.get(line.unitId)?.publicId ?? null,
    labelEn: line.labelEn,
    labelAr: line.labelAr,
  }));
}

function stepSummaries(steps: RecipeVersionStepRecord[]) {
  return steps.map((step) => ({ stepPublicId: step.publicId, position: step.position, textEn: step.textEn, textAr: step.textAr }));
}

/**
 * Refuses lines that would make a prepared item part of its own recipe,
 * directly or through other prepared recipes' drafts and current or
 * scheduled approved versions. The error carries the item path.
 */
async function assertNoCycleInTx(tx: DbClient, tenantId: string, recipe: RecipeRecord, lineItemIds: string[], today: string) {
  if (recipe.kind !== "prepared" || !recipe.outputItemId) {
    return;
  }
  const families = await tx
    .select({ id: recipes.id, outputItemId: recipes.outputItemId })
    .from(recipes)
    .where(and(eq(recipes.tenantId, tenantId), eq(recipes.kind, "prepared"), eq(recipes.status, "active")));
  const familyIds = families.map((family) => family.id);
  const versions = familyIds.length
    ? await tx
        .select({
          id: recipeVersions.id,
          recipeId: recipeVersions.recipeId,
          status: recipeVersions.status,
          effectiveTo: recipeVersions.effectiveTo,
        })
        .from(recipeVersions)
        .where(and(eq(recipeVersions.tenantId, tenantId), inArray(recipeVersions.recipeId, familyIds)))
    : [];
  const versionIds = versions.map((version) => version.id);
  const lines = versionIds.length
    ? await tx
        .select({ versionId: recipeVersionLines.recipeVersionId, itemId: recipeVersionLines.itemId, status: recipeVersionLines.status })
        .from(recipeVersionLines)
        .where(and(eq(recipeVersionLines.tenantId, tenantId), inArray(recipeVersionLines.recipeVersionId, versionIds)))
    : [];
  const graph: PreparedFamilyGraphInput[] = families.map((family) => ({
    recipeId: family.id,
    outputItemId: family.outputItemId!,
    versions: versions
      .filter((version) => version.recipeId === family.id)
      .map((version) => ({
        status: version.status,
        effectiveTo: version.effectiveTo,
        lines: lines.filter((line) => line.versionId === version.id),
      })),
  }));
  const edges = buildPreparedEdges(graph, { recipeId: recipe.id, outputItemId: recipe.outputItemId, lineItemIds }, today);
  const path = findPreparedCycle(edges, recipe.outputItemId);
  if (!path) {
    return;
  }
  const items = await tx
    .select({ id: inventoryItems.id, publicId: inventoryItems.publicId, nameEn: inventoryItems.nameEn, nameAr: inventoryItems.nameAr })
    .from(inventoryItems)
    .where(and(eq(inventoryItems.tenantId, tenantId), inArray(inventoryItems.id, [...new Set(path)])));
  const byId = new Map(items.map((item) => [item.id, item]));
  throw new InventoryDetailError(
    `These lines would make a prepared item part of its own recipe: ${path.map((id) => byId.get(id)?.nameEn ?? id).join(" → ")}.`,
    "recipe_cycle",
    "lines",
    {
      path: path.map((id) => ({
        itemPublicId: byId.get(id)?.publicId ?? null,
        nameEn: byId.get(id)?.nameEn ?? null,
        nameAr: byId.get(id)?.nameAr ?? null,
      })),
    },
  );
}

/** Creates the next draft as a copy of an approved (or discarded) version. One open draft per family. */
export async function createDraftFromVersion(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  recipePublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<RecipeDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const context = { tenantId, actorSubject, membership };
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const recipe = await loadRecipeByPublicIdInTx(tx, tenantId, recipePublicId, "update");
      const source = await loadVersionByPublicIdInTx(tx, tenantId, recipe.id, body.fromVersionPublicId, undefined, "fromVersionPublicId");
      assertRecipeActive(recipe);
      const [open] = await tx
        .select({ id: recipeVersions.id })
        .from(recipeVersions)
        .where(and(eq(recipeVersions.tenantId, tenantId), eq(recipeVersions.recipeId, recipe.id), eq(recipeVersions.status, "draft")))
        .limit(1);
      if (open) {
        throw draftExists();
      }
      const [latest] = await tx
        .select({ number: max(recipeVersions.versionNumber) })
        .from(recipeVersions)
        .where(and(eq(recipeVersions.tenantId, tenantId), eq(recipeVersions.recipeId, recipe.id)));
      const [draft] = await tx
        .insert(recipeVersions)
        .values({
          tenantId,
          publicId: generateVersionPublicId(),
          recipeId: recipe.id,
          versionNumber: (latest?.number ?? 0) + 1,
          status: "draft",
          yieldQuantityMicros: source.yieldQuantityMicros,
          yieldUnitId: source.yieldUnitId,
          notes: source.notes,
          provenance: "operator_entered",
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        })
        .returning();
      const lines = await activeLinesInTx(tx, tenantId, source.id);
      let draftLines: RecipeVersionLineRecord[] = [];
      if (lines.length > 0) {
        draftLines = await tx.insert(recipeVersionLines).values(
          lines.map((line, index) => ({
            tenantId,
            publicId: generateLinePublicId(),
            recipeVersionId: draft!.id,
            itemId: line.itemId,
            unitId: line.unitId,
            quantityMicros: line.quantityMicros,
            position: index,
            labelEn: line.labelEn,
            labelAr: line.labelAr,
            createdBySubject: actorSubject,
            updatedBySubject: actorSubject,
          })),
        ).returning();
      }
      // QOS-199: effects are version-scoped; the draft gets explicit copies pointing at its own lines, to review before approval.
      const copiedEffects = await copyEffectsToDraftInTx(tx, tenantId, actorSubject, lines, draftLines, source.id, draft!.id);
      const steps = await activeStepsInTx(tx, tenantId, source.id);
      if (steps.length > 0) {
        await tx.insert(recipeVersionSteps).values(
          steps.map((step, index) => ({
            tenantId,
            publicId: generateStepPublicId(),
            recipeVersionId: draft!.id,
            position: index,
            textEn: step.textEn,
            textAr: step.textAr,
            createdBySubject: actorSubject,
            updatedBySubject: actorSubject,
          })),
        );
      }
      await auditVersionInTx(tx, context, "recipe.version.create", recipe, draft!, {
        fromVersionPublicId: source.publicId,
        fromVersionNumber: source.versionNumber,
        copiedLines: lines.length,
        copiedSteps: steps.length,
        copiedEffects,
      });
      return loadRecipeDetailInTx(tx, tenantId, recipe, now);
    });
  } catch (error) {
    if (uniqueViolationConstraint(error) === "recipe_versions_open_draft_unique") {
      throw draftExists();
    }
    throw error;
  }
}

function draftExists() {
  return new InventoryConflictError(
    "This recipe already has an open draft. Approve or discard it first.",
    "draft_exists",
    "fromVersionPublicId",
  );
}

/** Edits a draft's yield, yield unit and notes, or discards it (`status: "discarded"`). */
export async function updateDraftVersion(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  recipePublicId: string,
  versionPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<RecipeDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  if (body.status !== undefined && body.status !== "discarded") {
    throw new InventoryError("A draft can only be discarded here. Approve it with the approve action.", 400, "status_invalid", "status");
  }
  const notes = body.notes === undefined ? undefined : parseOptionalText(body.notes, "notes", RECIPE_NOTES_MAX_LENGTH);
  const context = { tenantId, actorSubject, membership };
  return withTenantContext(db, tenantId, async (tx) => {
    const { recipe, version } = await lockDraftInTx(tx, tenantId, recipePublicId, versionPublicId, expectedVersion);
    const units = await unitCodes(tx, tenantId);
    if (body.status === "discarded") {
      const discarded = await bumpVersionInTx(tx, version, actorSubject, { status: "discarded" });
      await auditVersionInTx(tx, context, "recipe.version.discard", recipe, discarded, { before: { status: "draft" }, after: { status: "discarded" } });
      return loadRecipeDetailInTx(tx, tenantId, recipe, now);
    }
    let yieldUnitId = version.yieldUnitId;
    if (body.yieldUnitPublicId !== undefined) {
      yieldUnitId =
        body.yieldUnitPublicId === null || body.yieldUnitPublicId === ""
          ? null
          : (await loadReferencedUnitInTx(tx, tenantId, body.yieldUnitPublicId, "yieldUnitPublicId")).id;
    }
    const yieldUnit = yieldUnitId ? units.get(yieldUnitId) ?? null : null;
    let yieldMicros = version.yieldQuantityMicros;
    if (body.yieldQuantity !== undefined) {
      yieldMicros =
        body.yieldQuantity === null || body.yieldQuantity === ""
          ? null
          : parseUnitQuantity(body.yieldQuantity, yieldUnit, "yieldQuantity", "yield");
    }
    if (yieldMicros !== null && yieldUnit) {
      assertMicrosPrecision(yieldMicros, yieldUnit, "yieldQuantity", "yield");
    }
    const updated = await bumpVersionInTx(tx, version, actorSubject, {
      yieldQuantityMicros: yieldMicros,
      yieldUnitId,
      notes: notes === undefined ? version.notes : notes,
    });
    await auditVersionInTx(tx, context, "recipe.version.update", recipe, updated, {
      before: yieldSummary(version, units),
      after: yieldSummary(updated, units),
    });
    return loadRecipeDetailInTx(tx, tenantId, recipe, now);
  });
}

type ParsedLine = {
  linePublicId: string | null;
  itemId: string;
  unitId: string;
  quantityMicros: bigint;
  labelEn: string | null;
  labelAr: string | null;
};

/**
 * Replaces a draft's ingredient lines with the ordered list sent. Existing
 * lines keep their public id; lines left out are marked removed.
 */
export async function replaceDraftLines(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  recipePublicId: string,
  versionPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<RecipeDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  if (!Array.isArray(body.lines)) {
    throw new InventoryError("Send the lines as a list.", 400, "body_invalid", "lines");
  }
  if (body.lines.length > MAX_LINES) {
    throw new InventoryError(`A recipe version can have at most ${MAX_LINES} lines.`, 400, "lines_too_many", "lines");
  }
  const rawLines = body.lines.map((line) => asBody(line));
  const context = { tenantId, actorSubject, membership };
  return withTenantContext(db, tenantId, async (tx) => {
    const { recipe, version } = await lockDraftInTx(tx, tenantId, recipePublicId, versionPublicId, expectedVersion);
    const existing = await activeLinesInTx(tx, tenantId, version.id);
    const existingByPublicId = new Map(existing.map((line) => [line.publicId, line]));
    const parsed: ParsedLine[] = [];
    const seenItems = new Set<string>();
    const seenLines = new Set<string>();
    for (const [index, raw] of rawLines.entries()) {
      const field = (name: string) => `lines.${index}.${name}`;
      let linePublicId: string | null = null;
      if (raw.linePublicId != null && raw.linePublicId !== "") {
        if (typeof raw.linePublicId !== "string" || !existingByPublicId.has(raw.linePublicId)) {
          throw new InventoryError("This line was not found on the draft. Reload and try again.", 404, "line_not_found", field("linePublicId"));
        }
        if (seenLines.has(raw.linePublicId)) {
          throw new InventoryError("A line was sent twice.", 400, "body_invalid", field("linePublicId"));
        }
        seenLines.add(raw.linePublicId);
        linePublicId = raw.linePublicId;
      }
      if (raw.itemPublicId == null || raw.itemPublicId === "") {
        throw new InventoryError("Choose an item for every line.", 400, "line_item_required", field("itemPublicId"));
      }
      const item = await loadReferencedItemInTx(tx, tenantId, raw.itemPublicId, field("itemPublicId"));
      if (seenItems.has(item.id)) {
        throw new InventoryError(
          "Each item can appear once per version. Enter the total quantity on one line.",
          400,
          "duplicate_line_item",
          field("itemPublicId"),
        );
      }
      seenItems.add(item.id);
      const unit = await loadReferencedUnitInTx(tx, tenantId, raw.unitPublicId, field("unitPublicId"));
      parsed.push({
        linePublicId,
        itemId: item.id,
        unitId: unit.id,
        quantityMicros: parseUnitQuantity(raw.quantity, unit, field("quantity"), "quantity"),
        labelEn: parseOptionalLabel(raw.labelEn, field("labelEn"), LABEL_MAX_LENGTH, "label_too_long"),
        labelAr: parseOptionalLabel(raw.labelAr, field("labelAr"), LABEL_MAX_LENGTH, "label_too_long"),
      });
    }
    await assertNoCycleInTx(tx, tenantId, recipe, parsed.map((line) => line.itemId), await tenantToday(tx, tenantId, now));
    await assertTargetedLinesKeptInTx(tx, tenantId, version.id, existing, parsed);

    const stamp = { updatedAt: new Date(), updatedBySubject: actorSubject };
    // Mark every current line removed first so a reorder that swaps items never trips the one-active-line-per-item index.
    if (existing.length > 0) {
      await tx
        .update(recipeVersionLines)
        .set({ status: "removed", ...stamp })
        .where(
          and(
            eq(recipeVersionLines.tenantId, tenantId),
            eq(recipeVersionLines.recipeVersionId, version.id),
            eq(recipeVersionLines.status, "active"),
          ),
        );
    }
    for (const [position, line] of parsed.entries()) {
      const values = {
        itemId: line.itemId,
        unitId: line.unitId,
        quantityMicros: line.quantityMicros,
        position,
        labelEn: line.labelEn,
        labelAr: line.labelAr,
        status: "active" as const,
      };
      if (line.linePublicId) {
        await tx
          .update(recipeVersionLines)
          .set({ ...values, ...stamp })
          .where(and(eq(recipeVersionLines.id, existingByPublicId.get(line.linePublicId)!.id)));
      } else {
        await tx.insert(recipeVersionLines).values({
          tenantId,
          publicId: generateLinePublicId(),
          recipeVersionId: version.id,
          ...values,
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        });
      }
    }
    const updated = await bumpVersionInTx(tx, version, actorSubject);
    const units = await unitCodes(tx, tenantId);
    await auditVersionInTx(tx, context, "recipe.version.lines.update", recipe, updated, {
      before: { lines: await lineSummaries(tx, tenantId, existing, units) },
      after: { lines: await lineSummaries(tx, tenantId, await activeLinesInTx(tx, tenantId, version.id), units) },
    });
    return loadRecipeDetailInTx(tx, tenantId, recipe, now);
  });
}

/** Replaces a draft's preparation steps with the ordered list sent (English required, Arabic optional). */
export async function replaceDraftSteps(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  recipePublicId: string,
  versionPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<RecipeDetailView> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  if (!Array.isArray(body.steps)) {
    throw new InventoryError("Send the steps as a list.", 400, "body_invalid", "steps");
  }
  if (body.steps.length > MAX_STEPS) {
    throw new InventoryError(`A recipe version can have at most ${MAX_STEPS} steps.`, 400, "steps_too_many", "steps");
  }
  const rawSteps = body.steps.map((step) => asBody(step));
  const context = { tenantId, actorSubject, membership };
  return withTenantContext(db, tenantId, async (tx) => {
    const { recipe, version } = await lockDraftInTx(tx, tenantId, recipePublicId, versionPublicId, expectedVersion);
    const existing = await activeStepsInTx(tx, tenantId, version.id);
    const existingByPublicId = new Map(existing.map((step) => [step.publicId, step]));
    const seen = new Set<string>();
    const parsed = rawSteps.map((raw, index) => {
      const field = (name: string) => `steps.${index}.${name}`;
      let stepPublicId: string | null = null;
      if (raw.stepPublicId != null && raw.stepPublicId !== "") {
        if (typeof raw.stepPublicId !== "string" || !existingByPublicId.has(raw.stepPublicId)) {
          throw new InventoryError("This step was not found on the draft. Reload and try again.", 404, "step_not_found", field("stepPublicId"));
        }
        if (seen.has(raw.stepPublicId)) {
          throw new InventoryError("A step was sent twice.", 400, "body_invalid", field("stepPublicId"));
        }
        seen.add(raw.stepPublicId);
        stepPublicId = raw.stepPublicId;
      }
      const textEn = parseOptionalLabel(raw.textEn, field("textEn"), STEP_TEXT_MAX_LENGTH, "step_text_too_long");
      if (!textEn) {
        throw new InventoryError("Enter the step in English.", 400, "step_text_required", field("textEn"));
      }
      return {
        stepPublicId,
        textEn,
        textAr: parseOptionalLabel(raw.textAr, field("textAr"), STEP_TEXT_MAX_LENGTH, "step_text_too_long"),
      };
    });
    const stamp = { updatedAt: new Date(), updatedBySubject: actorSubject };
    if (existing.length > 0) {
      await tx
        .update(recipeVersionSteps)
        .set({ status: "removed", ...stamp })
        .where(
          and(
            eq(recipeVersionSteps.tenantId, tenantId),
            eq(recipeVersionSteps.recipeVersionId, version.id),
            eq(recipeVersionSteps.status, "active"),
          ),
        );
    }
    for (const [position, step] of parsed.entries()) {
      const values = { position, textEn: step.textEn, textAr: step.textAr, status: "active" as const };
      if (step.stepPublicId) {
        await tx
          .update(recipeVersionSteps)
          .set({ ...values, ...stamp })
          .where(eq(recipeVersionSteps.id, existingByPublicId.get(step.stepPublicId)!.id));
      } else {
        await tx.insert(recipeVersionSteps).values({
          tenantId,
          publicId: generateStepPublicId(),
          recipeVersionId: version.id,
          ...values,
          createdBySubject: actorSubject,
          updatedBySubject: actorSubject,
        });
      }
    }
    const updated = await bumpVersionInTx(tx, version, actorSubject);
    await auditVersionInTx(tx, context, "recipe.version.steps.update", recipe, updated, {
      before: { steps: stepSummaries(existing) },
      after: { steps: stepSummaries(await activeStepsInTx(tx, tenantId, version.id)) },
    });
    return loadRecipeDetailInTx(tx, tenantId, recipe, now);
  });
}

/**
 * Approves a draft from `effectiveFrom`. The date must be strictly later
 * than the current approved version's date and not before the end of any
 * ended version, so approved ranges never overlap. The previous version is
 * ended on that date, the draft becomes approved and an insert-only snapshot
 * is written. Returns the detail plus the effect of the date chosen.
 */
export async function approveVersion(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  actorSubject: string,
  recipePublicId: string,
  versionPublicId: string,
  input: unknown,
  now: Date = new Date(),
): Promise<RecipeDetailView & { effect: ApprovalEffect }> {
  requireInventoryAdministrator(membership);
  const body = asBody(input);
  const expectedVersion = parseExpectedVersion(body.expectedVersion);
  const effectiveFrom = parseOptionalDate(body.effectiveFrom);
  if (!effectiveFrom) {
    throw new InventoryError("Enter the date this version takes effect.", 400, "effective_from_invalid", "effectiveFrom");
  }
  const context = { tenantId, actorSubject, membership };
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const { recipe, version } = await lockDraftInTx(tx, tenantId, recipePublicId, versionPublicId, expectedVersion);
      const today = await tenantToday(tx, tenantId, now);
      if (version.yieldQuantityMicros === null || version.yieldUnitId === null) {
        throw new InventoryError("Enter the yield and its unit before approving.", 400, "yield_required", "yieldQuantity");
      }
      const [yieldUnit] = await tx
        .select()
        .from(inventoryUnits)
        .where(and(eq(inventoryUnits.tenantId, tenantId), eq(inventoryUnits.id, version.yieldUnitId)))
        .limit(1)
        .for("share");
      if (yieldUnit!.status !== "active") {
        throw new InventoryError("Archived units cannot be used here. Restore the unit first.", 400, "unit_archived", "yieldUnitPublicId");
      }
      const lines = await activeLinesInTx(tx, tenantId, version.id);
      if (lines.length === 0) {
        throw new InventoryError("Add at least one ingredient line before approving.", 400, "no_lines_to_approve", "lines");
      }
      const lineItems = await tx
        .select()
        .from(inventoryItems)
        .where(and(eq(inventoryItems.tenantId, tenantId), inArray(inventoryItems.id, lines.map((line) => line.itemId))))
        .for("share");
      if (lineItems.some((item) => item.status !== "active")) {
        throw new InventoryError("A line uses an archived item. Replace or restore it before approving.", 400, "item_archived", "lines");
      }
      const units = await unitCodes(tx, tenantId);
      if (lines.some((line) => units.get(line.unitId)?.status !== "active")) {
        throw new InventoryError("A line uses an archived unit. Replace or restore it before approving.", 400, "unit_archived", "lines");
      }
      await assertNoCycleInTx(tx, tenantId, recipe, lines.map((line) => line.itemId), today);
      const effects = await assertEffectsApprovableInTx(tx, tenantId, version.id);

      const approved = await tx
        .select()
        .from(recipeVersions)
        .where(and(eq(recipeVersions.tenantId, tenantId), eq(recipeVersions.recipeId, recipe.id), eq(recipeVersions.status, "approved")));
      const current = approved.find((row) => row.effectiveTo === null) ?? null;
      const lastEnded = approved.reduce<string | null>(
        (latest, row) => (row.effectiveTo && (!latest || row.effectiveTo > latest) ? row.effectiveTo : latest),
        null,
      );
      if ((current && effectiveFrom <= current.effectiveFrom!) || (lastEnded && effectiveFrom < lastEnded)) {
        const floor = current?.effectiveFrom ?? lastEnded!;
        throw new InventoryConflictError(
          `The effective date must be later than ${floor}, the date of the current version. History is not rewritten.`,
          "effective_from_before_current",
          "effectiveFrom",
        );
      }
      if (current) {
        const ended = await tx
          .update(recipeVersions)
          .set({ effectiveTo: effectiveFrom, version: current.version + 1, updatedAt: new Date(), updatedBySubject: actorSubject })
          .where(and(eq(recipeVersions.id, current.id), eq(recipeVersions.version, current.version)))
          .returning();
        if (ended.length !== 1) {
          throw versionConflict();
        }
      }
      const approvedAt = new Date();
      const result = await bumpVersionInTx(tx, version, actorSubject, {
        status: "approved",
        effectiveFrom,
        approvedAt,
        approvedBySubject: actorSubject,
      });
      const outputItem = recipe.outputItemId
        ? (
            await tx
              .select()
              .from(inventoryItems)
              .where(and(eq(inventoryItems.tenantId, tenantId), eq(inventoryItems.id, recipe.outputItemId)))
              .limit(1)
          )[0] ?? null
        : null;
      const lineSummary = await lineSummaries(tx, tenantId, lines, units);
      const steps = stepSummaries(await activeStepsInTx(tx, tenantId, version.id));
      await tx.insert(recipeVersionSnapshots).values({
        tenantId,
        recipeVersionId: result.id,
        snapshot: {
          // schema 2 (QOS-199) adds the version's modifier effects; schema 1 rows are never rewritten.
          schema: 2,
          recipe: {
            publicId: recipe.publicId,
            kind: recipe.kind,
            nameEn: recipe.nameEn,
            nameAr: recipe.nameAr,
            outputItemPublicId: outputItem?.publicId ?? null,
          },
          version: {
            publicId: result.publicId,
            versionNumber: result.versionNumber,
            effectiveFrom,
            yield: {
              quantity: microsToDecimalString(result.yieldQuantityMicros!),
              quantityMicros: result.yieldQuantityMicros!.toString(),
              unitPublicId: yieldUnit!.publicId,
              unitCode: yieldUnit!.code,
            },
            notes: result.notes,
            approvedAt: approvedAt.toISOString(),
            approvedBySubject: actorSubject,
          },
          lines: lineSummary,
          steps,
          effects: (await effectSummariesInTx(tx, tenantId, effects)).map((effect) => ({
            effectPublicId: effect.effectPublicId,
            effectType: effect.effectType,
            optionPublicId: effect.optionPublicId,
            optionNameEn: effect.optionNameEn,
            optionNameAr: effect.optionNameAr,
            groupPublicId: effect.groupPublicId,
            targetLinePublicId: effect.targetLinePublicId,
            itemPublicId: effect.itemPublicId,
            quantity: effect.quantity,
            quantityMicros: effect.quantityMicros,
            unitCode: effect.unit,
            notes: effect.notes,
          })),
        },
        createdBySubject: actorSubject,
      });
      const effect: ApprovalEffect = {
        versionNumber: result.versionNumber,
        effectiveFrom,
        supersededVersion: current?.versionNumber ?? null,
        supersededCovers: current ? { from: current.effectiveFrom!, to: previousDay(effectiveFrom) } : null,
        resolvesFrom: effectiveFrom,
        scheduled: effectiveFrom > today,
        backdated: effectiveFrom < today,
        postedUsageAffected: 0,
      };
      await auditVersionInTx(tx, context, "recipe.version.approve", recipe, result, {
        before: { status: "draft" },
        after: { status: "approved", effectiveFrom, ...yieldSummary(result, units), lineCount: lines.length, stepCount: steps.length, effectCount: effects.length },
        superseded: current ? { versionPublicId: current.publicId, versionNumber: current.versionNumber, effectiveTo: effectiveFrom } : null,
        effect,
      });
      return { ...(await loadRecipeDetailInTx(tx, tenantId, recipe, now)), effect };
    });
  } catch (error) {
    if (uniqueViolationConstraint(error) === "recipe_versions_current_approved_unique") {
      throw versionConflict();
    }
    throw error;
  }
}

/** One version for the read-only history view, with its family. */
export async function getVersion(
  db: DbClient,
  tenantId: string,
  recipePublicId: string,
  versionPublicId: string,
  now: Date = new Date(),
): Promise<{ recipe: RecipeView; version: VersionView; today: string }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const recipe = await loadRecipeByPublicIdInTx(tx, tenantId, recipePublicId);
    const version = await loadVersionByPublicIdInTx(tx, tenantId, recipe.id, versionPublicId);
    const detail = await loadRecipeDetailInTx(tx, tenantId, recipe, now);
    return {
      recipe: detail.recipe,
      version: detail.versions.find((entry) => entry.publicId === version.publicId)!,
      today: detail.today,
    };
  });
}
