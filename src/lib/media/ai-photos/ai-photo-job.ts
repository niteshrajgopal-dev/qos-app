import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { aiJobs, aiSpendReservations, catalogueMediaAssets, catalogueMediaUploadGrants, catalogueProducts } from "@/db/schema";
import { AiJobLeaseLostError, lockLeasedAiJobInTx, type AiJobStepResult, type ClaimedAiJob } from "@/lib/ai/jobs/ai-job-queue";
import type { AiJobHandler, AiJobStepContext } from "@/lib/ai/jobs/ai-worker";
import { permitsAutomaticResubmission, type ProviderOutcome } from "@/lib/ai/provider-outcome";
import {
  AiSpendStateError,
  markAiSpendDispatched,
  recordAiSpendOutcome,
  releaseUnstartedAiSpend,
  type AiSpendOutcome,
  type AiSpendReportedUsage,
  type AiSpendReservation,
} from "@/lib/ai/spend/spend-admission";
import { assertMenuLocationAccess, MenuError } from "@/lib/catalogue/menus";
import {
  AI_PHOTO_JOB_KIND,
  AI_PHOTO_SPEND_PATH,
  AI_PHOTO_SPEND_SUBJECT,
  failAiPhotoAssetInTx,
  metadataOf,
  normalizeGeneratedImage,
  NOT_STARTED_IN_TIME_MESSAGE,
  providerFailure,
  recordAiPhotoCompletionInTx,
  type AiPhotoFailure,
} from "@/lib/media/ai-photos/ai-photo-candidates";
import { aiPhotoUnavailableReason, readAiPhotoConfig, type AiPhotoConfig } from "@/lib/media/ai-photos/config";
import {
  AiPhotoProviderError,
  getAiPhotoProvider,
  hasAiPhotoProviderOverride,
  type AiPhotoProvider,
  type AiPhotoUsage,
} from "@/lib/media/ai-photos/provider";
import { readMediaConfig } from "@/lib/media/config";
import { ingestProductImageUpload } from "@/lib/media/product-images";
import { requireActiveStaffMembership, StaffAuthorizationError } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { assertTenantActive, TenantInactiveError } from "@/lib/tenant/tenant-status";

const WORKER_ACTOR = { subject: "qos.ai-worker", actorClass: "system" as const };

export type AiPhotoRetryPolicy = {
  /** Total claims, the first included, that may dispatch the same request. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** A provider asking to wait longer than this is treated as a final refusal. */
  maxRetryAfterMs: number;
};

export const DEFAULT_AI_PHOTO_RETRY_POLICY: AiPhotoRetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 30_000,
  maxDelayMs: 5 * 60_000,
  maxRetryAfterMs: 15 * 60_000,
};

/**
 * Delay before the next attempt, or null when no attempt is left. Exponential
 * with jitter, never shorter than what the provider asked for.
 */
export function aiPhotoRetryDelayMs(
  attemptNumber: number,
  retryAfterMs: number | null,
  policy: AiPhotoRetryPolicy = DEFAULT_AI_PHOTO_RETRY_POLICY,
  random: () => number = Math.random,
) {
  if (attemptNumber >= policy.maxAttempts) {
    return null;
  }
  if (retryAfterMs !== null && retryAfterMs > policy.maxRetryAfterMs) {
    return null;
  }
  const backoff = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** Math.max(0, attemptNumber - 1));
  const jittered = Math.round(backoff * (0.8 + 0.4 * random()));
  return Math.max(jittered, retryAfterMs ?? 0);
}

function reportedUsage(usage: AiPhotoUsage | null): AiSpendReportedUsage | null {
  if (!usage) {
    return null;
  }
  const entries = Object.entries({
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    total_tokens: usage.totalTokens,
  }).filter((entry): entry is [string, number] => Number.isInteger(entry[1]) && entry[1]! >= 0);
  return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function spendOutcome(outcome: ProviderOutcome): AiSpendOutcome {
  // A failed read of a known result still means the work was done.
  return outcome === "read_failed" ? "failed_after_processing" : outcome;
}

type HandlerOptions = {
  config?: AiPhotoConfig;
  /** Tests inject a fake; production resolves the configured provider. */
  provider?: AiPhotoProvider;
  now?: () => Date;
  retry?: AiPhotoRetryPolicy;
  random?: () => number;
};

type LoadedRequest = {
  asset: typeof catalogueMediaAssets.$inferSelect;
  productPublicId: string;
  productArchived: boolean;
  grantToken: string | null;
  reservation: AiSpendReservation | null;
};

/**
 * Generates queued AI photos, one provider attempt per step. Every check the
 * synchronous path makes is repeated against live state, spend and job
 * dispatch evidence are committed before the provider is contacted, and only
 * failures that prove nothing was generated are retried. Anything uncertain
 * goes to operator review and keeps its spend counted.
 */
export function createAiPhotoJobHandler(db: DbClient, options: HandlerOptions = {}): AiJobHandler {
  const clock = options.now ?? (() => new Date());
  const retry = options.retry ?? DEFAULT_AI_PHOTO_RETRY_POLICY;

  async function load(job: ClaimedAiJob): Promise<LoadedRequest | null> {
    return withTenantContext(db, job.tenantId, async (tx) => {
      const [row] = await tx
        .select({ asset: catalogueMediaAssets, productPublicId: catalogueProducts.publicId, productStatus: catalogueProducts.status })
        .from(aiJobs)
        .innerJoin(
          catalogueMediaAssets,
          and(eq(catalogueMediaAssets.tenantId, aiJobs.tenantId), eq(catalogueMediaAssets.id, aiJobs.mediaAssetId)),
        )
        .innerJoin(
          catalogueProducts,
          and(eq(catalogueProducts.tenantId, catalogueMediaAssets.tenantId), eq(catalogueProducts.id, catalogueMediaAssets.productId)),
        )
        .where(and(eq(aiJobs.tenantId, job.tenantId), eq(aiJobs.id, job.jobId)))
        .limit(1);
      if (!row) {
        return null;
      }
      const [grant] = await tx
        .select({ grantToken: catalogueMediaUploadGrants.grantToken })
        .from(catalogueMediaUploadGrants)
        .where(
          and(
            eq(catalogueMediaUploadGrants.tenantId, job.tenantId),
            eq(catalogueMediaUploadGrants.assetId, row.asset.id),
            eq(catalogueMediaUploadGrants.status, "pending"),
          ),
        )
        .limit(1);
      const [reservation] = await tx
        .select()
        .from(aiSpendReservations)
        .where(
          and(
            eq(aiSpendReservations.tenantId, job.tenantId),
            eq(aiSpendReservations.path, AI_PHOTO_SPEND_PATH),
            eq(aiSpendReservations.subjectType, AI_PHOTO_SPEND_SUBJECT),
            eq(aiSpendReservations.subjectPublicId, row.asset.publicId),
          ),
        )
        .limit(1);
      return {
        asset: row.asset,
        productPublicId: row.productPublicId,
        productArchived: row.productStatus === "archived",
        grantToken: grant?.grantToken ?? null,
        reservation: reservation ?? null,
      };
    });
  }

  /** Fails the asset and settles its spend in one transaction fenced by the lease. */
  async function settle(
    job: ClaimedAiJob,
    request: LoadedRequest,
    failure: AiPhotoFailure,
    spend: AiSpendOutcome | "release_unstarted" | "none",
  ) {
    await withTenantContext(db, job.tenantId, async (tx) => {
      await lockLeasedAiJobInTx(tx, job);
      await failAiPhotoAssetInTx(tx, job.tenantId, request.asset.id, failure, WORKER_ACTOR);
      const reservation = request.reservation;
      if (!reservation || spend === "none") {
        return;
      }
      const [live] = await tx
        .select({ state: aiSpendReservations.state, dispatchedAt: aiSpendReservations.dispatchedAt })
        .from(aiSpendReservations)
        .where(eq(aiSpendReservations.id, reservation.id))
        .limit(1)
        .for("update");
      if (live?.state !== "reserved") {
        return;
      }
      const tenantId = job.tenantId;
      const reservationPublicId = reservation.publicId;
      if (!live.dispatchedAt) {
        await releaseUnstartedAiSpend(tx, { tenantId, reservationPublicId, now: clock() });
        return;
      }
      // A rescheduled request was already marked dispatched, so "not sent this
      // time" settles as not_dispatched rather than an unstarted release.
      const outcome: AiSpendOutcome = spend === "release_unstarted" ? "not_dispatched" : spend;
      await recordAiSpendOutcome(tx, { tenantId, reservationPublicId, outcome, actor: WORKER_ACTOR, now: clock() });
    });
  }

  async function notSent(job: ClaimedAiJob, request: LoadedRequest, failureCode: string, message: string): Promise<AiJobStepResult> {
    await settle(job, request, { failureCode, message, providerOutcome: "not_dispatched" }, "release_unstarted");
    return { type: "failed", code: failureCode, message, providerOutcome: "not_dispatched" };
  }

  /** A stored candidate whose spend was never settled (the worker died after storing it). */
  async function settleStored(job: ClaimedAiJob, request: LoadedRequest) {
    const reservation = request.reservation;
    if (request.asset.status !== "uploaded" || reservation?.state !== "reserved" || !reservation.dispatchedAt) {
      return;
    }
    await withTenantContext(db, job.tenantId, async (tx) => {
      await lockLeasedAiJobInTx(tx, job);
      if (!metadataOf(request.asset).completedAt) {
        await recordAiPhotoCompletionInTx(tx, job.tenantId, request.asset.id, { usage: null, completedAt: clock() });
      }
      await recordAiSpendOutcome(tx, {
        tenantId: job.tenantId,
        reservationPublicId: reservation.publicId,
        outcome: "completed",
        actor: WORKER_ACTOR,
        now: clock(),
      });
    });
  }

  /** Live checks before any spend: the requester, the menu and the item must all still allow it. */
  async function blockedBy(job: ClaimedAiJob, request: LoadedRequest, config: AiPhotoConfig) {
    const workerConfig: AiPhotoConfig = { ...config, executionMode: "sync" };
    if (aiPhotoUnavailableReason(workerConfig, { providerOverride: Boolean(options.provider) || hasAiPhotoProviderOverride() })) {
      return { code: "ai_photos_unavailable", message: "AI photos were switched off before this photo was generated." };
    }
    const metadata = metadataOf(request.asset);
    try {
      await withTenantContext(db, job.tenantId, (tx) => assertTenantActive(tx, job.tenantId));
      const membership = await requireActiveStaffMembership(db, job.tenantId, metadata.requestedBySubject ?? "");
      if (membership.role !== "administrator") {
        throw new StaffAuthorizationError("Only administrators can generate AI photos.");
      }
      await withTenantContext(db, job.tenantId, (tx) =>
        assertMenuLocationAccess(tx, job.tenantId, membership, metadata.menuPublicId ?? ""),
      );
    } catch (error) {
      if (error instanceof TenantInactiveError) {
        return { code: "tenant_inactive", message: "This business is not active." };
      }
      if (error instanceof StaffAuthorizationError || error instanceof MenuError) {
        return { code: "requester_access_revoked", message: "The person who asked for this photo no longer has access." };
      }
      throw error;
    }
    if (request.productArchived) {
      return { code: "product_unavailable", message: "This item was archived before its photo was generated." };
    }
    return null;
  }

  /**
   * Commits spend dispatch, refreshes the upload grant so a long queue wait
   * cannot expire it, then commits job dispatch evidence. Null when the
   * request can no longer start.
   */
  async function beginDispatch(job: ClaimedAiJob, context: AiJobStepContext, request: LoadedRequest, config: AiPhotoConfig) {
    if (context.leaseLost()) {
      throw new AiJobLeaseLostError(job.jobPublicId);
    }
    const ttlMs = Math.max(readMediaConfig().grantTtlSeconds * 1000, config.requestTimeoutMs + 10 * 60_000);
    try {
      const ready = await withTenantContext(db, job.tenantId, async (tx) => {
        await lockLeasedAiJobInTx(tx, job);
        const refreshed = await tx
          .update(catalogueMediaUploadGrants)
          .set({ expiresAt: new Date(clock().getTime() + ttlMs) })
          .where(
            and(
              eq(catalogueMediaUploadGrants.tenantId, job.tenantId),
              eq(catalogueMediaUploadGrants.assetId, request.asset.id),
              eq(catalogueMediaUploadGrants.status, "pending"),
            ),
          )
          .returning({ id: catalogueMediaUploadGrants.id });
        if (refreshed.length === 0 || !request.reservation) {
          return false;
        }
        await markAiSpendDispatched(tx, { tenantId: job.tenantId, reservationPublicId: request.reservation.publicId, now: clock() });
        return true;
      });
      if (!ready) {
        return false;
      }
    } catch (error) {
      if (error instanceof AiSpendStateError) {
        return false;
      }
      throw error;
    }
    await context.markDispatched();
    return true;
  }

  async function ingest(job: ClaimedAiJob, request: LoadedRequest, bytes: Buffer) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await ingestProductImageUpload(db, job.tenantId, request.productPublicId, request.grantToken!, bytes);
        return true;
      } catch (error) {
        lastError = error;
      }
    }
    console.warn("AI photo storage failed", {
      tenantId: job.tenantId,
      assetPublicId: request.asset.publicId,
      message: lastError instanceof Error ? lastError.message : "unknown",
    });
    return false;
  }

  async function onProviderFailure(job: ClaimedAiJob, request: LoadedRequest, error: unknown): Promise<AiJobStepResult> {
    const failure = providerFailure(error);
    const outcome = failure.providerOutcome;
    if (error instanceof AiPhotoProviderError && permitsAutomaticResubmission(error.classification)) {
      const delayMs = aiPhotoRetryDelayMs(job.attemptNumber, error.classification.retryAfterMs, retry, options.random);
      if (delayMs !== null) {
        return { type: "reschedule", delayMs, providerOutcome: outcome, code: failure.failureCode };
      }
    }
    console.warn("AI photo generation failed", {
      tenantId: job.tenantId,
      assetPublicId: request.asset.publicId,
      failureCode: failure.failureCode,
      providerOutcome: outcome,
      ...failure.providerDiagnostics,
    });
    await settle(job, request, failure, spendOutcome(outcome));
    if (outcome === "submission_unknown") {
      return { type: "operator_review", code: failure.failureCode, message: failure.message, providerOutcome: outcome };
    }
    return { type: "failed", code: failure.failureCode, message: failure.message, providerOutcome: outcome };
  }

  return {
    kind: AI_PHOTO_JOB_KIND,
    async step(job, context) {
      const config = options.config ?? readAiPhotoConfig();
      const request = await load(job);
      if (!request) {
        return { type: "failed", code: "asset_missing", message: "The photo request for this job no longer exists." };
      }
      if (request.asset.status !== "pending_upload") {
        await settleStored(job, request);
        return { type: "completed" };
      }
      if (metadataOf(request.asset).executionMode !== "queued_worker") {
        return { type: "failed", code: "execution_mode_mismatch", message: "Only queued photo requests run on the worker." };
      }
      if (job.uncertainPriorDispatch) {
        const message = "QOS could not confirm whether the image service generated this photo.";
        await settle(job, request, { failureCode: "outcome_unknown", message, providerOutcome: "submission_unknown" }, "submission_unknown");
        return { type: "operator_review", code: "outcome_unknown", message, providerOutcome: "submission_unknown" };
      }

      const blocked = await blockedBy(job, request, config);
      if (blocked) {
        return notSent(job, request, blocked.code, blocked.message);
      }
      let provider: AiPhotoProvider;
      try {
        provider = options.provider ?? getAiPhotoProvider(config);
      } catch {
        return notSent(job, request, "ai_photos_unavailable", "The image service is not configured on the AI worker.");
      }
      if (!(await beginDispatch(job, context, request, config))) {
        await settle(
          job,
          request,
          { failureCode: "not_started_in_time", message: NOT_STARTED_IN_TIME_MESSAGE, providerOutcome: "not_dispatched" },
          "release_unstarted",
        );
        return { type: "failed", code: "not_started_in_time", message: NOT_STARTED_IN_TIME_MESSAGE, providerOutcome: "not_dispatched" };
      }

      let bytes: Buffer;
      let usage: AiPhotoUsage | null = null;
      try {
        const result = await provider.generate({ prompt: metadataOf(request.asset).prompt ?? "", requestId: request.asset.publicId });
        usage = result.usage;
        bytes = await normalizeGeneratedImage(result.bytes);
      } catch (error) {
        return onProviderFailure(job, request, error);
      }

      if (!(await ingest(job, request, bytes))) {
        const message = "The generated image could not be stored.";
        await settle(job, request, { failureCode: "storage_failed", message }, "completed");
        return { type: "failed", code: "storage_failed", message };
      }

      await withTenantContext(db, job.tenantId, async (tx) => {
        await lockLeasedAiJobInTx(tx, job);
        await recordAiPhotoCompletionInTx(tx, job.tenantId, request.asset.id, { usage, completedAt: clock() });
        await recordAiSpendOutcome(tx, {
          tenantId: job.tenantId,
          reservationPublicId: request.reservation!.publicId,
          outcome: "completed",
          reportedUsage: reportedUsage(usage),
          actor: WORKER_ACTOR,
          now: clock(),
        });
      });
      return { type: "completed" };
    },
  };
}
