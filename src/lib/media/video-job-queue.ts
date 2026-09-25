import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  catalogueMediaAssets,
  catalogueMediaDerivatives,
  videoProcessingJobs,
} from "@/db/schema";
import { withTenantContext } from "@/lib/tenant/context";
import {
  readVideoProcessingConfig,
  type VideoProcessingConfig,
} from "@/lib/media/video-config";
import { getMediaStorage } from "@/lib/media/storage";
import {
  extractPosterFrame,
  transcodeVideo,
  validateVideoBytes,
  VideoValidationError,
} from "@/lib/media/video-validation";

export class VideoJobError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = "VideoJobError";
    this.retryable = retryable;
  }
}

/** The job was reclaimed (lease expired) while this worker was still running it. */
export class VideoJobLeaseLostError extends VideoJobError {
  constructor(jobId: string) {
    super(`Lease lost for video job ${jobId}; another worker owns it now.`, false);
    this.name = "VideoJobLeaseLostError";
  }
}

export type ClaimedVideoJob = {
  jobId: string;
  tenantId: string;
  productId: string;
  assetId: string;
  correlationId: string;
  sourceStoragePath: string;
  retryCount: number;
  workerId: string;
};

export type VideoJobFailureDecision =
  | { status: "rejected"; retryCount: number }
  | { status: "quarantined"; retryCount: number }
  | { status: "queued"; retryCount: number; nextAttemptAt: Date };

function generateCorrelationId(
  tenantId: string,
  productId: string,
  assetId: string,
): string {
  const hash = createHash("sha256")
    .update(`${tenantId}:${productId}:${assetId}:${Date.now()}`)
    .digest("hex")
    .slice(0, 16);
  return `vjob_${hash}`;
}

function generateDerivativePublicId(kind: "video_playback" | "video_poster"): string {
  const prefix = kind === "video_playback" ? "mvp" : "mpo";
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

/** Invalid or undecodable input is final; tool timeouts/crashes are retried. */
function asVideoJobError(error: unknown): VideoJobError {
  const retryable = error instanceof VideoValidationError ? error.transient : true;
  return new VideoJobError(errorMessage(error), retryable);
}

/**
 * Decide what happens to a job after a failed attempt.
 *
 * - Non-retryable (the upload itself is invalid): rejected immediately.
 * - Retryable with attempts left: re-queued with exponential backoff.
 * - Retryable with attempts exhausted: quarantined for inspection.
 */
export function decideVideoJobFailure(
  previousRetryCount: number,
  retryable: boolean,
  config: Pick<VideoProcessingConfig, "maxRetries" | "retryBackoffMs">,
  now: Date = new Date(),
): VideoJobFailureDecision {
  const retryCount = previousRetryCount + 1;

  if (!retryable) {
    return { status: "rejected", retryCount };
  }

  if (retryCount >= config.maxRetries) {
    return { status: "quarantined", retryCount };
  }

  const delayMs = config.retryBackoffMs * 2 ** (retryCount - 1);
  return {
    status: "queued",
    retryCount,
    nextAttemptAt: new Date(now.getTime() + delayMs),
  };
}

/**
 * Queue a video processing job with tenant/product/asset identity.
 * 
 * This creates a durable work item that will be processed asynchronously.
 * The job tracks retry count and last error for quarantine handling.
 * 
 * Idempotency: If a job already exists for this asset, returns the existing job.
 */
export async function queueVideoProcessingJob(
  db: DbClient,
  tenantId: string,
  productId: string,
  assetId: string,
  sourceStoragePath: string,
): Promise<{ jobId: string; correlationId: string }> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [existingJob] = await tx
      .select({
        id: videoProcessingJobs.id,
        correlationId: videoProcessingJobs.correlationId,
        status: videoProcessingJobs.status,
      })
      .from(videoProcessingJobs)
      .where(
        and(
          eq(videoProcessingJobs.tenantId, tenantId),
          eq(videoProcessingJobs.assetId, assetId),
          inArray(videoProcessingJobs.status, [
            "queued",
            "processing",
            "ready",
          ]),
        ),
      )
      .limit(1);

    if (existingJob) {
      return {
        jobId: existingJob.id,
        correlationId: existingJob.correlationId,
      };
    }

    const correlationId = generateCorrelationId(tenantId, productId, assetId);

    const [job] = await tx
      .insert(videoProcessingJobs)
      .values({
        tenantId,
        assetId,
        productId,
        correlationId,
        sourceStoragePath,
        status: "queued",
        retryCount: 0,
      })
      .returning({
        id: videoProcessingJobs.id,
        correlationId: videoProcessingJobs.correlationId,
      });

    return {
      jobId: job.id,
      correlationId: job.correlationId,
    };
  });
}

type ClaimRow = {
  job_id: string;
  tenant_id: string;
  product_id: string;
  asset_id: string;
  correlation_id: string;
  source_storage_path: string;
  retry_count: number;
};

/**
 * Claim the next runnable job across all tenants.
 *
 * Runs `qos.claim_next_video_processing_job`, a SECURITY DEFINER function, so
 * the worker can use the ordinary `qos_app` role despite tenant RLS. In one
 * serialized step it:
 * - re-queues (or quarantines) jobs whose worker lease expired,
 * - skips tenants already at `maxActiveJobsPerTenant`,
 * - picks the tenant served least recently (fair round-robin), then its
 *   oldest due job, and leases it to `workerId` for `jobLeaseMs`.
 */
export async function claimNextQueuedJob(
  db: DbClient,
  options: { workerId?: string; config?: VideoProcessingConfig } = {},
): Promise<ClaimedVideoJob | null> {
  const config = options.config ?? readVideoProcessingConfig();
  const workerId = options.workerId ?? `worker_${randomUUID().slice(0, 8)}`;
  const leaseSeconds = Math.max(1, Math.ceil(config.jobLeaseMs / 1000));

  const rows = (await db.execute<ClaimRow>(
    sql`select * from qos.claim_next_video_processing_job(${workerId}, ${leaseSeconds}, ${config.maxActiveJobsPerTenant}, ${config.maxRetries})`,
  )) as unknown as ClaimRow[];

  const row = rows[0];
  if (!row) {
    return null;
  }

  return {
    jobId: row.job_id,
    tenantId: row.tenant_id,
    productId: row.product_id,
    assetId: row.asset_id,
    correlationId: row.correlation_id,
    sourceStoragePath: row.source_storage_path,
    retryCount: row.retry_count,
    workerId,
  };
}

function ownedJob(job: ClaimedVideoJob) {
  return and(
    eq(videoProcessingJobs.tenantId, job.tenantId),
    eq(videoProcessingJobs.id, job.jobId),
    eq(videoProcessingJobs.status, "processing"),
    eq(videoProcessingJobs.claimedBy, job.workerId),
  );
}

type ProducedDerivatives = {
  width: number;
  height: number;
  playback: { publicId: string; storagePath: string; byteSize: number };
  poster: { publicId: string; storagePath: string; byteSize: number };
};

/**
 * CPU/IO-heavy stage. Runs outside any database transaction so a multi-minute
 * transcode never holds a connection or row locks.
 */
async function produceDerivatives(job: ClaimedVideoJob): Promise<ProducedDerivatives> {
  const storage = getMediaStorage();

  let sourceBytes: Buffer;
  try {
    sourceBytes = await storage.readPrivate(job.sourceStoragePath);
  } catch (error) {
    throw new VideoJobError(`Failed to read source video: ${errorMessage(error)}`, true);
  }

  let metadata: Awaited<ReturnType<typeof validateVideoBytes>>;
  let transcodedBytes: Buffer;
  let posterBytes: Buffer;
  try {
    metadata = await validateVideoBytes(sourceBytes, "video/mp4");
    [transcodedBytes, posterBytes] = await Promise.all([
      transcodeVideo(sourceBytes),
      extractPosterFrame(sourceBytes, metadata.durationSeconds),
    ]);
  } catch (error) {
    throw asVideoJobError(error);
  }

  const playbackPublicId = generateDerivativePublicId("video_playback");
  const posterPublicId = generateDerivativePublicId("video_poster");
  const playbackStoragePath = `products/${job.productId}/${job.assetId}/${playbackPublicId}.mp4`;
  const posterStoragePath = `products/${job.productId}/${job.assetId}/${posterPublicId}.jpg`;

  try {
    await Promise.all([
      storage.writePublic(playbackStoragePath, transcodedBytes),
      storage.writePublic(posterStoragePath, posterBytes),
    ]);
  } catch (error) {
    throw new VideoJobError(`Failed to store video derivatives: ${errorMessage(error)}`, true);
  }

  return {
    width: metadata.width,
    height: metadata.height,
    playback: {
      publicId: playbackPublicId,
      storagePath: playbackStoragePath,
      byteSize: transcodedBytes.length,
    },
    poster: {
      publicId: posterPublicId,
      storagePath: posterStoragePath,
      byteSize: posterBytes.length,
    },
  };
}

/**
 * Process a claimed job: validate, transcode, generate poster, store derivatives.
 *
 * Replay-safe: prior derivative rows for the asset are replaced in the same
 * transaction that marks the job ready, so exactly one approved playback/poster
 * pair exists per asset. Every state change is conditional on this worker
 * still holding the lease; if the lease was reclaimed, nothing is committed.
 *
 * On failure the job is rejected, re-queued with backoff, or quarantined (see
 * `decideVideoJobFailure`), and the error is rethrown for the caller to log.
 */
export async function processVideoJob(
  db: DbClient,
  job: ClaimedVideoJob,
  options: { config?: VideoProcessingConfig } = {},
): Promise<void> {
  const config = options.config ?? readVideoProcessingConfig();

  try {
    const produced = await produceDerivatives(job);

    await withTenantContext(db, job.tenantId, async (tx) => {
      const now = new Date();

      const [completed] = await tx
        .update(videoProcessingJobs)
        .set({
          status: "ready",
          completedAt: now,
          leaseExpiresAt: null,
          lastErrorMessage: null,
          updatedAt: now,
        })
        .where(ownedJob(job))
        .returning({ id: videoProcessingJobs.id });

      if (!completed) {
        throw new VideoJobLeaseLostError(job.jobId);
      }

      await tx
        .delete(catalogueMediaDerivatives)
        .where(
          and(
            eq(catalogueMediaDerivatives.tenantId, job.tenantId),
            eq(catalogueMediaDerivatives.assetId, job.assetId),
          ),
        );

      await tx.insert(catalogueMediaDerivatives).values([
        {
          tenantId: job.tenantId,
          assetId: job.assetId,
          derivativeKind: "video_playback",
          publicDerivativeId: produced.playback.publicId,
          storagePath: produced.playback.storagePath,
          contentType: "video/mp4",
          width: produced.width,
          height: produced.height,
          byteSize: produced.playback.byteSize,
        },
        {
          tenantId: job.tenantId,
          assetId: job.assetId,
          derivativeKind: "video_poster",
          publicDerivativeId: produced.poster.publicId,
          storagePath: produced.poster.storagePath,
          contentType: "image/jpeg",
          width: produced.width,
          height: produced.height,
          byteSize: produced.poster.byteSize,
        },
      ]);

      await tx
        .update(catalogueMediaAssets)
        .set({
          status: "approved",
          contentType: "video/mp4",
          failureReason: null,
          approvedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(catalogueMediaAssets.tenantId, job.tenantId),
            eq(catalogueMediaAssets.id, job.assetId),
          ),
        );
    });
  } catch (error) {
    if (error instanceof VideoJobLeaseLostError) {
      throw error;
    }

    await recordVideoJobFailure(db, job, error, config);
    throw error;
  }
}

async function recordVideoJobFailure(
  db: DbClient,
  job: ClaimedVideoJob,
  error: unknown,
  config: VideoProcessingConfig,
): Promise<VideoJobFailureDecision> {
  const message = errorMessage(error);
  const retryable = error instanceof VideoJobError ? error.retryable : true;
  const decision = decideVideoJobFailure(job.retryCount, retryable, config);
  const now = new Date();

  await withTenantContext(db, job.tenantId, async (tx) => {
    const [updated] = await tx
      .update(videoProcessingJobs)
      .set({
        status: decision.status,
        retryCount: decision.retryCount,
        lastErrorMessage: message,
        lastErrorAt: now,
        nextAttemptAt: decision.status === "queued" ? decision.nextAttemptAt : now,
        leaseExpiresAt: null,
        claimedBy: null,
        updatedAt: now,
      })
      .where(ownedJob(job))
      .returning({ id: videoProcessingJobs.id });

    if (!updated || decision.status === "queued") {
      return;
    }

    await tx
      .update(catalogueMediaAssets)
      .set({
        status: "rejected",
        failureReason:
          decision.status === "quarantined"
            ? `Quarantined after ${decision.retryCount} attempts: ${message}`
            : message,
        updatedAt: now,
      })
      .where(
        and(
          eq(catalogueMediaAssets.tenantId, job.tenantId),
          eq(catalogueMediaAssets.id, job.assetId),
        ),
      );
  });

  return decision;
}

/**
 * Get job status and diagnostic information, scoped to the tenant.
 */
export async function getJobStatus(
  db: DbClient,
  tenantId: string,
  correlationId: string,
): Promise<{
  jobId: string;
  status: string;
  retryCount: number;
  lastErrorMessage: string | null;
  lastErrorAt: Date | null;
  nextAttemptAt: Date;
  createdAt: Date;
  completedAt: Date | null;
} | null> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [job] = await tx
      .select({
        id: videoProcessingJobs.id,
        status: videoProcessingJobs.status,
        retryCount: videoProcessingJobs.retryCount,
        lastErrorMessage: videoProcessingJobs.lastErrorMessage,
        lastErrorAt: videoProcessingJobs.lastErrorAt,
        nextAttemptAt: videoProcessingJobs.nextAttemptAt,
        createdAt: videoProcessingJobs.createdAt,
        completedAt: videoProcessingJobs.completedAt,
      })
      .from(videoProcessingJobs)
      .where(
        and(
          eq(videoProcessingJobs.tenantId, tenantId),
          eq(videoProcessingJobs.correlationId, correlationId),
        ),
      )
      .limit(1);

    if (!job) {
      return null;
    }

    return {
      jobId: job.id,
      status: job.status,
      retryCount: job.retryCount,
      lastErrorMessage: job.lastErrorMessage,
      lastErrorAt: job.lastErrorAt,
      nextAttemptAt: job.nextAttemptAt,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    };
  });
}
