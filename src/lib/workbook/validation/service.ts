import { createHash } from "node:crypto";

import { z } from "zod";

import type { DbClient } from "@/db/client";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { loadWorkbookTenantIdentity, resolveWorkbookBrand, WorkbookExportError } from "@/lib/workbook/export";
import { assertConvertible } from "@/lib/workbook/foodics-menu/convert";
import { parseWorkbookUpload } from "@/lib/workbook/reader";
import { WorkbookReviewError } from "@/lib/workbook/validation/errors";
import { toReviewInput } from "@/lib/workbook/validation/input";
import type { PlanDecision, WorkbookReviewResult } from "@/lib/workbook/validation/model";
import {
  findPlanByIdempotencyKey,
  inputFromPlan,
  insertPlan,
  loadPlan,
  markPlanStale,
  resultFromPlan,
  revisePlan,
} from "@/lib/workbook/validation/plan-repository";
import { reviewWorkbook } from "@/lib/workbook/validation/review";
import {
  buildReviewSnapshot,
  loadSnapshotSource,
  restrictSourceToScope,
  snapshotHashOf,
} from "@/lib/workbook/validation/snapshot";

/* Workbook review service (QOS-194): parse → normalised input → snapshot →
   review → persisted plan. The plan tables are the only writes; nothing
   here creates, changes or links a catalogue record, and no audit event is
   recorded for a review (decision D-PERSIST). */

const rowAddress = { sheet: z.string().min(1).max(64), row: z.number().int().min(1), key: z.string().max(512).optional() };

const decisionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("match_existing"), ...rowAddress, targetPublicId: z.string().min(1).max(128) }),
  z.object({ kind: z.literal("create_new"), ...rowAddress }),
  z.object({ kind: z.literal("use_linked_record"), ...rowAddress }),
  z.object({ kind: z.literal("accept_current_revision"), ...rowAddress }),
  z.object({ kind: z.literal("exclude"), ...rowAddress }),
  z.object({ kind: z.literal("acknowledge_deferred"), sheet: z.string().min(1).max(64), column: z.string().min(1).max(128) }),
  z.object({ kind: z.literal("acknowledge_warnings") }),
  z.object({ kind: z.literal("acknowledge_partial_apply") }),
]);

const MAX_DECISIONS = 20_000;

/** Decisions from a client, checked for shape only; whether each one applies is the review's call. */
export function parseDecisions(raw: unknown): PlanDecision[] {
  const parsed = z.array(decisionSchema).max(MAX_DECISIONS).safeParse(raw);
  if (!parsed.success) {
    throw new WorkbookReviewError("decisions_invalid", "Review decisions are not in the expected form.", 400);
  }
  return parsed.data as PlanDecision[];
}

export function parseDecisionsField(text: string | null) {
  if (!text) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkbookReviewError("decisions_invalid", "Review decisions are not valid JSON.", 400);
  }
  return parseDecisions(raw);
}

function isUniqueViolation(error: unknown) {
  const candidate = error as { code?: string; cause?: { code?: string } } | null;
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

export type PreviewUpload = {
  fileName: string;
  bytes: Buffer;
  brand: string | null;
  branch: string | null;
  decisions: PlanDecision[];
};

async function replayOrRefuse(db: DbClient, tenantId: string, idempotencyKey: string, fingerprint: string) {
  const existing = await withTenantContext(db, tenantId, async (tx) => {
    const plan = await findPlanByIdempotencyKey(tx, tenantId, idempotencyKey);
    return plan ? loadPlan(tx, tenantId, plan.publicId) : null;
  });
  if (!existing) return null;
  if (existing.plan.fileFingerprint !== fingerprint) {
    throw new WorkbookReviewError("idempotency_key_reused", "This idempotency key was used for a different file.", 409);
  }
  return resultFromPlan(existing.plan, existing.rows, { replayed: true });
}

/**
 * Reviews an upload against the tenant's records and stores the plan. A
 * replay of the same key and file returns the stored plan; the same key with
 * another file is refused. Context that names another business is refused
 * before anything is stored.
 */
export async function previewWorkbook(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  subject: string,
  upload: PreviewUpload,
  idempotencyKey: string,
): Promise<WorkbookReviewResult> {
  const fingerprint = createHash("sha256").update(upload.bytes).digest("hex");
  const replay = await replayOrRefuse(db, tenantId, idempotencyKey, fingerprint);
  if (replay) return replay;

  const tenant = await loadWorkbookTenantIdentity(db, tenantId);
  const requestedBrand = resolveWorkbookBrand(tenant, upload.brand);
  const result = await parseWorkbookUpload(
    { fileName: upload.fileName, bytes: upload.bytes },
    {
      tenantPublicId: tenant.tenantPublicId,
      brandPublicIds: tenant.brandPublicIds,
      tenantCurrency: tenant.baseCurrency,
      brandPublicId: requestedBrand,
      brandChoices: tenant.brands,
    },
  );
  if (result.profile === "foodics_menu_v1") {
    assertConvertible(result);
  }
  let brand = requestedBrand;
  if (!brand && result.profile === "qos_extended_v1" && tenant.brandPublicIds.includes(result.manifest.brand_public_id)) {
    brand = result.manifest.brand_public_id;
  }
  if (!brand && result.profile !== "legacy_flat") {
    if (tenant.brands.length === 0) {
      throw new WorkbookExportError("no_brand", "This business has no brand.", 409);
    }
    throw new WorkbookExportError("brand_required", "Choose the brand for this workbook.", 400, { brands: tenant.brands });
  }

  const input = toReviewInput(result, {
    tenantPublicId: tenant.tenantPublicId ?? "",
    brandPublicId: brand ?? "",
    currency: tenant.baseCurrency ?? "",
  });
  const snapshot = buildReviewSnapshot(
    await loadSnapshotSource(db, tenantId, membership, { brand: brand!, branch: upload.branch, sourceNamespace: input.sourceNamespace }),
  );
  const review = reviewWorkbook(input, snapshot, upload.decisions);

  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const plan = await insertPlan(tx, tenantId, {
        review,
        reviewInput: input,
        snapshotHash: snapshot.snapshotHash,
        actor: { subject, role: membership.role },
        idempotencyKey,
      });
      const stored = await loadPlan(tx, tenantId, plan.publicId);
      return resultFromPlan(stored.plan, stored.rows, { stale: false });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const raced = await replayOrRefuse(db, tenantId, idempotencyKey, fingerprint);
      if (raced) return raced;
    }
    throw error;
  }
}

/**
 * A stored plan, checked against the current records in the plan's own
 * branch scope. A changed record makes the plan stale (the only write on
 * read); a viewer who cannot see that whole scope gets the stored status.
 */
export async function getWorkbookPlan(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  planPublicId: string,
): Promise<WorkbookReviewResult> {
  const { plan, rows } = await withTenantContext(db, tenantId, (tx) => loadPlan(tx, tenantId, planPublicId));
  const source = await loadSnapshotSource(db, tenantId, membership, {
    brand: plan.context.context.brandPublicId,
    sourceNamespace: plan.sourceNamespace,
  });
  const scoped = restrictSourceToScope(source, plan.branchScope);
  let stale = plan.status === "stale";
  if (scoped && snapshotHashOf(scoped) !== plan.snapshotHash) {
    stale = true;
    if (plan.status === "review_ready") {
      await withTenantContext(db, tenantId, (tx) => markPlanStale(tx, tenantId, plan));
    }
  }
  return resultFromPlan(plan, rows, { stale });
}

export type ReReviewRequest = { expectedPlanHash: string; decisions: PlanDecision[] };

export function parseReReviewBody(raw: unknown): ReReviewRequest {
  const body = raw as { expectedPlanHash?: unknown; decisions?: unknown } | null;
  if (!body || typeof body.expectedPlanHash !== "string" || !body.expectedPlanHash) {
    throw new WorkbookReviewError("decisions_invalid", "expectedPlanHash is required.", 400);
  }
  return { expectedPlanHash: body.expectedPlanHash, decisions: parseDecisions(body.decisions ?? []) };
}

/**
 * Re-runs the review of a stored plan with new decisions against the current
 * records. Only the plan's creator or an administrator may do this, and only
 * from the plan hash they last saw.
 */
export async function reReviewWorkbookPlan(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  subject: string,
  planPublicId: string,
  request: ReReviewRequest,
): Promise<WorkbookReviewResult> {
  const { plan, rows } = await withTenantContext(db, tenantId, (tx) => loadPlan(tx, tenantId, planPublicId));
  if (membership.role !== "administrator" && plan.createdBySubject !== subject) {
    throw new WorkbookReviewError("plan_not_yours", "Only the person who created this review or an administrator can change it.", 403);
  }
  if (request.expectedPlanHash !== plan.planHash) {
    throw new WorkbookReviewError("plan_hash_mismatch", "This review changed since you loaded it. Load it again.", 409);
  }
  const source = await loadSnapshotSource(db, tenantId, membership, {
    brand: plan.context.context.brandPublicId,
    sourceNamespace: plan.sourceNamespace,
  });
  const snapshot = buildReviewSnapshot(restrictSourceToScope(source, plan.branchScope) ?? source);
  const input = inputFromPlan(plan, rows);
  const review = reviewWorkbook(input, snapshot, request.decisions);

  return withTenantContext(db, tenantId, async (tx) => {
    await revisePlan(tx, tenantId, plan, { review, reviewInput: input, snapshotHash: snapshot.snapshotHash, reviewedBySubject: subject });
    const stored = await loadPlan(tx, tenantId, planPublicId);
    return resultFromPlan(stored.plan, stored.rows, { stale: false });
  });
}

/** A stored plan for its correction report. Read only. */
export async function loadWorkbookPlanForReport(db: DbClient, tenantId: string, planPublicId: string) {
  const { plan, rows } = await withTenantContext(db, tenantId, (tx) => loadPlan(tx, tenantId, planPublicId));
  return resultFromPlan(plan, rows);
}
