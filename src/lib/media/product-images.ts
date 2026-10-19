import { and, eq, inArray } from "drizzle-orm";
import { createHash, randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  catalogueMediaAssets,
  catalogueMediaDerivatives,
  catalogueMediaUploadGrants,
  catalogueProducts,
} from "@/db/schema";
import { readMediaConfig } from "@/lib/media/config";
import {
  fetchRemoteImageBytes,
  RemoteImageFetchError,
  type RemoteImageFetchDeps,
} from "@/lib/media/remote-image-fetch";
import { getMediaStorage } from "@/lib/media/storage";
import {
  generateImageDerivatives,
  MediaValidationError,
  validateImageBytes,
} from "@/lib/media/validation";
import {
  CatalogueProductMutationGuardError,
  loadCatalogueProductForMutationInTx,
} from "@/lib/catalogue/product-mutation-policy";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export class ProductMediaError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "ProductMediaError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

function mapMediaError(error: unknown): never {
  if (error instanceof CatalogueProductMutationGuardError) {
    throw error;
  }

  if (error instanceof RemoteImageFetchError) {
    throw new ProductMediaError(error.message, 400, error.field);
  }

  if (error instanceof MediaValidationError) {
    throw new ProductMediaError(error.message, 400, error.field);
  }

  if (error instanceof StaffAuthorizationError) {
    throw error;
  }

  if (error instanceof ProductMediaError) {
    throw error;
  }

  if (error instanceof Error) {
    throw new ProductMediaError(error.message, 400);
  }

  throw new ProductMediaError("Unexpected media error.", 500);
}

function generateAssetPublicId() {
  return `mas_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function generateDerivativePublicId() {
  return `mda_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

function generateGrantToken() {
  return createHash("sha256")
    .update(`grant:${randomUUID()}:${Date.now()}`)
    .digest("hex")
    .slice(0, 32);
}

async function requireMutableProduct(
  tx: DbClient,
  tenantId: string,
  productPublicId: string,
  options?: { rowLock?: boolean },
) {
  return loadCatalogueProductForMutationInTx(
    tx,
    tenantId,
    productPublicId,
    options,
  );
}

export type CreateUploadGrantInput = {
  expectedByteSize: number;
  expectedContentType: "image/jpeg" | "image/png";
  altTextEn?: string | null;
  altTextAr?: string | null;
  sourceProvenance?: "imported" | "operator_entered" | "ai_generated";
  generationMetadata?: Record<string, unknown> | null;
};

export async function createProductImageUploadGrant(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  input: CreateUploadGrantInput,
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- internal ids never leave the server
    const { assetId, ...grant } = await withTenantContext(db, tenantId, (tx) =>
      createProductImageUploadGrantInTx(tx, tenantId, productPublicId, input),
    );
    return grant;
  } catch (error) {
    mapMediaError(error);
  }
}

/** Must run inside `withTenantContext`. */
export async function createProductImageUploadGrantInTx(
  tx: DbClient,
  tenantId: string,
  productPublicId: string,
  input: CreateUploadGrantInput,
) {
  const config = readMediaConfig();

  if (
    !Number.isInteger(input.expectedByteSize) ||
    input.expectedByteSize <= 0 ||
    input.expectedByteSize > config.maxUploadBytes
  ) {
    throw new ProductMediaError(
      "expectedByteSize exceeds the configured upload limit.",
      400,
      "expectedByteSize",
    );
  }

  if (
    input.expectedContentType !== "image/jpeg" &&
    input.expectedContentType !== "image/png"
  ) {
    throw new ProductMediaError(
      "Only image/jpeg and image/png uploads are supported.",
      400,
      "expectedContentType",
    );
  }

  const product = await requireMutableProduct(tx, tenantId, productPublicId);
  const assetPublicId = generateAssetPublicId();
  const grantToken = generateGrantToken();
  const privateStoragePath = `${tenantId}/quarantine/${assetPublicId}/original`;

  const [asset] = await tx
    .insert(catalogueMediaAssets)
    .values({
      tenantId,
      productId: product.id,
      publicId: assetPublicId,
      altTextEn: input.altTextEn ?? null,
      altTextAr: input.altTextAr ?? null,
      sourceProvenance: input.sourceProvenance ?? "operator_entered",
      generationMetadata: input.generationMetadata ?? null,
    })
    .returning();

  const expiresAt = new Date(Date.now() + config.grantTtlSeconds * 1000);

  const [grant] = await tx
    .insert(catalogueMediaUploadGrants)
    .values({
      tenantId,
      assetId: asset.id,
      grantToken,
      privateStoragePath,
      expectedByteSize: input.expectedByteSize,
      expectedContentType: input.expectedContentType,
      expiresAt,
    })
    .returning();

  return {
    assetId: asset.id,
    assetPublicId: asset.publicId,
    grantToken: grant.grantToken,
    expiresAt: grant.expiresAt.toISOString(),
    uploadPath: `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/upload`,
  };
}

export async function ingestProductImageUpload(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
  grantToken: string,
  bytes: Buffer,
) {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await requireMutableProduct(tx, tenantId, productPublicId, {
        rowLock: false,
      });

      const [grant] = await tx
        .select()
        .from(catalogueMediaUploadGrants)
        .where(eq(catalogueMediaUploadGrants.grantToken, grantToken))
        .limit(1);

      if (!grant || grant.tenantId !== tenantId) {
        throw new ProductMediaError("Upload grant not found.", 404);
      }

      if (grant.status !== "pending") {
        throw new ProductMediaError("Upload grant has already been used.", 409);
      }

      if (grant.expiresAt.getTime() < Date.now()) {
        await tx
          .update(catalogueMediaUploadGrants)
          .set({ status: "expired" })
          .where(eq(catalogueMediaUploadGrants.id, grant.id));
        throw new ProductMediaError("Upload grant has expired.", 410);
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
        throw new ProductMediaError("Media asset not found for this product.", 404);
      }

      const validated = await validateImageBytes(bytes, grant.expectedContentType);

      if (bytes.byteLength > grant.expectedByteSize) {
        throw new ProductMediaError(
          "Uploaded image exceeds the granted byte size.",
          400,
          "body",
        );
      }

      const storage = getMediaStorage();
      await storage.writePrivate(grant.privateStoragePath, bytes);

      await tx
        .update(catalogueMediaUploadGrants)
        .set({ status: "used", usedAt: new Date() })
        .where(eq(catalogueMediaUploadGrants.id, grant.id));

      const [updatedAsset] = await tx
        .update(catalogueMediaAssets)
        .set({
          status: "uploaded",
          contentType: validated.contentType,
          updatedAt: new Date(),
        })
        .where(eq(catalogueMediaAssets.id, asset.id))
        .returning();

      return {
        assetPublicId: updatedAsset.publicId,
        status: updatedAsset.status,
      };
    });
  } catch (error) {
    mapMediaError(error);
  }
}

export async function processProductImage(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  assetPublicId: string,
  publisherSubject: string,
) {
  try {
    return await withTenantContext(db, tenantId, (tx) =>
      processProductImageInTx(tx, tenantId, productPublicId, assetPublicId, publisherSubject),
    );
  } catch (error) {
    mapMediaError(error);
  }
}

/**
 * Quarantine -> derivatives -> approved -> product primary. Must run inside
 * `withTenantContext`; the asset row is locked so concurrent calls for the
 * same asset serialize and the loser sees it already approved.
 */
export async function processProductImageInTx(
  tx: DbClient,
  tenantId: string,
  productPublicId: string,
  assetPublicId: string,
  publisherSubject: string,
) {
  const product = await requireMutableProduct(tx, tenantId, productPublicId);

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
    .limit(1)
    .for("update");

  if (!asset) {
    throw new ProductMediaError("Media asset not found.", 404);
  }

  if (asset.status === "approved") {
    const derivatives = await tx
      .select()
      .from(catalogueMediaDerivatives)
      .where(
        and(
          eq(catalogueMediaDerivatives.tenantId, tenantId),
          eq(catalogueMediaDerivatives.assetId, asset.id),
        ),
      );

    return {
      assetPublicId: asset.publicId,
      status: asset.status,
      derivatives: derivatives.map((derivative) => ({
        kind: derivative.derivativeKind,
        publicDerivativeId: derivative.publicDerivativeId,
      })),
    };
  }

  if (asset.status !== "uploaded" && asset.status !== "failed") {
    throw new ProductMediaError(
      "Media asset is not ready for processing.",
      409,
    );
  }

  const [grant] = await tx
    .select()
    .from(catalogueMediaUploadGrants)
    .where(
      and(
        eq(catalogueMediaUploadGrants.tenantId, tenantId),
        eq(catalogueMediaUploadGrants.assetId, asset.id),
        eq(catalogueMediaUploadGrants.status, "used"),
      ),
    )
    .limit(1);

  if (!grant) {
    throw new ProductMediaError("Completed upload grant not found.", 404);
  }

  await tx
    .update(catalogueMediaAssets)
    .set({ status: "processing", failureReason: null, updatedAt: new Date() })
    .where(eq(catalogueMediaAssets.id, asset.id));

  const storage = getMediaStorage();
  const originalBytes = await storage.readPrivate(grant.privateStoragePath);

  try {
    const derivatives = await generateImageDerivatives(originalBytes);
    const createdDerivatives: Array<{
      kind: "thumbnail" | "display";
      publicDerivativeId: string;
    }> = [];

    for (const kind of ["thumbnail", "display"] as const) {
      const derivative = derivatives[kind];
      const publicDerivativeId = generateDerivativePublicId();
      const storagePath = `${tenantId}/public/${publicDerivativeId}.jpg`;

      await storage.writePublic(storagePath, derivative.bytes);

      await tx.insert(catalogueMediaDerivatives).values({
        tenantId,
        assetId: asset.id,
        derivativeKind: kind,
        publicDerivativeId,
        storagePath,
        contentType: derivative.contentType,
        width: derivative.width,
        height: derivative.height,
        byteSize: derivative.bytes.byteLength,
      });

      createdDerivatives.push({ kind, publicDerivativeId });
    }

    await tx
      .update(catalogueMediaAssets)
      .set({
        status: "approved",
        approvedBySubject: publisherSubject,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(catalogueMediaAssets.id, asset.id));

    await tx
      .update(catalogueProducts)
      .set({
        primaryMediaAssetId: asset.id,
        updatedAt: new Date(),
      })
      .where(eq(catalogueProducts.id, product.id));

    return {
      assetPublicId: asset.publicId,
      status: "approved" as const,
      derivatives: createdDerivatives,
    };
  } catch (error) {
    await tx
      .update(catalogueMediaAssets)
      .set({
        status: "failed",
        failureReason:
          error instanceof Error ? error.message : "Processing failed.",
        updatedAt: new Date(),
      })
      .where(eq(catalogueMediaAssets.id, asset.id));

    throw new ProductMediaError(
      error instanceof Error ? error.message : "Processing failed.",
      422,
    );
  }
}

export async function resolvePublicMediaDerivative(
  db: DbClient,
  publicDerivativeId: string,
) {
  const [derivative] = await db
    .select()
    .from(catalogueMediaDerivatives)
    .where(eq(catalogueMediaDerivatives.publicDerivativeId, publicDerivativeId))
    .limit(1);

  if (!derivative) {
    throw new ProductMediaError("Media asset not found.", 404);
  }

  return withTenantContext(db, derivative.tenantId, async (tx) => {
    const [asset] = await tx
      .select({ status: catalogueMediaAssets.status })
      .from(catalogueMediaAssets)
      .where(
        and(
          eq(catalogueMediaAssets.tenantId, derivative.tenantId),
          eq(catalogueMediaAssets.id, derivative.assetId),
        ),
      )
      .limit(1);

    if (!asset || asset.status !== "approved") {
      throw new ProductMediaError("Media asset not found.", 404);
    }

    const storage = getMediaStorage();
    const bytes = await storage.readPublic(derivative.storagePath);

    return {
      publicDerivativeId: derivative.publicDerivativeId,
      contentType: derivative.contentType,
      bytes,
      width: derivative.width,
      height: derivative.height,
    };
  });
}

async function findApprovedProductImage(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const product = await requireMutableProduct(tx, tenantId, productPublicId);

    const [primaryAsset] = product.primaryMediaAssetId
      ? await tx
          .select()
          .from(catalogueMediaAssets)
          .where(
            and(
              eq(catalogueMediaAssets.tenantId, tenantId),
              eq(catalogueMediaAssets.id, product.primaryMediaAssetId),
              eq(catalogueMediaAssets.status, "approved"),
            ),
          )
          .limit(1)
      : [];

    const [approvedAsset] =
      primaryAsset != null
        ? [primaryAsset]
        : await tx
            .select()
            .from(catalogueMediaAssets)
            .where(
              and(
                eq(catalogueMediaAssets.tenantId, tenantId),
                eq(catalogueMediaAssets.productId, product.id),
                eq(catalogueMediaAssets.status, "approved"),
              ),
            )
            .limit(1);

    if (!approvedAsset) {
      return null;
    }

    if (product.primaryMediaAssetId !== approvedAsset.id) {
      await tx
        .update(catalogueProducts)
        .set({
          primaryMediaAssetId: approvedAsset.id,
          updatedAt: new Date(),
        })
        .where(eq(catalogueProducts.id, product.id));
    }

    const derivatives = await tx
      .select()
      .from(catalogueMediaDerivatives)
      .where(
        and(
          eq(catalogueMediaDerivatives.tenantId, tenantId),
          eq(catalogueMediaDerivatives.assetId, approvedAsset.id),
        ),
      );

    return {
      assetPublicId: approvedAsset.publicId,
      status: approvedAsset.status,
      derivatives: derivatives.map((derivative) => ({
        kind: derivative.derivativeKind,
        publicDerivativeId: derivative.publicDerivativeId,
      })),
    };
  });
}

export type IngestProductImageFromRemoteUrlDeps = RemoteImageFetchDeps & {
  force?: boolean;
};

export async function ingestProductImageFromRemoteUrl(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  imageUrl: string,
  publisherSubject: string,
  fetchDeps: IngestProductImageFromRemoteUrlDeps = {},
) {
  try {
    if (!fetchDeps.force) {
      const existing = await findApprovedProductImage(
        db,
        tenantId,
        productPublicId,
      );
      if (existing) {
        return existing;
      }
    }

    const remoteImage = await fetchRemoteImageBytes(imageUrl, fetchDeps);

    const grant = await createProductImageUploadGrant(
      db,
      tenantId,
      membership,
      productPublicId,
      {
        expectedByteSize: remoteImage.bytes.byteLength,
        expectedContentType: remoteImage.contentType,
        sourceProvenance: "imported",
      },
    );

    await ingestProductImageUpload(
      db,
      tenantId,
      productPublicId,
      grant.grantToken,
      remoteImage.bytes,
    );

    return processProductImage(
      db,
      tenantId,
      membership,
      productPublicId,
      grant.assetPublicId,
      publisherSubject,
    );
  } catch (error) {
    mapMediaError(error);
  }
}

export async function getApprovedThumbnailPublicIdForProduct(
  tx: DbClient,
  tenantId: string,
  productId: string,
) {
  const [product] = await tx
    .select({ primaryMediaAssetId: catalogueProducts.primaryMediaAssetId })
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.id, productId),
      ),
    )
    .limit(1);

  if (!product) {
    return null;
  }

  const thumbnails = await getApprovedThumbnailPublicIdsForProducts(
    tx,
    tenantId,
    [{ id: productId, primaryMediaAssetId: product.primaryMediaAssetId }],
  );

  return thumbnails.get(productId) ?? null;
}

/**
 * A product has a usable photo when its primary media asset is approved and
 * has a thumbnail derivative. Returns productId -> thumbnail public ID for the
 * products that satisfy that rule.
 */
export async function getApprovedThumbnailPublicIdsForProducts(
  tx: DbClient,
  tenantId: string,
  products: Array<{ id: string; primaryMediaAssetId: string | null }>,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  const productIdsByAsset = new Map<string, string[]>();

  for (const product of products) {
    if (!product.primaryMediaAssetId) {
      continue;
    }
    const productIds = productIdsByAsset.get(product.primaryMediaAssetId) ?? [];
    productIds.push(product.id);
    productIdsByAsset.set(product.primaryMediaAssetId, productIds);
  }

  const assetIds = [...productIdsByAsset.keys()];
  if (assetIds.length === 0) {
    return result;
  }

  const rows = await tx
    .select({
      assetId: catalogueMediaAssets.id,
      publicDerivativeId: catalogueMediaDerivatives.publicDerivativeId,
    })
    .from(catalogueMediaAssets)
    .innerJoin(
      catalogueMediaDerivatives,
      and(
        eq(catalogueMediaDerivatives.tenantId, tenantId),
        eq(catalogueMediaDerivatives.assetId, catalogueMediaAssets.id),
        eq(catalogueMediaDerivatives.derivativeKind, "thumbnail"),
      ),
    )
    .where(
      and(
        eq(catalogueMediaAssets.tenantId, tenantId),
        eq(catalogueMediaAssets.status, "approved"),
        inArray(catalogueMediaAssets.id, assetIds),
      ),
    );

  for (const row of rows) {
    for (const productId of productIdsByAsset.get(row.assetId) ?? []) {
      result.set(productId, row.publicDerivativeId);
    }
  }

  return result;
}

export type RemoveProductPrimaryPhotoInput = {
  expectedVersion: number;
};

export type RemoveProductPrimaryPhotoResult = {
  version: number;
  removed: boolean;
};

/**
 * Clears the draft product's primary image without deleting the media asset
 * (provenance and audit history remain on the asset).
 */
export async function removeProductPrimaryPhoto(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  input: RemoveProductPrimaryPhotoInput,
  staffSubject: string,
): Promise<RemoveProductPrimaryPhotoResult> {
  if (membership.role !== "administrator" && membership.role !== "user") {
    throw new StaffAuthorizationError(
      "Administrator or catalogue editor membership is required for this action.",
    );
  }
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await requireMutableProduct(tx, tenantId, productPublicId);
      if (product.version !== input.expectedVersion) {
        throw new ProductMediaError(
          "Product was updated elsewhere. Reload and try again.",
          409,
          "expectedVersion",
        );
      }
      if (!product.primaryMediaAssetId) {
        return { version: product.version, removed: false };
      }

      const [previousAsset] = await tx
        .select({ publicId: catalogueMediaAssets.publicId })
        .from(catalogueMediaAssets)
        .where(
          and(
            eq(catalogueMediaAssets.tenantId, tenantId),
            eq(catalogueMediaAssets.id, product.primaryMediaAssetId),
          ),
        )
        .limit(1);

      const nextVersion = product.version + 1;
      const [updated] = await tx
        .update(catalogueProducts)
        .set({
          primaryMediaAssetId: null,
          version: nextVersion,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogueProducts.tenantId, tenantId),
            eq(catalogueProducts.id, product.id),
            eq(catalogueProducts.version, input.expectedVersion),
          ),
        )
        .returning({ id: catalogueProducts.id });

      if (!updated) {
        throw new ProductMediaError(
          "Product was updated elsewhere. Reload and try again.",
          409,
          "expectedVersion",
        );
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.media.primary_photo_removed",
        entityType: "catalogue_product",
        entityPublicId: productPublicId,
        entityVersion: nextVersion,
        changeSummary: {
          previousAssetPublicId: previousAsset?.publicId ?? null,
        },
      });

      return { version: nextVersion, removed: true };
    });
  } catch (error) {
    mapMediaError(error);
  }
}
