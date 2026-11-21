import { randomUUID } from "node:crypto";

import { and, desc, eq, inArray } from "drizzle-orm";

import { workbookImportApplies, workbookImportPlanRows, workbookImportPlans } from "@/db/schema";
import type { DbTransaction } from "@/lib/tenant/context";
import { type ApplyActor, recordApplyAttemptAuditInTx } from "@/lib/workbook/apply/audit";
import { WorkbookApplyError } from "@/lib/workbook/apply/errors";
import type {
  ApplyAttempt,
  ApplyCounts,
  ApplyFailure,
  ApplyStatus,
  ApplySummary,
  RowApplyOutcome,
  RowApplyResult,
  RowApplyState,
} from "@/lib/workbook/apply/model";
import type { PlanRecord, PlanRowRecord } from "@/lib/workbook/validation/plan-repository";

/* Persistence of workbook applies (QOS-217, migration 0058). Every function
   runs inside the caller's tenant transaction (RLS). Attempts are history:
   they are finished or marked interrupted, never deleted. Plan rows keep the
   outcome of the latest attempt that touched them. */

type Tx = DbTransaction;

export type ApplyRecord = typeof workbookImportApplies.$inferSelect;

/** An attempt whose heartbeat is older than this is treated as interrupted (process restart). */
export const APPLY_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

export function generateApplyPublicId() {
  return `wba_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export const EMPTY_COUNTS: ApplyCounts = { applied: 0, alreadyApplied: 0, failed: 0, notApplied: 0, deferredValues: 0 };

export function attemptView(record: ApplyRecord): ApplyAttempt {
  return {
    publicId: record.publicId,
    status: record.status,
    actorSubject: record.actorSubject,
    actorRole: record.actorRole,
    planRevision: record.planRevision,
    planHash: record.planHash,
    startedAt: record.startedAt.toISOString(),
    finishedAt: record.finishedAt ? record.finishedAt.toISOString() : null,
    counts: { ...EMPTY_COUNTS, ...record.counts },
    summary: record.summary,
  };
}

export async function findApplyByIdempotencyKey(tx: Tx, tenantId: string, idempotencyKey: string) {
  const [record] = await tx
    .select()
    .from(workbookImportApplies)
    .where(and(eq(workbookImportApplies.tenantId, tenantId), eq(workbookImportApplies.idempotencyKey, idempotencyKey)))
    .limit(1);
  return record ?? null;
}

/** Attempts of a plan, newest first. */
export async function listApplies(tx: Tx, tenantId: string, planId: string) {
  return tx
    .select()
    .from(workbookImportApplies)
    .where(and(eq(workbookImportApplies.tenantId, tenantId), eq(workbookImportApplies.planId, planId)))
    .orderBy(desc(workbookImportApplies.startedAt));
}

export async function runningApply(tx: Tx, tenantId: string, planId: string) {
  const [record] = await tx
    .select()
    .from(workbookImportApplies)
    .where(and(eq(workbookImportApplies.tenantId, tenantId), eq(workbookImportApplies.planId, planId), eq(workbookImportApplies.status, "applying")))
    .limit(1);
  return record ?? null;
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

/**
 * Starts an attempt: inserts it as `applying` and flips the plan from
 * `review_ready` to `applying` at the revision that was checked. A second
 * apply racing for the same plan loses on the partial unique index or on the
 * guarded update and gets 409 `apply_in_progress`.
 */
export async function startAttempt(
  tx: Tx,
  input: {
    tenantId: string;
    plan: PlanRecord;
    idempotencyKey: string;
    snapshotHash: string;
    engineVersion: string;
    actor: ApplyActor;
  },
) {
  const { plan } = input;
  let record: ApplyRecord;
  try {
    [record] = (await tx
      .insert(workbookImportApplies)
      .values({
        tenantId: input.tenantId,
        planId: plan.id,
        publicId: generateApplyPublicId(),
        status: "applying",
        idempotencyKey: input.idempotencyKey,
        planRevision: plan.revision,
        planHash: plan.planHash,
        snapshotHash: input.snapshotHash,
        engineVersion: input.engineVersion,
        sourceProfile: plan.sourceProfile,
        sourceNamespace: plan.sourceNamespace,
        templateVersion: plan.templateVersion,
        dictionaryVersion: plan.dictionaryVersion,
        branchScope: plan.branchScope,
        actorSubject: input.actor.subject,
        actorRole: input.actor.role,
      })
      .returning()) as [ApplyRecord];
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new WorkbookApplyError("apply_in_progress", "This plan is already being applied.", 409);
    }
    throw error;
  }
  const [locked] = await tx
    .update(workbookImportPlans)
    .set({ status: "applying", updatedAt: new Date() })
    .where(
      and(
        eq(workbookImportPlans.tenantId, input.tenantId),
        eq(workbookImportPlans.id, plan.id),
        eq(workbookImportPlans.status, "review_ready"),
        eq(workbookImportPlans.revision, plan.revision),
      ),
    )
    .returning({ id: workbookImportPlans.id });
  if (!locked) {
    throw new WorkbookApplyError("apply_in_progress", "This plan changed or is already being applied. Load it again.", 409);
  }
  await recordApplyAttemptAuditInTx(tx, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "start",
    planPublicId: plan.publicId,
    planRevision: plan.revision,
    applyPublicId: record.publicId,
  });
  return record;
}

export async function heartbeat(tx: Tx, tenantId: string, applyId: string, counts: ApplyCounts) {
  await tx
    .update(workbookImportApplies)
    .set({ heartbeatAt: new Date(), counts, updatedAt: new Date() })
    .where(and(eq(workbookImportApplies.tenantId, tenantId), eq(workbookImportApplies.id, applyId), eq(workbookImportApplies.status, "applying")));
}

/** Plan rows of a unit, locked for the unit's transaction. */
export async function lockPlanRows(tx: Tx, tenantId: string, rowIds: string[]) {
  return tx
    .select()
    .from(workbookImportPlanRows)
    .where(and(eq(workbookImportPlanRows.tenantId, tenantId), inArray(workbookImportPlanRows.id, rowIds)))
    .for("update");
}

export async function writeRowOutcome(
  tx: Tx,
  tenantId: string,
  rowId: string,
  outcome: { state: RowApplyState; applyId: string; appliedPublicId?: string | null; error?: ApplyFailure | null; result: RowApplyResult; applied?: boolean },
) {
  const now = new Date();
  await tx
    .update(workbookImportPlanRows)
    .set({
      applyState: outcome.state,
      applyId: outcome.applyId,
      applyError: outcome.error ?? null,
      applyResult: outcome.result,
      ...(outcome.applied ? { appliedPublicId: outcome.appliedPublicId ?? null, appliedAt: now } : {}),
      updatedAt: now,
    })
    .where(and(eq(workbookImportPlanRows.tenantId, tenantId), eq(workbookImportPlanRows.id, rowId)));
}

/** Adds the image outcome to a saved row (after the unit committed). */
export async function writeRowImage(tx: Tx, tenantId: string, rowId: string, result: RowApplyResult) {
  await tx
    .update(workbookImportPlanRows)
    .set({ applyResult: result, updatedAt: new Date() })
    .where(and(eq(workbookImportPlanRows.tenantId, tenantId), eq(workbookImportPlanRows.id, rowId)));
}

/** Ends an attempt and moves the plan to `applied` (no failure) or `apply_failed`. */
export async function finishAttempt(
  tx: Tx,
  input: {
    tenantId: string;
    plan: PlanRecord;
    apply: ApplyRecord;
    actor: ApplyActor;
    counts: ApplyCounts;
    summary: ApplySummary;
  },
) {
  const status: ApplyStatus = input.counts.failed === 0 ? "completed" : "failed";
  const now = new Date();
  await tx
    .update(workbookImportApplies)
    .set({ status, counts: input.counts, summary: input.summary, finishedAt: now, heartbeatAt: now, updatedAt: now })
    .where(and(eq(workbookImportApplies.tenantId, input.tenantId), eq(workbookImportApplies.id, input.apply.id)));
  await tx
    .update(workbookImportPlans)
    .set({ status: status === "completed" ? "applied" : "apply_failed", updatedAt: now })
    .where(and(eq(workbookImportPlans.tenantId, input.tenantId), eq(workbookImportPlans.id, input.plan.id), eq(workbookImportPlans.status, "applying")));
  await recordApplyAttemptAuditInTx(tx, {
    tenantId: input.tenantId,
    actor: input.actor,
    action: "finish",
    planPublicId: input.plan.publicId,
    planRevision: input.plan.revision,
    applyPublicId: input.apply.publicId,
    status,
    counts: input.counts,
  });
  return status;
}

/**
 * Read-repair of an attempt that stopped without finishing (process
 * restart): once its heartbeat is older than the timeout it is marked
 * `interrupted` and the plan `apply_failed`. Rows already checkpointed as
 * applied stay applied; nothing is re-run blindly. Returns true when the
 * plan was repaired.
 */
export async function repairInterruptedApply(tx: Tx, tenantId: string, plan: PlanRecord, now = new Date()) {
  if (plan.status !== "applying") return false;
  const running = await runningApply(tx, tenantId, plan.id);
  if (running && now.getTime() - running.heartbeatAt.getTime() < APPLY_LOCK_TIMEOUT_MS) return false;
  if (running) {
    await tx
      .update(workbookImportApplies)
      .set({ status: "interrupted", finishedAt: now, updatedAt: now })
      .where(and(eq(workbookImportApplies.tenantId, tenantId), eq(workbookImportApplies.id, running.id), eq(workbookImportApplies.status, "applying")));
  }
  const [repaired] = await tx
    .update(workbookImportPlans)
    .set({ status: "apply_failed", updatedAt: now })
    .where(and(eq(workbookImportPlans.tenantId, tenantId), eq(workbookImportPlans.id, plan.id), eq(workbookImportPlans.status, "applying")))
    .returning({ id: workbookImportPlans.id });
  if (repaired && running) {
    await recordApplyAttemptAuditInTx(tx, {
      tenantId,
      actor: { subject: running.actorSubject, role: running.actorRole },
      action: "interrupted",
      planPublicId: plan.publicId,
      planRevision: plan.revision,
      applyPublicId: running.publicId,
      status: "interrupted",
    });
  }
  return Boolean(repaired);
}

/** The latest outcome of each row, keyed by `sheet\u0000row`, for the API result. */
export function rowOutcomes(rows: PlanRowRecord[], applies: ApplyRecord[]) {
  const publicIds = new Map(applies.map((record) => [record.id, record.publicId]));
  const outcomes = new Map<string, RowApplyOutcome>();
  for (const row of rows) {
    if (!row.applyState) continue;
    outcomes.set(`${row.sheet}\u0000${row.rowNumber}`, {
      state: row.applyState,
      appliedPublicId: row.appliedPublicId,
      appliedAt: row.appliedAt ? row.appliedAt.toISOString() : null,
      applyPublicId: row.applyId ? (publicIds.get(row.applyId) ?? null) : null,
      error: row.applyError,
      result: row.applyResult,
    });
  }
  return outcomes;
}
