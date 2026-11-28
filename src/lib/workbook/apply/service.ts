import type { DbClient } from "@/db/client";
import { type ActiveStaffMembership, StaffAuthorizationError } from "@/lib/staff/auth";
import { resolveStaffDisplayNames } from "@/lib/staff/staff-display-names";
import { withTenantContext } from "@/lib/tenant/context";
import type { ApplyActor } from "@/lib/workbook/apply/audit";
import { baselineTokens, executeUnits, rowsByKey } from "@/lib/workbook/apply/engine";
import { WorkbookApplyError } from "@/lib/workbook/apply/errors";
import type { ApplyHooks, ApplyRuntime } from "@/lib/workbook/apply/handlers/types";
import type { ApplyBlockReason, ApplyPermissions, PlanApplyView } from "@/lib/workbook/apply/model";
import {
  type ApplyRecord,
  attemptView,
  EMPTY_COUNTS,
  findApplyByIdempotencyKey,
  finishAttempt,
  listApplies,
  repairInterruptedApply,
  rowOutcomes,
  startAttempt,
} from "@/lib/workbook/apply/repository";
import type { WorkbookReviewResult } from "@/lib/workbook/validation/model";
import {
  hashReview,
  loadPlan,
  markPlanStale,
  type PlanApplyResultPart,
  type PlanRecord,
  type PlanRowRecord,
  resultFromPlan,
} from "@/lib/workbook/validation/plan-repository";
import { REVIEW_ENGINE_VERSION } from "@/lib/workbook/validation/review";
import { assertPlanScopeReadable } from "@/lib/workbook/validation/service";
import { buildReviewSnapshot, loadSnapshotSource, restrictSourceToScope, snapshotHashOf } from "@/lib/workbook/validation/snapshot";

/* Workbook apply service (QOS-217): authorise, gate, recompute the plan
   hash against a fresh snapshot, lock the plan, run the engine, finish.
   Administrators only (D-AUTH). Drafts only: nothing is published, no
   translation is approved and no stock is posted. */

export type ApplyRequest = { expectedPlanHash: string; idempotencyKey: string };

export function parseApplyBody(raw: unknown): { expectedPlanHash: string } {
  const body = raw as { expectedPlanHash?: unknown } | null;
  if (!body || typeof body.expectedPlanHash !== "string" || !body.expectedPlanHash || body.expectedPlanHash.length > 128) {
    throw new WorkbookApplyError("apply_body_invalid", "expectedPlanHash is required.", 400);
  }
  return { expectedPlanHash: body.expectedPlanHash };
}

/** Why the plan cannot be applied now, or nothing when it can. */
export function applyBlockReason(
  membership: ActiveStaffMembership,
  plan: Pick<PlanRecord, "status">,
  result: Pick<WorkbookReviewResult, "stale" | "readiness">,
): ApplyBlockReason | undefined {
  if (membership.role !== "administrator") return "not_administrator";
  if (plan.status === "applying") return "applying";
  if (plan.status === "applied") return "applied";
  if (plan.status === "apply_failed") return "apply_failed";
  if (plan.status === "stale" || result.stale) return "stale";
  if (!result.readiness.reviewComplete) return "review_incomplete";
  return undefined;
}

function applyPart(
  membership: ActiveStaffMembership,
  plan: PlanRecord,
  rows: PlanRowRecord[],
  applies: ApplyRecord[],
  base: WorkbookReviewResult,
  displayNames: ReadonlyMap<string, string>,
): PlanApplyResultPart {
  const reason = applyBlockReason(membership, plan, base);
  const permissions: ApplyPermissions = reason ? { canApply: false, reason } : { canApply: true };
  const view: PlanApplyView = {
    permissions,
    preview: {
      create: base.counts.create,
      update: base.counts.update,
      notApplied: base.counts.rows - base.counts.create - base.counts.update,
      deferredValues: base.counts.deferredValues,
    },
    attempts: applies.map((record) => attemptView(record, displayNames)),
  };
  return { view, outcomes: rowOutcomes(rows, applies) };
}

async function loadWithApplies(db: DbClient, tenantId: string, planPublicId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    const { plan, rows } = await loadPlan(tx, tenantId, planPublicId);
    const applies = await listApplies(tx, tenantId, plan.id);
    const displayNames = await resolveStaffDisplayNames(tx, tenantId, applies.map((record) => record.actorSubject));
    return { plan, rows, applies, displayNames };
  });
}

/**
 * A review result with the plan's apply permissions, preview, history and
 * per-row outcomes. Used by every route that returns a plan, so the review
 * panel always knows whether Apply is available.
 */
export async function withApplyView(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  result: WorkbookReviewResult,
): Promise<WorkbookReviewResult> {
  const { plan, rows, applies, displayNames } = await loadWithApplies(db, tenantId, result.plan.publicId);
  const base = resultFromPlan(plan, rows, { stale: result.stale, replayed: result.replayed });
  return resultFromPlan(plan, rows, { stale: result.stale, replayed: result.replayed, apply: applyPart(membership, plan, rows, applies, base, displayNames) });
}

/** Read-repair of an apply interrupted by a restart (heartbeat older than the timeout). */
export async function repairPlanIfInterrupted(db: DbClient, tenantId: string, planPublicId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    const { plan } = await loadPlan(tx, tenantId, planPublicId);
    return repairInterruptedApply(tx, tenantId, plan);
  });
}

async function replay(db: DbClient, tenantId: string, membership: ActiveStaffMembership, subject: string, plan: PlanRecord, idempotencyKey: string) {
  const existing = await withTenantContext(db, tenantId, (tx) => findApplyByIdempotencyKey(tx, tenantId, idempotencyKey));
  if (!existing) return null;
  // A key replays only the same person's apply of the same plan.
  if (existing.planId !== plan.id || existing.actorSubject !== subject) {
    throw new WorkbookApplyError("idempotency_key_reused", "This idempotency key was used for another apply.", 409);
  }
  if (existing.status === "applying") {
    if (await repairPlanIfInterrupted(db, tenantId, plan.publicId)) {
      throw new WorkbookApplyError("plan_rereview_required", "The last apply was interrupted. Revalidate the review, then apply again.", 409);
    }
    throw new WorkbookApplyError("apply_in_progress", "This plan is being applied.", 409);
  }
  const { plan: current, rows } = await withTenantContext(db, tenantId, (tx) => loadPlan(tx, tenantId, plan.publicId));
  return withApplyView(db, tenantId, membership, { ...resultFromPlan(current, rows), replayed: true });
}

function statusGate(plan: PlanRecord) {
  switch (plan.status) {
    case "stale":
      throw new WorkbookApplyError("plan_stale", "The records changed since this review. Revalidate it before applying.", 409);
    case "applying":
      throw new WorkbookApplyError("apply_in_progress", "This plan is being applied.", 409);
    case "applied":
      throw new WorkbookApplyError("plan_applied", "This plan has already been applied.", 409);
    case "apply_failed":
      throw new WorkbookApplyError("plan_rereview_required", "Some rows were not saved. Revalidate the review, then apply again.", 409);
    default:
      return;
  }
}

/**
 * Applies a reviewed plan. Gates, in order: administrator, branch scope,
 * idempotent replay, plan status, review complete, the client's plan hash,
 * and the plan hash recomputed with `hashReview` against a fresh snapshot
 * (a mismatch marks the plan stale). Then one transaction locks the plan,
 * the engine runs one transaction per unit, and one transaction finishes.
 */
export async function applyWorkbookPlan(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  subject: string,
  planPublicId: string,
  request: ApplyRequest,
  options: { hooks?: ApplyHooks } = {},
): Promise<WorkbookReviewResult> {
  let { plan, rows } = await withTenantContext(db, tenantId, (tx) => loadPlan(tx, tenantId, planPublicId));
  if (membership.role !== "administrator") {
    throw new WorkbookApplyError("apply_requires_administrator", "Only an administrator can apply a workbook.", 403);
  }
  await assertPlanScopeReadable(db, tenantId, membership, plan.branchScope);

  const replayed = await replay(db, tenantId, membership, subject, plan, request.idempotencyKey);
  if (replayed) return replayed;

  if (plan.status === "applying" && (await repairPlanIfInterrupted(db, tenantId, planPublicId))) {
    ({ plan, rows } = await withTenantContext(db, tenantId, (tx) => loadPlan(tx, tenantId, planPublicId)));
  }
  statusGate(plan);

  const stored = resultFromPlan(plan, rows);
  if (!stored.readiness.reviewComplete) {
    throw new WorkbookApplyError("review_incomplete", "Finish the review before applying: decide conflicts and give every acknowledgement.", 409, {
      blockers: stored.readiness.blockers,
    });
  }
  if (request.expectedPlanHash !== plan.planHash) {
    throw new WorkbookApplyError("plan_hash_mismatch", "This review changed since you loaded it. Load it again.", 409);
  }

  const source = await loadSnapshotSource(db, tenantId, membership, {
    brand: plan.context.context.brandPublicId,
    sourceNamespace: plan.sourceNamespace,
  });
  const scoped = restrictSourceToScope(source, plan.branchScope);
  if (!scoped) {
    throw new StaffAuthorizationError("This review covers branches outside your branch scope.");
  }
  const snapshotHash = snapshotHashOf(scoped);
  const recomputed = hashReview(stored, {
    snapshotHash,
    createdBy: { subject: plan.createdBySubject, role: plan.createdByRole },
    reviewedBySubject: plan.reviewedBySubject,
  });
  if (recomputed !== plan.planHash) {
    await withTenantContext(db, tenantId, (tx) => markPlanStale(tx, tenantId, plan));
    throw new WorkbookApplyError("plan_stale", "The records or the plan changed since this review. Revalidate it before applying.", 409);
  }

  const actor: ApplyActor = { subject, role: membership.role };
  const apply = await withTenantContext(db, tenantId, (tx) =>
    startAttempt(tx, { tenantId, plan, idempotencyKey: request.idempotencyKey, snapshotHash, engineVersion: REVIEW_ENGINE_VERSION, actor }),
  );

  const snapshot = buildReviewSnapshot(scoped);
  const run: ApplyRuntime = {
    db,
    tenantId,
    membership,
    actor,
    plan,
    apply,
    namespace: plan.sourceNamespace,
    brandPublicId: plan.context.context.brandPublicId,
    snapshot,
    rowsByKey: rowsByKey(rows),
    saved: new Map(rows.filter((row) => row.appliedPublicId).map((row) => [row.id, row.appliedPublicId!])),
    baseline: baselineTokens(snapshot),
    selfWritten: new Map(),
    hooks: options.hooks ?? {},
  };

  let outcome: Awaited<ReturnType<typeof executeUnits>>;
  try {
    outcome = await executeUnits(run, rows);
  } catch (error) {
    // Infrastructure failure between units: close the attempt honestly; saved units stay saved.
    await withTenantContext(db, tenantId, (tx) =>
      finishAttempt(tx, { tenantId, plan, apply, actor, counts: { ...EMPTY_COUNTS, failed: 1 }, summary: {} }),
    ).catch(() => undefined);
    throw error;
  }
  await withTenantContext(db, tenantId, (tx) => finishAttempt(tx, { tenantId, plan, apply, actor, counts: outcome.counts, summary: outcome.summary }));

  const { plan: finished, rows: finishedRows } = await withTenantContext(db, tenantId, (tx) => loadPlan(tx, tenantId, planPublicId));
  return withApplyView(db, tenantId, membership, resultFromPlan(finished, finishedRows));
}
