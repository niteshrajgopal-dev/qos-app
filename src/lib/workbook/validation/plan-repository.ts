import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { brands, workbookImportPlanRows, workbookImportPlans } from "@/db/schema";
import type { DbTransaction } from "@/lib/tenant/context";
import { WorkbookReviewError } from "@/lib/workbook/validation/errors";
import type {
  PlanAcknowledgement,
  PlanDecision,
  ReviewInput,
  ReviewRow,
  RowDecision,
  StoredPlanContext,
  WorkbookReview,
  WorkbookReviewResult,
} from "@/lib/workbook/validation/model";
import { type HashedRow, planHash } from "@/lib/workbook/validation/plan-hash";
import { REVIEW_ENGINE_VERSION, summarizeRows } from "@/lib/workbook/validation/review";

/* Persistence of review plans (QOS-194, decision D-PLAN). Every function
   runs inside the caller's tenant transaction (RLS). The plan tables are
   the only tables written by a review: no catalogue record, source link or
   audit event. Rows are revised in place on re-review, never deleted. */

type Tx = DbTransaction;

export type PlanRecord = typeof workbookImportPlans.$inferSelect;
export type PlanRowRecord = typeof workbookImportPlanRows.$inferSelect;

export type PlanActor = { subject: string; role: "administrator" | "user" };

const PLAN_PUBLIC_ID = /^wbp_[0-9a-f]{16}$/;

/** A plan id in the form QOS issues; anything else is answered as not found. */
export function isPlanPublicId(value: string) {
  return PLAN_PUBLIC_ID.test(value);
}

export function generatePlanPublicId() {
  return `wbp_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function hashedRows(rows: ReviewRow[]): HashedRow[] {
  return rows.map((row) => ({
    sheet: row.sheet,
    row: row.row,
    key: row.key,
    classification: row.classification,
    operation: row.operation,
    targetPublicId: row.identity.targetPublicId,
    targetRevision: row.identity.targetRevision,
    after: row.after,
    deferredFields: row.deferredFields,
  }));
}

export function rowDecisions(rows: ReviewRow[]): RowDecision[] {
  return rows.map((row) => row.decision).filter((decision): decision is RowDecision => decision !== null);
}

/** The plan hash for a review: what QOS-217 recomputes before apply. */
export function hashReview(
  review: WorkbookReview,
  meta: { snapshotHash: string; createdBy: PlanActor; reviewedBySubject: string },
) {
  const context = review.context;
  return planHash({
    engineVersion: REVIEW_ENGINE_VERSION,
    tenantPublicId: context.tenantPublicId,
    brandPublicId: context.brandPublicId,
    sourceNamespace: context.sourceNamespace,
    sourceProfile: context.profile,
    fileFingerprint: context.fileFingerprint,
    sourceFileSha256: context.sourceFileSha256 ?? null,
    createdBySubject: meta.createdBy.subject,
    createdByRole: meta.createdBy.role,
    reviewedBySubject: meta.reviewedBySubject,
    branchScope: context.branchScope,
    snapshotHash: meta.snapshotHash,
    rows: hashedRows(review.rows),
    decisions: [...rowDecisions(review.rows), ...review.acknowledgements.given],
  });
}

function storedContext(review: WorkbookReview, input: ReviewInput): StoredPlanContext {
  const { sheets, ...meta } = input;
  return {
    context: review.context,
    input: { ...meta, sheets: sheets.map(({ rows: _rows, ...sheet }) => (void _rows, sheet)) },
    fieldDecisions: review.fieldDecisions,
    sheets: review.sheets,
    notices: review.notices,
    acknowledgementsRequired: review.acknowledgements.required,
    readiness: review.readiness,
  };
}

/** Input cell values by sheet and row, stored so a re-review never needs the file again. */
function valuesIndex(input: ReviewInput) {
  const index = new Map<string, Record<string, string>>();
  for (const sheet of input.sheets) {
    for (const row of sheet.rows) index.set(`${sheet.sheet}\u0000${row.row}`, row.values);
  }
  return index;
}

const INSERT_CHUNK = 500;

function rowRecord(row: ReviewRow, values: Map<string, Record<string, string>>) {
  return {
    sheet: row.sheet,
    rowNumber: row.row,
    entityKey: row.key,
    requestedAction: row.requestedAction,
    classification: row.classification,
    operation: row.operation,
    targetPublicId: row.identity.targetPublicId,
    targetRevision: row.identity.targetRevision,
    values: values.get(`${row.sheet}\u0000${row.row}`) ?? {},
    before: row.before,
    after: row.after,
    changes: row.changes,
    deferredFields: row.deferredFields,
    diagnostics: row.diagnostics,
    dependencies: row.dependencies,
    detail: {
      identity: row.identity,
      label: row.label,
      ...(row.branch ? { branch: row.branch } : {}),
      ...(row.candidates ? { candidates: row.candidates } : {}),
      ...(row.acknowledgedCollision ? { acknowledgedCollision: true } : {}),
    },
    provenance: row.source ?? null,
    decision: row.decision,
  };
}

export async function findPlanByIdempotencyKey(tx: Tx, tenantId: string, idempotencyKey: string) {
  const [plan] = await tx
    .select()
    .from(workbookImportPlans)
    .where(and(eq(workbookImportPlans.tenantId, tenantId), eq(workbookImportPlans.idempotencyKey, idempotencyKey)))
    .limit(1);
  return plan ?? null;
}

export async function loadPlan(tx: Tx, tenantId: string, planPublicId: string) {
  const [plan] = await tx
    .select()
    .from(workbookImportPlans)
    .where(and(eq(workbookImportPlans.tenantId, tenantId), eq(workbookImportPlans.publicId, planPublicId)))
    .limit(1);
  if (!plan) {
    throw new WorkbookReviewError("plan_not_found", "Review plan not found.", 404);
  }
  const rows = await tx
    .select()
    .from(workbookImportPlanRows)
    .where(and(eq(workbookImportPlanRows.tenantId, tenantId), eq(workbookImportPlanRows.planId, plan.id)))
    .orderBy(asc(workbookImportPlanRows.sheet), asc(workbookImportPlanRows.rowNumber));
  return { plan, rows };
}

export async function insertPlan(
  tx: Tx,
  tenantId: string,
  input: {
    review: WorkbookReview;
    reviewInput: ReviewInput;
    snapshotHash: string;
    actor: PlanActor;
    idempotencyKey: string;
  },
) {
  const { review, reviewInput, actor } = input;
  const [brand] = await tx
    .select({ id: brands.id })
    .from(brands)
    .where(and(eq(brands.tenantId, tenantId), eq(brands.publicId, review.context.brandPublicId)))
    .limit(1);
  if (!brand) {
    throw new WorkbookReviewError("review_context_rejected", "The brand is not part of this business.", 409, { reason: "brand" });
  }
  const hash = hashReview(review, { snapshotHash: input.snapshotHash, createdBy: actor, reviewedBySubject: actor.subject });
  const [plan] = await tx
    .insert(workbookImportPlans)
    .values({
      tenantId,
      publicId: generatePlanPublicId(),
      revision: 1,
      status: "review_ready",
      sourceProfile: review.context.profile,
      templateVersion: review.context.templateVersion,
      dictionaryVersion: review.context.dictionaryVersion,
      brandId: brand.id,
      sourceNamespace: review.context.sourceNamespace,
      keysVerified: review.context.keysVerified,
      fileName: review.context.fileName,
      fileFingerprint: review.context.fileFingerprint,
      sourceFileSha256: review.context.sourceFileSha256 ?? null,
      exportRevision: review.context.exportRevision ?? null,
      snapshotHash: input.snapshotHash,
      planHash: hash,
      engineVersion: REVIEW_ENGINE_VERSION,
      createdBySubject: actor.subject,
      createdByRole: actor.role,
      reviewedBySubject: actor.subject,
      branchScope: review.context.branchScope,
      context: storedContext(review, reviewInput),
      counts: review.counts,
      decisions: review.acknowledgements.given,
      idempotencyKey: input.idempotencyKey,
    })
    .returning();
  const values = valuesIndex(reviewInput);
  for (let start = 0; start < review.rows.length; start += INSERT_CHUNK) {
    await tx
      .insert(workbookImportPlanRows)
      .values(review.rows.slice(start, start + INSERT_CHUNK).map((row) => ({ tenantId, planId: plan!.id, ...rowRecord(row, values) })));
  }
  return plan!;
}

/** Revises a plan in place after a re-review: same rows, new outcome, revision + 1. */
export async function revisePlan(
  tx: Tx,
  tenantId: string,
  plan: PlanRecord,
  input: { review: WorkbookReview; reviewInput: ReviewInput; snapshotHash: string; reviewedBySubject: string },
) {
  const { review, reviewInput } = input;
  const now = new Date();
  const hash = hashReview(review, {
    snapshotHash: input.snapshotHash,
    createdBy: { subject: plan.createdBySubject, role: plan.createdByRole },
    reviewedBySubject: input.reviewedBySubject,
  });
  const [updated] = await tx
    .update(workbookImportPlans)
    .set({
      revision: plan.revision + 1,
      status: "review_ready",
      snapshotHash: input.snapshotHash,
      planHash: hash,
      engineVersion: REVIEW_ENGINE_VERSION,
      reviewedBySubject: input.reviewedBySubject,
      branchScope: review.context.branchScope,
      context: storedContext(review, reviewInput),
      counts: review.counts,
      decisions: review.acknowledgements.given,
      reviewedAt: now,
      updatedAt: now,
    })
    .where(and(eq(workbookImportPlans.tenantId, tenantId), eq(workbookImportPlans.id, plan.id), eq(workbookImportPlans.revision, plan.revision)))
    .returning();
  if (!updated) {
    throw new WorkbookReviewError("plan_hash_mismatch", "The plan changed while it was being reviewed. Load it again.", 409);
  }
  const values = valuesIndex(reviewInput);
  for (const row of review.rows) {
    const { sheet, rowNumber, ...changes } = rowRecord(row, values);
    await tx
      .update(workbookImportPlanRows)
      .set({ ...changes, updatedAt: now })
      .where(
        and(
          eq(workbookImportPlanRows.tenantId, tenantId),
          eq(workbookImportPlanRows.planId, plan.id),
          eq(workbookImportPlanRows.sheet, sheet),
          eq(workbookImportPlanRows.rowNumber, rowNumber),
        ),
      );
  }
  return updated;
}

export async function markPlanStale(tx: Tx, tenantId: string, plan: PlanRecord) {
  await tx
    .update(workbookImportPlans)
    .set({ status: "stale", updatedAt: new Date() })
    .where(and(eq(workbookImportPlans.tenantId, tenantId), eq(workbookImportPlans.id, plan.id), eq(workbookImportPlans.status, "review_ready")));
}

/** Rebuilds the review input from a stored plan, so a re-review never needs the file again. */
export function inputFromPlan(plan: PlanRecord, rows: PlanRowRecord[]): ReviewInput {
  const meta = plan.context.input;
  return {
    ...meta,
    sheets: meta.sheets.map((sheet) => ({
      ...sheet,
      rows: rows
        .filter((row) => row.sheet === sheet.sheet)
        .sort((a, b) => a.rowNumber - b.rowNumber)
        .map((row) => ({ row: row.rowNumber, values: row.values, ...(row.provenance ? { source: row.provenance } : {}) })),
    })),
  };
}

export function storedDecisions(plan: PlanRecord, rows: PlanRowRecord[]): PlanDecision[] {
  return [...rows.map((row) => row.decision).filter((decision): decision is RowDecision => decision !== null), ...plan.decisions];
}

function reviewRowOf(row: PlanRowRecord): ReviewRow {
  return {
    sheet: row.sheet,
    row: row.rowNumber,
    key: row.entityKey,
    requestedAction: row.requestedAction,
    classification: row.classification,
    operation: row.operation,
    identity: row.detail.identity,
    label: row.detail.label,
    before: row.before,
    after: row.after,
    changes: row.changes,
    deferredFields: row.deferredFields,
    diagnostics: row.diagnostics,
    dependencies: row.dependencies,
    ...(row.detail.branch ? { branch: row.detail.branch } : {}),
    ...(row.detail.candidates ? { candidates: row.detail.candidates } : {}),
    ...(row.detail.acknowledgedCollision ? { acknowledgedCollision: true } : {}),
    decision: row.decision,
    ...(row.provenance ? { source: row.provenance } : {}),
  };
}

/** The API result for a stored plan. Counts and readiness are recomputed from the stored rows. */
export function resultFromPlan(plan: PlanRecord, rows: PlanRowRecord[], extra: { stale?: boolean; replayed?: boolean } = {}): WorkbookReviewResult {
  const reviewRows = rows.map(reviewRowOf);
  const stale = extra.stale ?? plan.status === "stale";
  const given: PlanAcknowledgement[] = plan.decisions;
  const summary = summarizeRows(reviewRows, given, stale);
  const status = stale ? "stale" : plan.status;
  return {
    plan: {
      publicId: plan.publicId,
      revision: plan.revision,
      status,
      planHash: plan.planHash,
      snapshotHash: plan.snapshotHash,
      engineVersion: plan.engineVersion,
      createdAt: plan.createdAt.toISOString(),
      reviewedAt: plan.reviewedAt.toISOString(),
      createdBySubject: plan.createdBySubject,
    },
    context: plan.context.context,
    counts: summary.counts,
    sheets: plan.context.sheets,
    fieldDecisions: plan.context.fieldDecisions,
    parseIssues: plan.context.input.parseIssues,
    notices: plan.context.notices,
    rows: reviewRows,
    acknowledgements: { required: summary.required, given: summary.given },
    readiness: summary.readiness,
    stale,
    ...(extra.replayed ? { replayed: true } : {}),
  };
}
