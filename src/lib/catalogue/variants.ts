import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  catalogueProducts,
  catalogueVariantPrices,
  catalogueVariants,
  catalogueVariantTranslations,
} from "@/db/schema";
import type { ProductLocale } from "@/lib/catalogue/validation";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import {
  assertDistinctVariantLabels,
  assertVariantLabelsForMultipleChoices,
  type CreateProductVariantInput,
  type ReorderProductVariantsInput,
  type UpdateProductVariantInput,
  validateCreateProductVariantInput,
  validateReorderProductVariantsInput,
  validateUpdateProductVariantInput,
} from "@/lib/catalogue/variant-validation";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export class CatalogueVariantError extends Error {
  readonly statusCode: number;
  readonly field?: string;

  constructor(message: string, statusCode = 400, field?: string) {
    super(message);
    this.name = "CatalogueVariantError";
    this.statusCode = statusCode;
    this.field = field;
  }
}

export class CatalogueVariantConflictError extends CatalogueVariantError {
  constructor(message: string, field?: string) {
    super(message, 409, field);
    this.name = "CatalogueVariantConflictError";
  }
}

export type DraftProductVariantView = {
  publicId: string;
  isDefault: boolean;
  sortOrder: number;
  status: "active" | "archived";
  sku: string | null;
  barcode: string | null;
  currency: string | null;
  amountMinor: number | null;
  priceVersion: number | null;
  translations: Record<ProductLocale, { displayName: string }>;
};

export type ProductVariantsEditorView = {
  productPublicId: string;
  productVersion: number;
  canEditPrice: boolean;
  variants: DraftProductVariantView[];
};

function slugifyLabel(label: string) {
  return (
    label
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 24) || "variant"
  );
}

function generateVariantPublicId(label?: string) {
  const slug = label ? slugifyLabel(label) : "choice";
  return `var_${slug}_${randomUUID().slice(0, 8)}`;
}

function mapCatalogueError(error: unknown): never {
  if (error instanceof CatalogueValidationError) {
    throw new CatalogueVariantError(error.message, 400, error.field);
  }

  if (error instanceof StaffAuthorizationError) {
    throw error;
  }

  if (error instanceof CatalogueVariantError) {
    throw error;
  }

  throw error;
}

async function loadProductForVariants(
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

  if (!product) {
    throw new CatalogueVariantError("Product not found.", 404);
  }

  return product;
}

async function bumpProductVersion(
  tx: DbClient,
  tenantId: string,
  productId: string,
  expectedVersion: number,
) {
  const [updatedProduct] = await tx
    .update(catalogueProducts)
    .set({
      version: expectedVersion + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.id, productId),
        eq(catalogueProducts.version, expectedVersion),
      ),
    )
    .returning({
      id: catalogueProducts.id,
      publicId: catalogueProducts.publicId,
      version: catalogueProducts.version,
    });

  if (!updatedProduct) {
    throw new CatalogueVariantConflictError(
      "Product was updated elsewhere. Reload and try again.",
      "expectedProductVersion",
    );
  }

  return updatedProduct;
}

async function assertUniqueVariantIdentifiers(
  tx: DbClient,
  tenantId: string,
  input: {
    sku?: string | null;
    barcode?: string | null;
    excludeVariantId?: string;
  },
) {
  if (input.sku) {
    const [existingSku] = await tx
      .select({ publicId: catalogueVariants.publicId })
      .from(catalogueVariants)
      .where(
        and(
          eq(catalogueVariants.tenantId, tenantId),
          eq(catalogueVariants.sku, input.sku),
          input.excludeVariantId
            ? ne(catalogueVariants.id, input.excludeVariantId)
            : undefined,
        ),
      )
      .limit(1);

    if (existingSku) {
      throw new CatalogueVariantError(
        "SKU is already assigned to another variant.",
        409,
        "sku",
      );
    }
  }

  if (input.barcode) {
    const [existingBarcode] = await tx
      .select({ publicId: catalogueVariants.publicId })
      .from(catalogueVariants)
      .where(
        and(
          eq(catalogueVariants.tenantId, tenantId),
          eq(catalogueVariants.barcode, input.barcode),
          input.excludeVariantId
            ? ne(catalogueVariants.id, input.excludeVariantId)
            : undefined,
        ),
      )
      .limit(1);

    if (existingBarcode) {
      throw new CatalogueVariantError(
        "Barcode is already assigned to another variant.",
        409,
        "barcode",
      );
    }
  }
}

async function loadVariantTranslations(
  tx: DbClient,
  tenantId: string,
  variantIds: string[],
) {
  if (variantIds.length === 0) {
    return new Map<string, Record<ProductLocale, { displayName: string }>>();
  }

  const rows = await tx
    .select()
    .from(catalogueVariantTranslations)
    .where(
      and(
        eq(catalogueVariantTranslations.tenantId, tenantId),
        inArray(catalogueVariantTranslations.variantId, variantIds),
      ),
    );

  const byVariantId = new Map<
    string,
    Record<ProductLocale, { displayName: string }>
  >();

  for (const variantId of variantIds) {
    byVariantId.set(variantId, {
      en: { displayName: "" },
      ar: { displayName: "" },
    });
  }

  for (const row of rows) {
    const locale = row.locale as ProductLocale;
    if (locale !== "en" && locale !== "ar") {
      continue;
    }

    const existing = byVariantId.get(row.variantId);
    if (!existing) {
      continue;
    }

    existing[locale] = { displayName: row.displayName };
  }

  return byVariantId;
}

async function loadProductVariantsInTx(
  tx: DbClient,
  tenantId: string,
  productId: string,
): Promise<DraftProductVariantView[]> {
  const variantRows = await tx
    .select({
      id: catalogueVariants.id,
      publicId: catalogueVariants.publicId,
      isDefault: catalogueVariants.isDefault,
      sortOrder: catalogueVariants.sortOrder,
      status: catalogueVariants.status,
      sku: catalogueVariants.sku,
      barcode: catalogueVariants.barcode,
      currency: catalogueVariantPrices.currency,
      amountMinor: catalogueVariantPrices.amountMinor,
      priceVersion: catalogueVariantPrices.version,
    })
    .from(catalogueVariants)
    .leftJoin(
      catalogueVariantPrices,
      and(
        eq(catalogueVariantPrices.tenantId, tenantId),
        eq(catalogueVariantPrices.variantId, catalogueVariants.id),
      ),
    )
    .where(
      and(
        eq(catalogueVariants.tenantId, tenantId),
        eq(catalogueVariants.productId, productId),
      ),
    )
    .orderBy(asc(catalogueVariants.sortOrder), asc(catalogueVariants.publicId));

  const translationsByVariantId = await loadVariantTranslations(
    tx,
    tenantId,
    variantRows.map((row) => row.id),
  );

  return variantRows.map((row) => ({
    publicId: row.publicId,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    status: row.status === "archived" ? "archived" : "active",
    sku: row.sku,
    barcode: row.barcode,
    currency: row.currency?.trim() ?? null,
    amountMinor: row.amountMinor ?? null,
    priceVersion: row.priceVersion ?? null,
    translations: translationsByVariantId.get(row.id) ?? {
      en: { displayName: "" },
      ar: { displayName: "" },
    },
  }));
}

function validateActiveVariantLabelSet(
  variants: DraftProductVariantView[],
  candidate?: {
    publicId: string;
    translations: Partial<Record<ProductLocale, { displayName: string }>>;
  },
) {
  const activeVariants = variants.filter((variant) => variant.status === "active");

  const mergedVariants = activeVariants.map((variant) => {
    if (!candidate || candidate.publicId !== variant.publicId) {
      return variant;
    }

    return {
      ...variant,
      translations: {
        en: {
          displayName:
            candidate.translations.en?.displayName ??
            variant.translations.en.displayName,
        },
        ar: {
          displayName:
            candidate.translations.ar?.displayName ??
            variant.translations.ar.displayName,
        },
      },
    };
  });

  if (candidate && !mergedVariants.some((v) => v.publicId === candidate.publicId)) {
    mergedVariants.push({
      publicId: candidate.publicId,
      isDefault: false,
      sortOrder: 0,
      status: "active",
      sku: null,
      barcode: null,
      currency: null,
      amountMinor: null,
      priceVersion: null,
      translations: {
        en: { displayName: candidate.translations.en?.displayName ?? "" },
        ar: { displayName: candidate.translations.ar?.displayName ?? "" },
      },
    });
  }

  const activeMerged = mergedVariants.filter((variant) => variant.status === "active");

  for (const variant of activeMerged) {
    assertVariantLabelsForMultipleChoices(
      activeMerged.length,
      variant.translations,
      variant.publicId,
    );
  }

  for (const locale of ["en", "ar"] as const) {
    assertDistinctVariantLabels(
      activeMerged.map((variant) => ({
        publicId: variant.publicId,
        displayName: variant.translations[locale].displayName,
      })),
      locale,
    );
  }

}

async function upsertVariantTranslations(
  tx: DbClient,
  tenantId: string,
  variantId: string,
  translations: Partial<Record<ProductLocale, { displayName: string }>>,
) {
  for (const locale of ["en", "ar"] as const) {
    const translation = translations[locale];
    if (!translation) {
      continue;
    }

    const [existing] = await tx
      .select({ id: catalogueVariantTranslations.id })
      .from(catalogueVariantTranslations)
      .where(
        and(
          eq(catalogueVariantTranslations.tenantId, tenantId),
          eq(catalogueVariantTranslations.variantId, variantId),
          eq(catalogueVariantTranslations.locale, locale),
        ),
      )
      .limit(1);

    if (existing) {
      await tx
        .update(catalogueVariantTranslations)
        .set({
          displayName: translation.displayName,
          updatedAt: new Date(),
        })
        .where(eq(catalogueVariantTranslations.id, existing.id));
      continue;
    }

    await tx.insert(catalogueVariantTranslations).values({
      tenantId,
      variantId,
      locale,
      displayName: translation.displayName,
    });
  }
}

async function clearDefaultVariantFlag(
  tx: DbClient,
  tenantId: string,
  productId: string,
  excludeVariantId?: string,
) {
  await tx
    .update(catalogueVariants)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(
      and(
        eq(catalogueVariants.tenantId, tenantId),
        eq(catalogueVariants.productId, productId),
        excludeVariantId
          ? ne(catalogueVariants.id, excludeVariantId)
          : undefined,
      ),
    );
}

async function setVariantPrice(
  tx: DbClient,
  tenantId: string,
  variantId: string,
  currency: string,
  amountMinor: number | null,
) {
  const [currentPrice] = await tx
    .select()
    .from(catalogueVariantPrices)
    .where(
      and(
        eq(catalogueVariantPrices.tenantId, tenantId),
        eq(catalogueVariantPrices.variantId, variantId),
      ),
    )
    .limit(1);

  if (amountMinor == null) {
    if (currentPrice) {
      await tx
        .delete(catalogueVariantPrices)
        .where(eq(catalogueVariantPrices.id, currentPrice.id));
    }
    return null;
  }

  if (currentPrice) {
    await tx
      .update(catalogueVariantPrices)
      .set({
        amountMinor,
        version: currentPrice.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(catalogueVariantPrices.id, currentPrice.id));

    return currentPrice.version + 1;
  }

  await tx.insert(catalogueVariantPrices).values({
    tenantId,
    variantId,
    currency,
    amountMinor,
  });

  return 1;
}

export async function listProductVariants(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
): Promise<ProductVariantsEditorView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await loadProductForVariants(tx, tenantId, productPublicId);
      const variants = await loadProductVariantsInTx(tx, tenantId, product.id);

      return {
        productPublicId: product.publicId,
        productVersion: product.version,
        canEditPrice: membership.role === "administrator",
        variants,
      };
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function createProductVariant(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  input: CreateProductVariantInput,
  staffSubject: string,
): Promise<ProductVariantsEditorView> {
  try {
    const validated = validateCreateProductVariantInput(input);

    if (validated.amountMinor != null && membership.role !== "administrator") {
      throw new StaffAuthorizationError(
        "Administrator membership is required to change variant prices.",
      );
    }

    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await loadProductForVariants(tx, tenantId, productPublicId);

      if (validated.publicId) {
        const [existingVariant] = await tx
          .select({ id: catalogueVariants.id })
          .from(catalogueVariants)
          .where(
            and(
              eq(catalogueVariants.tenantId, tenantId),
              eq(catalogueVariants.productId, product.id),
              eq(catalogueVariants.publicId, validated.publicId),
            ),
          )
          .limit(1);

        if (existingVariant) {
          return {
            productPublicId: product.publicId,
            productVersion: product.version,
            canEditPrice: membership.role === "administrator",
            variants: await loadProductVariantsInTx(tx, tenantId, product.id),
          };
        }
      }

      await assertUniqueVariantIdentifiers(tx, tenantId, {
        sku: validated.sku,
        barcode: validated.barcode,
      });

      const existingVariants = await loadProductVariantsInTx(tx, tenantId, product.id);
      const nextSortOrder =
        validated.sortOrder ??
        (existingVariants.length === 0
          ? 0
          : Math.max(...existingVariants.map((variant) => variant.sortOrder)) + 1);

      const labelSeed =
        validated.translations.en?.displayName ||
        validated.translations.ar?.displayName;
      const publicId = validated.publicId ?? generateVariantPublicId(labelSeed);

      validateActiveVariantLabelSet(existingVariants, {
        publicId,
        translations: validated.translations,
      });

      const updatedProduct = await bumpProductVersion(
        tx,
        tenantId,
        product.id,
        validated.expectedProductVersion,
      );

      const shouldBeDefault =
        validated.isDefault || existingVariants.every((variant) => !variant.isDefault);

      if (shouldBeDefault) {
        await clearDefaultVariantFlag(tx, tenantId, product.id);
      }

      const [variant] = await tx
        .insert(catalogueVariants)
        .values({
          tenantId,
          productId: product.id,
          publicId,
          isDefault: shouldBeDefault,
          sortOrder: nextSortOrder,
          status: "active",
          sku: validated.sku,
          barcode: validated.barcode,
        })
        .returning();

      await upsertVariantTranslations(tx, tenantId, variant.id, {
        en: {
          displayName: validated.translations.en?.displayName ?? "",
        },
        ar: {
          displayName: validated.translations.ar?.displayName ?? "",
        },
      });

      let priceVersion: number | null = null;
      if (validated.amountMinor != null) {
        priceVersion = await setVariantPrice(
          tx,
          tenantId,
          variant.id,
          validated.currency,
          validated.amountMinor,
        );
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.variant.create",
        entityType: "catalogue_variant",
        entityPublicId: publicId,
        entityVersion: updatedProduct.version,
        changeSummary: {
          productPublicId,
          sortOrder: nextSortOrder,
          isDefault: shouldBeDefault,
          amountMinor: validated.amountMinor,
          currency: validated.currency,
        },
      });

      if (priceVersion != null && validated.amountMinor != null) {
        await recordTenantAuditEventInTx(tx, {
          tenantId,
          actorSubject: staffSubject,
          actorClass: auditActorClassFromStaffRole(membership.role),
          action: "catalogue.central_price.update",
          entityType: "catalogue_variant",
          entityPublicId: publicId,
          entityVersion: priceVersion,
          changeSummary: {
            currency: validated.currency,
            before: { amountMinor: null },
            after: { amountMinor: validated.amountMinor },
          },
        });
      }

      return {
        productPublicId: updatedProduct.publicId,
        productVersion: updatedProduct.version,
        canEditPrice: membership.role === "administrator",
        variants: await loadProductVariantsInTx(tx, tenantId, product.id),
      };
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function updateProductVariant(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  variantPublicId: string,
  input: UpdateProductVariantInput,
  staffSubject: string,
): Promise<ProductVariantsEditorView> {
  try {
    const validated = validateUpdateProductVariantInput(input);

    if (validated.amountMinor !== undefined && membership.role !== "administrator") {
      throw new StaffAuthorizationError(
        "Administrator membership is required to change variant prices.",
      );
    }

    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await loadProductForVariants(tx, tenantId, productPublicId);

      const [variant] = await tx
        .select()
        .from(catalogueVariants)
        .where(
          and(
            eq(catalogueVariants.tenantId, tenantId),
            eq(catalogueVariants.productId, product.id),
            eq(catalogueVariants.publicId, variantPublicId),
          ),
        )
        .limit(1);

      if (!variant) {
        throw new CatalogueVariantError("Variant not found.", 404);
      }

      const existingVariants = await loadProductVariantsInTx(tx, tenantId, product.id);
      const nextStatus: "active" | "archived" =
        validated.status ??
        (variant.status === "archived" ? "archived" : "active");
      const mergedTranslations = {
        en: {
          displayName:
            validated.translations.en?.displayName ??
            existingVariants.find((entry) => entry.publicId === variantPublicId)
              ?.translations.en.displayName ??
            "",
        },
        ar: {
          displayName:
            validated.translations.ar?.displayName ??
            existingVariants.find((entry) => entry.publicId === variantPublicId)
              ?.translations.ar.displayName ??
            "",
        },
      };

      const projectedVariants = existingVariants.map((entry) =>
        entry.publicId === variantPublicId
          ? {
              ...entry,
              status: nextStatus,
              translations: mergedTranslations,
            }
          : entry,
      );

      const activeCount = projectedVariants.filter(
        (entry) => entry.status === "active",
      ).length;

      if (activeCount === 0) {
        throw new CatalogueVariantError(
          "A product must keep at least one active variant.",
          400,
          "status",
        );
      }

      if (nextStatus === "archived" && variant.isDefault) {
        throw new CatalogueVariantError(
          "Set another variant as default before archiving the current default.",
          400,
          "status",
        );
      }

      validateActiveVariantLabelSet(projectedVariants);

      await assertUniqueVariantIdentifiers(tx, tenantId, {
        sku: validated.sku === undefined ? variant.sku : validated.sku,
        barcode:
          validated.barcode === undefined ? variant.barcode : validated.barcode,
        excludeVariantId: variant.id,
      });

      const updatedProduct = await bumpProductVersion(
        tx,
        tenantId,
        product.id,
        validated.expectedProductVersion,
      );

      if (validated.isDefault) {
        await clearDefaultVariantFlag(tx, tenantId, product.id, variant.id);
      }

      const [updatedVariant] = await tx
        .update(catalogueVariants)
        .set({
          sortOrder: validated.sortOrder ?? variant.sortOrder,
          isDefault: validated.isDefault ?? variant.isDefault,
          status: nextStatus,
          sku: validated.sku === undefined ? variant.sku : validated.sku,
          barcode:
            validated.barcode === undefined ? variant.barcode : validated.barcode,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(catalogueVariants.tenantId, tenantId),
            eq(catalogueVariants.id, variant.id),
          ),
        )
        .returning();

      if (!updatedVariant) {
        throw new CatalogueVariantError("Unable to update variant.", 500);
      }

      await upsertVariantTranslations(tx, tenantId, variant.id, validated.translations);

      let priceVersion: number | null = null;
      if (validated.amountMinor !== undefined) {
        const [currentPrice] = await tx
          .select({
            amountMinor: catalogueVariantPrices.amountMinor,
            currency: catalogueVariantPrices.currency,
            version: catalogueVariantPrices.version,
          })
          .from(catalogueVariantPrices)
          .where(
            and(
              eq(catalogueVariantPrices.tenantId, tenantId),
              eq(catalogueVariantPrices.variantId, variant.id),
            ),
          )
          .limit(1);

        priceVersion = await setVariantPrice(
          tx,
          tenantId,
          variant.id,
          currentPrice?.currency.trim() ?? "AED",
          validated.amountMinor,
        );

        if (
          validated.amountMinor != null &&
          validated.amountMinor !== currentPrice?.amountMinor
        ) {
          await recordTenantAuditEventInTx(tx, {
            tenantId,
            actorSubject: staffSubject,
            actorClass: auditActorClassFromStaffRole(membership.role),
            action: "catalogue.central_price.update",
            entityType: "catalogue_variant",
            entityPublicId: variantPublicId,
            entityVersion: priceVersion,
            changeSummary: {
              currency: currentPrice?.currency.trim() ?? "AED",
              before: { amountMinor: currentPrice?.amountMinor ?? null },
              after: { amountMinor: validated.amountMinor },
            },
          });
        }
      }

      const action =
        validated.status === "archived"
          ? "catalogue.variant.archive"
          : "catalogue.variant.update";

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action,
        entityType: "catalogue_variant",
        entityPublicId: variantPublicId,
        entityVersion: updatedProduct.version,
        changeSummary: {
          productPublicId,
          status: nextStatus,
          isDefault: updatedVariant.isDefault,
          sortOrder: updatedVariant.sortOrder,
        },
      });

      return {
        productPublicId: updatedProduct.publicId,
        productVersion: updatedProduct.version,
        canEditPrice: membership.role === "administrator",
        variants: await loadProductVariantsInTx(tx, tenantId, product.id),
      };
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function reorderProductVariants(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  input: ReorderProductVariantsInput,
  staffSubject: string,
): Promise<ProductVariantsEditorView> {
  try {
    const validated = validateReorderProductVariantsInput(input);

    return await withTenantContext(db, tenantId, async (tx) => {
      const product = await loadProductForVariants(tx, tenantId, productPublicId);
      const variants = await tx
        .select({
          id: catalogueVariants.id,
          publicId: catalogueVariants.publicId,
          status: catalogueVariants.status,
        })
        .from(catalogueVariants)
        .where(
          and(
            eq(catalogueVariants.tenantId, tenantId),
            eq(catalogueVariants.productId, product.id),
          ),
        );

      const activePublicIds = variants
        .filter((variant) => variant.status !== "archived")
        .map((variant) => variant.publicId)
        .sort();

      const requestedActiveIds = [...validated.orderedPublicIds].sort();

      if (activePublicIds.join("|") !== requestedActiveIds.join("|")) {
        throw new CatalogueVariantError(
          "orderedPublicIds must include every active variant exactly once.",
          400,
          "orderedPublicIds",
        );
      }

      const updatedProduct = await bumpProductVersion(
        tx,
        tenantId,
        product.id,
        validated.expectedProductVersion,
      );

      for (const [index, publicId] of validated.orderedPublicIds.entries()) {
        await tx
          .update(catalogueVariants)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(
            and(
              eq(catalogueVariants.tenantId, tenantId),
              eq(catalogueVariants.productId, product.id),
              eq(catalogueVariants.publicId, publicId),
            ),
          );
      }

      await recordTenantAuditEventInTx(tx, {
        tenantId,
        actorSubject: staffSubject,
        actorClass: auditActorClassFromStaffRole(membership.role),
        action: "catalogue.variant.reorder",
        entityType: "catalogue_product",
        entityPublicId: productPublicId,
        entityVersion: updatedProduct.version,
        changeSummary: {
          orderedPublicIds: validated.orderedPublicIds,
        },
      });

      return {
        productPublicId: updatedProduct.publicId,
        productVersion: updatedProduct.version,
        canEditPrice: membership.role === "administrator",
        variants: await loadProductVariantsInTx(tx, tenantId, product.id),
      };
    });
  } catch (error) {
    return mapCatalogueError(error);
  }
}
