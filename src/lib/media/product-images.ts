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
import {
  generateImageDerivatives,
  MediaValidationError,
  validateImageBytes,
} from "@/lib/media/validation";
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
    throw new ProductMediaError("Product not found.", 404);
  }

  return product;
}

export type CreateUploadGrantInput = {
  expectedByteSize: number;
  expectedContentType: "image/jpeg" | "image/png";
  altTextEn?: string | null;
  altTextAr?: string | null;
};

export async function createProductImageUploadGrant(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
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

  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await requireDraftProduct(tx, tenantId, productPublicId);
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
        assetPublicId: asset.publicId,
        grantToken: grant.grantToken,
        expiresAt: grant.expiresAt.toISOString(),
        uploadPath: `/api/tenants/${tenantId}/catalogue/products/${productPublicId}/media/upload`,
      };
    });
  } catch (error) {
    mapMediaError(error);
  }
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
      const product = await requireDraftProduct(tx, tenantId, productPublicId);

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
    return await withTenantContext(db, tenantId, async (tx) => {
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
    });
  } catch (error) {
    mapMediaError(error);
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

  if (!product?.primaryMediaAssetId) {
    return null;
  }

  const [asset] = await tx
    .select({ status: catalogueMediaAssets.status })
    .from(catalogueMediaAssets)
    .where(
      and(
        eq(catalogueMediaAssets.tenantId, tenantId),
        eq(catalogueMediaAssets.id, product.primaryMediaAssetId),
      ),
    )
    .limit(1);

  if (!asset || asset.status !== "approved") {
    return null;
  }

  const [derivative] = await tx
    .select({ publicDerivativeId: catalogueMediaDerivatives.publicDerivativeId })
    .from(catalogueMediaDerivatives)
    .where(
      and(
        eq(catalogueMediaDerivatives.tenantId, tenantId),
        eq(catalogueMediaDerivatives.assetId, product.primaryMediaAssetId),
        eq(catalogueMediaDerivatives.derivativeKind, "thumbnail"),
      ),
    )
    .limit(1);

  return derivative?.publicDerivativeId ?? null;
}
