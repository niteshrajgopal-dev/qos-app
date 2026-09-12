import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  brands,
  catalogueProductTranslations,
  catalogueProducts,
  catalogueVariantPrices,
  catalogueVariants,
  tenants,
} from "@/db/schema";
import {
  type CreateDraftProductInput,
  type ProductLocale,
  type UpdateDraftProductInput,
  CatalogueValidationError,
  validateCreateDraftProductInput,
  validateUpdateDraftProductInput,
} from "@/lib/catalogue/validation";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { invalidateArabicApprovalAfterEnglishChange } from "@/lib/catalogue/translation-approval";
import { withTenantContext } from "@/lib/tenant/context";

export class CatalogueProductError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CatalogueProductError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export class CatalogueProductConflictError extends CatalogueProductError {
  constructor(message: string, field?: string) {
    super(message, 409, field);
    this.name = "CatalogueProductConflictError";
  }
}

export type DraftProductTranslationView = {
  displayName: string;
  description: string | null;
  translationVersion: number;
  approvalStatus: "draft" | "approved";
};

export type DraftProductEditorView = {
  publicId: string;
  internalName: string;
  status: "draft" | "active" | "archived";
  version: number;
  sku: string | null;
  barcode: string | null;
  primaryMediaAssetId: string | null;
  nutritionCalories: number | null;
  provenance: string;
  businessProfile: "hospitality" | "generic_retail";
  canEditPrice: boolean;
  translations: Record<ProductLocale, DraftProductTranslationView>;
  defaultVariant: {
    publicId: string;
    amountMinor: number;
    currency: string;
  };
};

function slugifyInternalName(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "product"
  );
}

function generateProductPublicId(internalName: string) {
  return `prd_${slugifyInternalName(internalName)}_${randomUUID().slice(0, 8)}`;
}

function generateDefaultVariantPublicId(productPublicId: string) {
  return `${productPublicId.replace(/^prd_/, "var_")}_default`;
}

function mapCatalogueError(error: unknown): never {
  if (error instanceof CatalogueValidationError) {
    throw new CatalogueProductError(error.message, 400, error.field);
  }

  if (error instanceof StaffAuthorizationError) {
    throw error;
  }

  if (error instanceof CatalogueProductError) {
    throw error;
  }

  throw error;
}

async function getTenantBusinessProfile(db: DbClient, tenantId: string) {
  const [tenant] = await db
    .select({
      businessProfile: tenants.businessProfile,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  if (!tenant) {
    throw new CatalogueProductError("Tenant not found.", 404);
  }

  return tenant.businessProfile;
}

async function resolveBrandId(
  db: DbClient,
  tenantId: string,
  brandPublicId: string | null,
) {
  if (brandPublicId) {
    const [brand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(
        and(eq(brands.tenantId, tenantId), eq(brands.publicId, brandPublicId)),
      )
      .limit(1);

    if (!brand) {
      throw new CatalogueProductError("Brand not found for this tenant.", 404);
    }

    return brand.id;
  }

  const [brand] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(eq(brands.tenantId, tenantId))
    .limit(1);

  if (!brand) {
    throw new CatalogueProductError("No brand is configured for this tenant.", 404);
  }

  return brand.id;
}

async function loadDraftProductEditorView(
  tx: DbClient,
  tenantId: string,
  productPublicId: string,
  membership: ActiveStaffMembership,
  businessProfile: "hospitality" | "generic_retail",
): Promise<DraftProductEditorView | null> {
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

  if (!product) {
    return null;
  }

  const translationRows = await tx
    .select()
    .from(catalogueProductTranslations)
    .where(
      and(
        eq(catalogueProductTranslations.tenantId, tenantId),
        eq(catalogueProductTranslations.productId, product.id),
      ),
    );

  const translations: Record<
    ProductLocale,
    DraftProductTranslationView
  > = {
    en: {
      displayName: "",
      description: null,
      translationVersion: 1,
      approvalStatus: "draft",
    },
    ar: {
      displayName: "",
      description: null,
      translationVersion: 1,
      approvalStatus: "draft",
    },
  };

  for (const row of translationRows) {
    const locale = row.locale as ProductLocale;
    if (locale !== "en" && locale !== "ar") {
      continue;
    }

    translations[locale] = {
      displayName: row.displayName,
      description: row.description,
      translationVersion: row.translationVersion,
      approvalStatus: row.approvalStatus,
    };
  }

  const [defaultVariant] = await tx
    .select({
      publicId: catalogueVariants.publicId,
      amountMinor: catalogueVariantPrices.amountMinor,
      currency: catalogueVariantPrices.currency,
    })
    .from(catalogueVariants)
    .innerJoin(
      catalogueVariantPrices,
      and(
        eq(catalogueVariantPrices.tenantId, tenantId),
        eq(catalogueVariantPrices.variantId, catalogueVariants.id),
      ),
    )
    .where(
      and(
        eq(catalogueVariants.tenantId, tenantId),
        eq(catalogueVariants.productId, product.id),
        eq(catalogueVariants.isDefault, true),
      ),
    )
    .limit(1);

  if (!defaultVariant) {
    throw new CatalogueProductError(
      "Default variant is missing for this product.",
      500,
    );
  }

  return {
    publicId: product.publicId,
    internalName: product.internalName,
    status: product.status,
    version: product.version,
    sku: product.sku,
    barcode: product.barcode,
    primaryMediaAssetId: product.primaryMediaAssetId,
    nutritionCalories: product.nutritionCalories,
    provenance: product.provenance,
    businessProfile,
    canEditPrice: membership.role === "administrator",
    translations,
    defaultVariant: {
      publicId: defaultVariant.publicId,
      amountMinor: defaultVariant.amountMinor,
      currency: defaultVariant.currency.trim(),
    },
  };
}

export async function createDraftProduct(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  input: CreateDraftProductInput,
): Promise<DraftProductEditorView> {
  try {
    const businessProfile = await getTenantBusinessProfile(db, tenantId);
    const validated = validateCreateDraftProductInput(input, businessProfile);

    return await withTenantContext(db, tenantId, async (tx) => {
      const brandId = await resolveBrandId(
        tx,
        tenantId,
        validated.brandPublicId,
      );
      const publicId = generateProductPublicId(validated.internalName);
      const variantPublicId = generateDefaultVariantPublicId(publicId);

      const [product] = await tx
        .insert(catalogueProducts)
        .values({
          tenantId,
          brandId,
          publicId,
          internalName: validated.internalName,
          status: "draft",
          provenance: "operator_entered",
          sku: validated.sku,
          barcode: validated.barcode,
          primaryMediaAssetId: validated.primaryMediaAssetId,
          nutritionCalories: validated.nutritionCalories,
        })
        .returning();

      for (const locale of ["en", "ar"] as const) {
        const translation = validated.translations[locale];
        await tx.insert(catalogueProductTranslations).values({
          tenantId,
          productId: product.id,
          locale,
          displayName: translation.displayName,
          description: translation.description,
        });
      }

      const [variant] = await tx
        .insert(catalogueVariants)
        .values({
          tenantId,
          productId: product.id,
          publicId: variantPublicId,
          isDefault: true,
          sortOrder: 0,
        })
        .returning();

      await tx.insert(catalogueVariantPrices).values({
        tenantId,
        variantId: variant.id,
        currency: validated.defaultVariant.currency,
        amountMinor: validated.defaultVariant.amountMinor,
      });

      const view = await loadDraftProductEditorView(
        tx,
        tenantId,
        product.publicId,
        membership,
        businessProfile,
      );

      if (!view) {
        throw new CatalogueProductError("Unable to load created product.", 500);
      }

      return view;
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function getDraftProduct(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
): Promise<DraftProductEditorView> {
  try {
    const businessProfile = await getTenantBusinessProfile(db, tenantId);

    return await withTenantContext(db, tenantId, async (tx) => {
      const view = await loadDraftProductEditorView(
        tx,
        tenantId,
        productPublicId,
        membership,
        businessProfile,
      );

      if (!view) {
        throw new CatalogueProductError("Product not found.", 404);
      }

      return view;
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function updateDraftProduct(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  input: UpdateDraftProductInput,
): Promise<DraftProductEditorView> {
  try {
    const businessProfile = await getTenantBusinessProfile(db, tenantId);
    const validated = validateUpdateDraftProductInput(input, businessProfile);

    if (
      validated.defaultVariant != null &&
      membership.role !== "administrator"
    ) {
      throw new StaffAuthorizationError(
        "Administrator membership is required to change product prices.",
      );
    }

    return await withTenantContext(db, tenantId, async (tx) => {
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

      if (!product) {
        throw new CatalogueProductError("Product not found.", 404);
      }

      if (product.version !== validated.expectedVersion) {
        throw new CatalogueProductConflictError(
          "Product was updated elsewhere. Reload and try again.",
          "expectedVersion",
        );
      }

      const productUpdates: Partial<typeof catalogueProducts.$inferInsert> = {
        updatedAt: new Date(),
        version: product.version + 1,
      };

      if (validated.internalName != null) {
        productUpdates.internalName = validated.internalName;
      }
      if (validated.sku !== undefined) {
        productUpdates.sku = validated.sku;
      }
      if (validated.barcode !== undefined) {
        productUpdates.barcode = validated.barcode;
      }
      if (validated.primaryMediaAssetId !== undefined) {
        productUpdates.primaryMediaAssetId = validated.primaryMediaAssetId;
      }
      if (validated.nutritionCalories !== undefined) {
        productUpdates.nutritionCalories = validated.nutritionCalories;
      }

      const [updatedProduct] = await tx
        .update(catalogueProducts)
        .set(productUpdates)
        .where(
          and(
            eq(catalogueProducts.tenantId, tenantId),
            eq(catalogueProducts.id, product.id),
            eq(catalogueProducts.version, validated.expectedVersion),
          ),
        )
        .returning({ id: catalogueProducts.id });

      if (!updatedProduct) {
        throw new CatalogueProductConflictError(
          "Product was updated elsewhere. Reload and try again.",
          "expectedVersion",
        );
      }

      for (const locale of ["en", "ar"] as const) {
        const patch = validated.translations?.[locale];
        if (!patch) {
          continue;
        }

        const [existingTranslation] = await tx
          .select()
          .from(catalogueProductTranslations)
          .where(
            and(
              eq(catalogueProductTranslations.tenantId, tenantId),
              eq(catalogueProductTranslations.productId, product.id),
              eq(catalogueProductTranslations.locale, locale),
            ),
          )
          .limit(1);

        if (!existingTranslation) {
          throw new CatalogueProductError(
            `Missing ${locale} translation for product.`,
            500,
          );
        }

        if (
          patch.expectedTranslationVersion != null &&
          existingTranslation.translationVersion !==
            patch.expectedTranslationVersion
        ) {
          throw new CatalogueProductConflictError(
            `${locale.toUpperCase()} translation was updated elsewhere. Reload and try again.`,
            `translations.${locale}.expectedTranslationVersion`,
          );
        }

        const nextDisplayName =
          patch.displayName?.trim() ?? existingTranslation.displayName;
        const nextDescription =
          patch.description === undefined
            ? existingTranslation.description
            : patch.description?.trim() || null;

        const translationChanged =
          nextDisplayName !== existingTranslation.displayName ||
          nextDescription !== existingTranslation.description;

        if (translationChanged) {
          await tx
            .update(catalogueProductTranslations)
            .set({
              displayName: nextDisplayName,
              description: nextDescription,
              translationVersion: existingTranslation.translationVersion + 1,
              approvalStatus: "draft",
              approvedBySubject: null,
              approvedAt: null,
              approvedTranslationVersion: null,
              approvedSourceTranslationVersion: null,
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(catalogueProductTranslations.tenantId, tenantId),
                eq(catalogueProductTranslations.id, existingTranslation.id),
                eq(
                  catalogueProductTranslations.translationVersion,
                  existingTranslation.translationVersion,
                ),
              ),
            );

          if (locale === "en") {
            await invalidateArabicApprovalAfterEnglishChange(
              tx,
              tenantId,
              product.id,
            );
          }
        }
      }

      if (validated.defaultVariant != null) {
        const [defaultVariant] = await tx
          .select({ id: catalogueVariants.id })
          .from(catalogueVariants)
          .where(
            and(
              eq(catalogueVariants.tenantId, tenantId),
              eq(catalogueVariants.productId, product.id),
              eq(catalogueVariants.isDefault, true),
            ),
          )
          .limit(1);

        if (!defaultVariant) {
          throw new CatalogueProductError(
            "Default variant is missing for this product.",
            500,
          );
        }

        const [currentPrice] = await tx
          .select({ version: catalogueVariantPrices.version })
          .from(catalogueVariantPrices)
          .where(
            and(
              eq(catalogueVariantPrices.tenantId, tenantId),
              eq(catalogueVariantPrices.variantId, defaultVariant.id),
            ),
          )
          .limit(1);

        if (!currentPrice) {
          throw new CatalogueProductError(
            "Default variant price is missing for this product.",
            500,
          );
        }

        await tx
          .update(catalogueVariantPrices)
          .set({
            amountMinor: validated.defaultVariant.amountMinor,
            version: currentPrice.version + 1,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(catalogueVariantPrices.tenantId, tenantId),
              eq(catalogueVariantPrices.variantId, defaultVariant.id),
            ),
          );
      }

      const view = await loadDraftProductEditorView(
        tx,
        tenantId,
        productPublicId,
        membership,
        businessProfile,
      );

      if (!view) {
        throw new CatalogueProductError("Unable to load updated product.", 500);
      }

      return view;
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}
