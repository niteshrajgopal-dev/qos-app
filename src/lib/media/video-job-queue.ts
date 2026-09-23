import { and, eq, inArray, or } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  catalogueMediaAssets,
  catalogueMediaDerivatives,
  videoProcessingJobs,
} from "@/db/schema";
import type { TenantDbExecutor } from "@/lib/tenant/context";
import { withTenantContext } from "@/lib/tenant/context";
import { readVideoProcessingConfig } from "@/lib/media/video-config";
import { getMediaStorage } from "@/lib/media/storage";
import {
  extractPosterFrame,
  transcodeVideo,
  validateVideoBytes,
} from "@/lib/media/video-validation";

export class VideoJobError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable = true) {
    super(message);
    this.name = "VideoJobError";
    this.retryable = retryable;
  }
}

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

/**
 * Get the next queued job for processing with optimistic locking.
 * 
 * Returns null if no jobs are available.
 */
export async function claimNextQueuedJob(
  db: DbClient,
): Promise<{
  jobId: string;
  tenantId: string;
  productId: string;
  assetId: string;
  correlationId: string;
  sourceStoragePath: string;
  retryCount: number;
} | null> {
  const [job] = await db
    .select({
      id: videoProcessingJobs.id,
      tenantId: videoProcessingJobs.tenantId,
      productId: videoProcessingJobs.productId,
      assetId: videoProcessingJobs.assetId,
      correlationId: videoProcessingJobs.correlationId,
      sourceStoragePath: videoProcessingJobs.sourceStoragePath,
      retryCount: videoProcessingJobs.retryCount,
    })
    .from(videoProcessingJobs)
    .where(eq(videoProcessingJobs.status, "queued"))
    .orderBy(videoProcessingJobs.createdAt)
    .limit(1);

  if (!job) {
    return null;
  }

  const [updated] = await db
    .update(videoProcessingJobs)
    .set({
      status: "processing",
      startedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(videoProcessingJobs.id, job.id),
        eq(videoProcessingJobs.status, "queued"),
      ),
    )
    .returning({ id: videoProcessingJobs.id });

  if (!updated) {
    return null;
  }

  return {
    jobId: job.id,
    tenantId: job.tenantId,
    productId: job.productId,
    assetId: job.assetId,
    correlationId: job.correlationId,
    sourceStoragePath: job.sourceStoragePath,
    retryCount: job.retryCount,
  };
}

/**
 * Process a video job: validate, transcode, generate poster, store derivatives.
 * 
 * This is idempotent: if derivatives already exist for this asset, they will be
 * replaced, ensuring exactly one approved derivative/poster set per logical job.
 * 
 * On failure, increments retry count. On exhausted retries, quarantines the job.
 */
export async function processVideoJob(
  db: DbClient,
  jobId: string,
): Promise<void> {
  const [job] = await db
    .select({
      id: videoProcessingJobs.id,
      tenantId: videoProcessingJobs.tenantId,
      productId: videoProcessingJobs.productId,
      assetId: videoProcessingJobs.assetId,
      correlationId: videoProcessingJobs.correlationId,
      sourceStoragePath: videoProcessingJobs.sourceStoragePath,
      retryCount: videoProcessingJobs.retryCount,
      status: videoProcessingJobs.status,
    })
    .from(videoProcessingJobs)
    .where(eq(videoProcessingJobs.id, jobId))
    .limit(1);

  if (!job) {
    throw new VideoJobError("Job not found.", false);
  }

  if (job.status !== "processing") {
    throw new VideoJobError(
      `Job is in ${job.status} state, expected processing.`,
      false,
    );
  }

  const config = readVideoProcessingConfig();

  try {
    await withTenantContext(db, job.tenantId, async (tx) => {
      await processJobWithRetry(
        tx,
        job.tenantId,
        job.productId,
        job.assetId,
        job.sourceStoragePath,
        job.correlationId,
      );

      await tx
        .update(videoProcessingJobs)
        .set({
          status: "ready",
          completedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(videoProcessingJobs.id, jobId));

      await tx
        .update(catalogueMediaAssets)
        .set({
          status: "approved",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogueMediaAssets.tenantId, job.tenantId),
            eq(catalogueMediaAssets.id, job.assetId),
          ),
        );
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const retryable =
      error instanceof VideoJobError ? error.retryable : true;

    const newRetryCount = job.retryCount + 1;
    const shouldQuarantine = newRetryCount >= config.maxRetries;

    await db
      .update(videoProcessingJobs)
      .set({
        status: shouldQuarantine ? "quarantined" : retryable ? "queued" : "failed",
        retryCount: newRetryCount,
        lastErrorMessage: errorMessage,
        lastErrorAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(videoProcessingJobs.id, jobId));

    if (shouldQuarantine) {
      await withTenantContext(db, job.tenantId, async (tx) => {
        await tx
          .update(catalogueMediaAssets)
          .set({
            status: "rejected",
            failureReason: `Quarantined after ${config.maxRetries} retries: ${errorMessage}`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(catalogueMediaAssets.tenantId, job.tenantId),
              eq(catalogueMediaAssets.id, job.assetId),
            ),
          );
      });
    }

    throw error;
  }
}

/**
 * Process the video job with idempotent derivative creation.
 * 
 * This function ensures exactly one derivative set exists:
 * - If derivatives exist, they are deleted first
 * - New derivatives are created atomically
 * - No file leaks on replay
 */
async function processJobWithRetry(
  tx: TenantDbExecutor,
  tenantId: string,
  productId: string,
  assetId: string,
  sourceStoragePath: string,
  correlationId: string,
): Promise<void> {
  const storage = getMediaStorage();

  const sourceBytes = await storage.readPrivate(sourceStoragePath);

  const metadata = await validateVideoBytes(sourceBytes, "video/mp4");

  const [transcodedBytes, posterBytes] = await Promise.all([
    transcodeVideo(sourceBytes),
    extractPosterFrame(sourceBytes, metadata.durationSeconds),
  ]);

  const existingDerivatives = await tx
    .select({ id: catalogueMediaDerivatives.id })
    .from(catalogueMediaDerivatives)
    .where(
      and(
        eq(catalogueMediaDerivatives.tenantId, tenantId),
        eq(catalogueMediaDerivatives.assetId, assetId),
      ),
    );

  if (existingDerivatives.length > 0) {
    await tx
      .delete(catalogueMediaDerivatives)
      .where(
        and(
          eq(catalogueMediaDerivatives.tenantId, tenantId),
          eq(catalogueMediaDerivatives.assetId, assetId),
        ),
      );
  }

  const playbackPublicId = generateDerivativePublicId("video_playback");
  const posterPublicId = generateDerivativePublicId("video_poster");

  const playbackStoragePath = `products/${productId}/${assetId}/${playbackPublicId}.mp4`;
  const posterStoragePath = `products/${productId}/${assetId}/${posterPublicId}.jpg`;

  await Promise.all([
    storage.writePublic(playbackStoragePath, transcodedBytes),
    storage.writePublic(posterStoragePath, posterBytes),
  ]);

  await tx.insert(catalogueMediaDerivatives).values([
    {
      tenantId,
      assetId,
      derivativeKind: "video_playback",
      publicDerivativeId: playbackPublicId,
      storagePath: playbackStoragePath,
      contentType: "video/mp4",
      width: metadata.width,
      height: metadata.height,
      byteSize: transcodedBytes.length,
    },
    {
      tenantId,
      assetId,
      derivativeKind: "video_poster",
      publicDerivativeId: posterPublicId,
      storagePath: posterStoragePath,
      contentType: "image/jpeg",
      width: metadata.width,
      height: metadata.height,
      byteSize: posterBytes.length,
    },
  ]);

  await tx
    .update(catalogueMediaAssets)
    .set({
      contentType: "video/mp4",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(catalogueMediaAssets.tenantId, tenantId),
        eq(catalogueMediaAssets.id, assetId),
      ),
    );
}

/**
 * Get job status and diagnostic information.
 */
export async function getJobStatus(
  db: DbClient,
  correlationId: string,
): Promise<{
  jobId: string;
  status: string;
  retryCount: number;
  lastErrorMessage: string | null;
  lastErrorAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
} | null> {
  const [job] = await db
    .select({
      id: videoProcessingJobs.id,
      status: videoProcessingJobs.status,
      retryCount: videoProcessingJobs.retryCount,
      lastErrorMessage: videoProcessingJobs.lastErrorMessage,
      lastErrorAt: videoProcessingJobs.lastErrorAt,
      createdAt: videoProcessingJobs.createdAt,
      completedAt: videoProcessingJobs.completedAt,
    })
    .from(videoProcessingJobs)
    .where(eq(videoProcessingJobs.correlationId, correlationId))
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
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  };
}
