import { and, eq } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  catalogueMediaAssets,
  catalogueMediaDerivatives,
  catalogueMediaUploadGrants,
  catalogueProducts,
} from "@/db/schema";
import { readMediaConfig } from "@/lib/media/config";
import { getMediaStorage } from "@/lib/media/storage";
import { queueVideoProcessingJob, getJobStatus } from "@/lib/media/video-job-queue";
import { readVideoProcessingConfig } from "@/lib/media/video-config";
import { detectVideoContentType } from "@/lib/media/video-validation";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

function requireAdministratorRole(membership: ActiveStaffMembership) {
  if (membership.role !== "administrator") {
    throw new StaffAuthorizationError(
      "Administrator membership is required for this action.",
    );
  }
}

export class ProductVideoError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "ProductVideoError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

function mapVideoError(error: unknown): never {
  if (error instanceof StaffAuthorizationError) {
    throw error;
  }

  if (error instanceof ProductVideoError) {
    throw error;
  }

  if (error instanceof Error) {
    throw new ProductVideoError(error.message, 400);
  }

  throw new ProductVideoError("Unexpected video error.", 500);
}

function generateAssetPublicId(): string {
  return `mas_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function generateGrantToken(): string {
  return createHash("sha256")
    .update(`grant:${randomUUID()}:${Date.now()}`)
    .digest("hex")
    .slice(0, 32);
}

async function requireDraftProduct(
  tx: DbClient,
  tenantId: string,
  productPublicId: string,
) {
  const [product] = await tx
    .select()
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.publicId, productPublicId),
      ),
    )
    .limit(1);

  if (!product || product.status === "archived") {
    throw new ProductVideoError("Product not found.", 404);
  }

  return product;
}

/**
 * Create a video upload grant for a product.
 * 
 * This follows the same pattern as product images but validates
 * against video byte limits and content type.
 */
export async function createProductVideoUploadGrant(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  input: {
    byteSize: number;
    contentType: string;
  },
) {
  requireAdministratorRole(membership);

  const videoConfig = readVideoProcessingConfig();
  const mediaConfig = readMediaConfig();

  try {
    if (input.byteSize <= 0 || input.byteSize > videoConfig.maxUploadBytes) {
      const maxMiB = (videoConfig.maxUploadBytes / (1024 * 1024)).toFixed(0);
      throw new ProductVideoError(
        `Video size must be between 1 byte and ${maxMiB} MiB (owner-locked limit).`,
        400,
        "byteSize",
      );
    }

    if (input.contentType !== "video/mp4") {
      throw new ProductVideoError(
        "Only video/mp4 content type is supported.",
        400,
        "contentType",
      );
    }

    return withTenantContext(db, tenantId, async (tx) => {
      const product = await requireDraftProduct(tx, tenantId, productPublicId);

      const assetPublicId = generateAssetPublicId();
      const grantToken = generateGrantToken();
      const privateStoragePath = `products/${product.id}/${assetPublicId}/source.mp4`;

      const [asset] = await tx
        .insert(catalogueMediaAssets)
        .values({
          tenantId,
          productId: product.id,
          publicId: assetPublicId,
          status: "pending_upload",
          sourceProvenance: "operator_entered",
        })
        .returning({ id: catalogueMediaAssets.id });

      const expiresAt = new Date(
        Date.now() + mediaConfig.grantTtlSeconds * 1000,
      );

      await tx.insert(catalogueMediaUploadGrants).values({
        tenantId,
        assetId: asset.id,
        grantToken,
        privateStoragePath,
        expectedByteSize: input.byteSize,
        expectedContentType: input.contentType,
        expiresAt,
      });

      return {
        assetPublicId,
        grantToken,
        expiresAt,
        uploadPath: `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/videos/upload`,
      };
    });
  } catch (error) {
    return mapVideoError(error);
  }
}

/**
 * Ingest an uploaded video using a grant token.
 * 
 * Validates the upload and marks the asset as uploaded,
 * ready for asynchronous processing.
 */
export async function ingestProductVideoUpload(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
  grantToken: string,
  uploadedBytes: Buffer,
) {
  try {
    return withTenantContext(db, tenantId, async (tx) => {
      const product = await requireDraftProduct(tx, tenantId, productPublicId);

      const [grant] = await tx
        .select()
        .from(catalogueMediaUploadGrants)
        .where(eq(catalogueMediaUploadGrants.grantToken, grantToken))
        .limit(1);

      if (!grant) {
        throw new ProductVideoError("Upload grant not found.", 404);
      }

      if (grant.status === "used") {
        throw new ProductVideoError("Upload grant has already been used.", 409);
      }

      const now = new Date();
      if (now > grant.expiresAt) {
        throw new ProductVideoError("Upload grant has expired.", 410);
      }

      const [asset] = await tx
        .select()
        .from(catalogueMediaAssets)
        .where(
          and(
            eq(catalogueMediaAssets.tenantId, tenantId),
            eq(catalogueMediaAssets.id, grant.assetId),
            eq(catalogueMediaAssets.productId, product.id),
          ),
        )
        .limit(1);

      if (!asset) {
        throw new ProductVideoError("Media asset not found for this product.", 404);
      }

      if (uploadedBytes.byteLength !== grant.expectedByteSize) {
        throw new ProductVideoError(
          "Uploaded video size does not match the grant.",
          400,
          "body",
        );
      }

      const detectedContentType = detectVideoContentType(uploadedBytes);
      if (
        !detectedContentType ||
        detectedContentType !== grant.expectedContentType
      ) {
        throw new ProductVideoError(
          "Uploaded bytes do not match the declared video content type.",
          400,
          "contentType",
        );
      }

      const storage = getMediaStorage();
      await storage.writePrivate(grant.privateStoragePath, uploadedBytes);

      await tx
        .update(catalogueMediaUploadGrants)
        .set({
          status: "used",
          usedAt: now,
        })
        .where(eq(catalogueMediaUploadGrants.id, grant.id));

      await tx
        .update(catalogueMediaAssets)
        .set({
          status: "uploaded",
          updatedAt: now,
        })
        .where(eq(catalogueMediaAssets.id, asset.id));

      return {
        assetPublicId: asset.publicId,
        status: "uploaded" as const,
      };
    });
  } catch (error) {
    return mapVideoError(error);
  }
}

/**
 * Queue an uploaded video for asynchronous processing.
 * 
 * This creates a durable job that will validate, transcode, and
 * generate poster derivatives.
 */
export async function queueProductVideoProcessing(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  assetPublicId: string,
) {
  requireAdministratorRole(membership);

  try {
    return withTenantContext(db, tenantId, async (tx) => {
      const product = await requireDraftProduct(tx, tenantId, productPublicId);

      const [asset] = await tx
        .select()
        .from(catalogueMediaAssets)
        .where(
          and(
            eq(catalogueMediaAssets.tenantId, tenantId),
            eq(catalogueMediaAssets.publicId, assetPublicId),
            eq(catalogueMediaAssets.productId, product.id),
          ),
        )
        .limit(1);

      if (!asset) {
        throw new ProductVideoError("Media asset not found.", 404);
      }

      if (asset.status !== "uploaded") {
        throw new ProductVideoError(
          "Media asset must be in uploaded state to queue processing.",
          400,
        );
      }

      const [grant] = await tx
        .select({ privateStoragePath: catalogueMediaUploadGrants.privateStoragePath })
        .from(catalogueMediaUploadGrants)
        .where(
          and(
            eq(catalogueMediaUploadGrants.tenantId, tenantId),
            eq(catalogueMediaUploadGrants.assetId, asset.id),
            eq(catalogueMediaUploadGrants.status, "used"),
          ),
        )
        .orderBy(catalogueMediaUploadGrants.usedAt)
        .limit(1);

      if (!grant) {
        throw new ProductVideoError("Completed upload grant not found.", 404);
      }

      await tx
        .update(catalogueMediaAssets)
        .set({
          status: "processing",
          updatedAt: new Date(),
        })
        .where(eq(catalogueMediaAssets.id, asset.id));

      const { jobId, correlationId } = await queueVideoProcessingJob(
        tx as DbClient,
        tenantId,
        product.id,
        asset.id,
        grant.privateStoragePath,
      );

      return {
        assetPublicId: asset.publicId,
        jobId,
        correlationId,
        status: "processing" as const,
      };
    });
  } catch (error) {
    return mapVideoError(error);
  }
}

/**
 * Get the processing status of a video job.
 */
export async function getProductVideoJobStatus(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  correlationId: string,
) {
  requireAdministratorRole(membership);

  try {
    const status = await getJobStatus(db, tenantId, correlationId);

    if (!status) {
      throw new ProductVideoError("Job not found.", 404);
    }

    return {
      correlationId,
      status: status.status,
      retryCount: status.retryCount,
      lastErrorMessage: status.lastErrorMessage,
      lastErrorAt: status.lastErrorAt,
      nextAttemptAt: status.nextAttemptAt,
      createdAt: status.createdAt,
      completedAt: status.completedAt,
    };
  } catch (error) {
    return mapVideoError(error);
  }
}

/**
 * Get approved video playback and poster URLs for a product.
 */
export async function getApprovedProductVideoUrls(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
): Promise<{
  playbackUrl: string;
  posterUrl: string;
} | null> {
  try {
    return withTenantContext(db, tenantId, async (tx) => {
      const product = await requireDraftProduct(tx, tenantId, productPublicId);

      const [asset] = await tx
        .select({ id: catalogueMediaAssets.id })
        .from(catalogueMediaAssets)
        .where(
          and(
            eq(catalogueMediaAssets.tenantId, tenantId),
            eq(catalogueMediaAssets.productId, product.id),
            eq(catalogueMediaAssets.status, "approved"),
            eq(catalogueMediaAssets.contentType, "video/mp4"),
          ),
        )
        .orderBy(catalogueMediaAssets.approvedAt)
        .limit(1);

      if (!asset) {
        return null;
      }

      const derivatives = await tx
        .select({
          kind: catalogueMediaDerivatives.derivativeKind,
          publicId: catalogueMediaDerivatives.publicDerivativeId,
        })
        .from(catalogueMediaDerivatives)
        .where(
          and(
            eq(catalogueMediaDerivatives.tenantId, tenantId),
            eq(catalogueMediaDerivatives.assetId, asset.id),
          ),
        );

      const playback = derivatives.find((d) => d.kind === "video_playback");
      const poster = derivatives.find((d) => d.kind === "video_poster");

      if (!playback || !poster) {
        return null;
      }

      return {
        playbackUrl: `/api/media/public/${playback.publicId}`,
        posterUrl: `/api/media/public/${poster.publicId}`,
      };
    });
  } catch (error) {
    return mapVideoError(error);
  }
}
