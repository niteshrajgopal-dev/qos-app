import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

import type { DbClient } from "@/db/client";
import {
  brands,
  catalogueProductTranslations,
  catalogueProducts,
  catalogueVariantPrices,
  catalogueVariants,
  catalogueVariantTranslations,
  tenants,
} from "@/db/schema";
import type { DraftProductVariantView } from "@/lib/catalogue/variants";
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
import { translationTextMatchesLastApproved } from "@/lib/catalogue/translation-admin-review-snapshot";
import { invalidateArabicApprovalAfterEnglishChange } from "@/lib/catalogue/translation-approval";
import {
  auditActorClassFromStaffRole,
  recordTenantAuditEventInTx,
} from "@/lib/audit/tenant-audit";
import {
  CatalogueProductMutationGuardError,
  CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE,
  loadCatalogueProductForMutationInTx,
} from "@/lib/catalogue/product-mutation-policy";
import { type TenantDbExecutor, withTenantContext } from "@/lib/tenant/context";

export const CATALOGUE_PRODUCT_ARCHIVE_CODES = {
  NOT_DRAFT: "product_not_draft",
  ALREADY_ARCHIVED: "product_already_archived",
  IN_PUBLISHED_MENU: "product_in_published_menu",
} as const;

export const CATALOGUE_PRODUCT_RESTORE_CODES = {
  NOT_ARCHIVED: "product_not_archived",
} as const;

export class CatalogueProductError extends Error {
  readonly statusCode: number;
  readonly field?: string;
  readonly code?: string;

  constructor(
    message: string,
    statusCode = 400,
    field?: string,
    code?: string,
  ) {
    super(message);
    this.name = "CatalogueProductError";
    this.statusCode = statusCode;
    this.field = field;
    this.code = code;
  }
}

export class CatalogueProductConflictError extends CatalogueProductError {
  constructor(message: string, field?: string, code?: string) {
    super(message, 409, field, code);
    this.name = "CatalogueProductConflictError";
  }
}

export type ArchivedCatalogueProductView = {
  publicId: string;
  status: "archived";
  version: number;
};

export type RestoredCatalogueProductView = {
  publicId: string;
  status: "draft";
  version: number;
};

export type DraftProductTranslationView = {
  displayName: string;
  description: string | null;
  translationVersion: number;
  approvalStatus: "draft" | "approved" | "rejected";
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
  variants: DraftProductVariantView[];
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
  if (error instanceof CatalogueProductMutationGuardError) {
    if (error.statusCode === 404) {
      throw new CatalogueProductError(error.message, 404, error.field);
    }
    if (error.code === CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE) {
      throw new CatalogueProductConflictError(
        error.message,
        error.field,
        error.code,
      );
    }
    throw new CatalogueProductError(
      error.message,
      error.statusCode,
      error.field,
      error.code,
    );
  }

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

async function getTenantBusinessProfile(
  executor: TenantDbExecutor,
  tenantId: string,
) {
  const [tenant] = await executor
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
    throw new CatalogueProductError(
      "No brand is configured for this tenant.",
      404,
    );
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

  const translations: Record<ProductLocale, DraftProductTranslationView> = {
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
        eq(catalogueVariants.productId, product.id),
      ),
    )
    .orderBy(asc(catalogueVariants.sortOrder), asc(catalogueVariants.publicId));

  const variantTranslationRows =
    variantRows.length === 0
      ? []
      : await tx
          .select()
          .from(catalogueVariantTranslations)
          .where(
            and(
              eq(catalogueVariantTranslations.tenantId, tenantId),
              inArray(
                catalogueVariantTranslations.variantId,
                variantRows.map((row) => row.id),
              ),
            ),
          );

  const translationsByVariantId = new Map<
    string,
    Record<ProductLocale, { displayName: string }>
  >();

  for (const row of variantRows) {
    translationsByVariantId.set(row.id, {
      en: { displayName: "" },
      ar: { displayName: "" },
    });
  }

  for (const row of variantTranslationRows) {
    const locale = row.locale as ProductLocale;
    if (locale !== "en" && locale !== "ar") {
      continue;
    }

    const existing = translationsByVariantId.get(row.variantId);
    if (!existing) {
      continue;
    }

    existing[locale] = { displayName: row.displayName };
  }

  const variants: DraftProductVariantView[] = variantRows.map((row) => ({
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

  const defaultVariant = variants.find((variant) => variant.isDefault);

  if (
    !defaultVariant ||
    defaultVariant.amountMinor == null ||
    !defaultVariant.currency
  ) {
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
      currency: defaultVariant.currency,
    },
    variants,
  };
}

export async function createDraftProduct(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  input: CreateDraftProductInput,
): Promise<DraftProductEditorView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) => {
      const businessProfile = await getTenantBusinessProfile(tx, tenantId);
      const validated = validateCreateDraftProductInput(input, businessProfile);
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
          provenance: validated.provenance,
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

      for (const locale of ["en", "ar"] as const) {
        await tx.insert(catalogueVariantTranslations).values({
          tenantId,
          variantId: variant.id,
          locale,
          displayName: "",
        });
      }

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

export async function getDraftProductInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
): Promise<DraftProductEditorView> {
  const businessProfile = await getTenantBusinessProfile(tx, tenantId);
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
}

export async function getDraftProduct(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
): Promise<DraftProductEditorView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) =>
      getDraftProductInTx(tx, tenantId, membership, productPublicId),
    );
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function updateDraftProductInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  input: UpdateDraftProductInput,
  staffSubject: string,
): Promise<DraftProductEditorView> {
  const businessProfile = await getTenantBusinessProfile(tx, tenantId);
  const validated = validateUpdateDraftProductInput(input, businessProfile);
  const product = await loadCatalogueProductForMutationInTx(
    tx,
    tenantId,
    productPublicId,
  );

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
      const matchesLastApproved = translationTextMatchesLastApproved(
        existingTranslation,
        nextDisplayName,
        nextDescription,
      );

      const translationUpdates: Partial<typeof catalogueProductTranslations.$inferInsert> =
        {
          displayName: nextDisplayName,
          description: nextDescription,
          translationVersion: existingTranslation.translationVersion + 1,
          updatedAt: new Date(),
        };

      if (matchesLastApproved && existingTranslation.lastApprovedTranslationVersion != null) {
        translationUpdates.approvalStatus = "approved";
        translationUpdates.approvedBySubject = existingTranslation.lastApprovedBySubject;
        translationUpdates.approvedAt = existingTranslation.lastApprovedAt;
        translationUpdates.approvedTranslationVersion =
          existingTranslation.lastApprovedTranslationVersion;
        translationUpdates.approvedSourceTranslationVersion =
          existingTranslation.lastApprovedSourceTranslationVersion;
      } else {
        translationUpdates.approvalStatus = "draft";
        translationUpdates.approvedBySubject = null;
        translationUpdates.approvedAt = null;
        translationUpdates.approvedTranslationVersion = null;
        translationUpdates.approvedSourceTranslationVersion = null;
      }

      await tx
        .update(catalogueProductTranslations)
        .set(translationUpdates)
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
      .select({
        version: catalogueVariantPrices.version,
        amountMinor: catalogueVariantPrices.amountMinor,
        currency: catalogueVariantPrices.currency,
      })
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

    await recordTenantAuditEventInTx(tx, {
      tenantId,
      actorSubject: staffSubject,
      actorClass: auditActorClassFromStaffRole(membership.role),
      action: "catalogue.central_price.update",
      entityType: "catalogue_product",
      entityPublicId: productPublicId,
      entityVersion: currentPrice.version + 1,
      changeSummary: {
        currency: currentPrice.currency.trim(),
        before: { amountMinor: currentPrice.amountMinor },
        after: { amountMinor: validated.defaultVariant.amountMinor },
      },
    });
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
}

export async function updateDraftProduct(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  productPublicId: string,
  input: UpdateDraftProductInput,
  staffSubject: string,
): Promise<DraftProductEditorView> {
  try {
    if (input.defaultVariant != null && membership.role !== "administrator") {
      throw new StaffAuthorizationError(
        "Administrator membership is required to change product prices.",
      );
    }

    return await withTenantContext(db, tenantId, async (tx) =>
      updateDraftProductInTx(
        tx,
        tenantId,
        membership,
        productPublicId,
        input,
        staffSubject,
      ),
    );
  } catch (error) {
    return mapCatalogueError(error);
  }
}

async function isProductInPublishedMenuRevision(
  tx: TenantDbExecutor,
  tenantId: string,
  productPublicId: string,
): Promise<boolean> {
  const rows = await tx.execute<{ exists: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1
      FROM qos.catalogue_menu_live_revisions AS r
      WHERE r.tenant_id = ${tenantId}
        AND EXISTS (
          SELECT 1
          FROM jsonb_array_elements(r.payload->'sections') AS section,
               jsonb_array_elements(section->'products') AS product
          WHERE product->>'productPublicId' = ${productPublicId}
        )
    ) AS "exists"
  `);

  return rows[0]?.exists === true;
}

export async function archiveDraftProductInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  publicId: string,
  actor: string,
): Promise<ArchivedCatalogueProductView> {
  const [product] = await tx
    .select()
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.publicId, publicId),
      ),
    )
    .limit(1)
    .for("update");

  if (!product) {
    throw new CatalogueProductError("Product not found.", 404);
  }

  if (product.status === "archived") {
    throw new CatalogueProductConflictError(
      "Product is already archived.",
      "status",
      CATALOGUE_PRODUCT_ARCHIVE_CODES.ALREADY_ARCHIVED,
    );
  }

  if (product.status === "active") {
    throw new CatalogueProductConflictError(
      "Only draft products can be archived.",
      "status",
      CATALOGUE_PRODUCT_ARCHIVE_CODES.NOT_DRAFT,
    );
  }

  if (product.status !== "draft") {
    throw new CatalogueProductConflictError(
      "Only draft products can be archived.",
      "status",
      CATALOGUE_PRODUCT_ARCHIVE_CODES.NOT_DRAFT,
    );
  }

  if (await isProductInPublishedMenuRevision(tx, tenantId, publicId)) {
    throw new CatalogueProductConflictError(
      "This product appears in a published menu and cannot be archived.",
      "status",
      CATALOGUE_PRODUCT_ARCHIVE_CODES.IN_PUBLISHED_MENU,
    );
  }

  const nextVersion = product.version + 1;

  await tx
    .update(catalogueProducts)
    .set({
      status: "archived",
      version: nextVersion,
      updatedAt: new Date(),
    })
    .where(eq(catalogueProducts.id, product.id));

  await recordTenantAuditEventInTx(tx, {
    tenantId,
    actorSubject: actor,
    actorClass: "staff_administrator",
    action: "catalogue.product.archived",
    entityType: "catalogue_product",
    entityPublicId: publicId,
    entityVersion: nextVersion,
    changeSummary: {
      previousStatus: product.status,
      status: "archived",
    },
  });

  return {
    publicId,
    status: "archived",
    version: nextVersion,
  };
}

export async function archiveDraftProduct(
  db: DbClient,
  tenantId: string,
  publicId: string,
  actor: string,
): Promise<ArchivedCatalogueProductView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) =>
      archiveDraftProductInTx(tx, tenantId, publicId, actor),
    );
  } catch (error) {
    return mapCatalogueError(error);
  }
}

export async function restoreArchivedProductInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  publicId: string,
  actor: string,
): Promise<RestoredCatalogueProductView> {
  const [product] = await tx
    .select()
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        eq(catalogueProducts.publicId, publicId),
      ),
    )
    .limit(1)
    .for("update");

  if (!product) {
    throw new CatalogueProductError("Product not found.", 404);
  }

  if (product.status !== "archived") {
    throw new CatalogueProductConflictError(
      "Only archived products can be restored to draft.",
      "status",
      CATALOGUE_PRODUCT_RESTORE_CODES.NOT_ARCHIVED,
    );
  }

  const nextVersion = product.version + 1;

  await tx
    .update(catalogueProducts)
    .set({
      status: "draft",
      version: nextVersion,
      updatedAt: new Date(),
    })
    .where(eq(catalogueProducts.id, product.id));

  await recordTenantAuditEventInTx(tx, {
    tenantId,
    actorSubject: actor,
    actorClass: "staff_administrator",
    action: "catalogue.product.restored",
    entityType: "catalogue_product",
    entityPublicId: publicId,
    entityVersion: nextVersion,
    changeSummary: {
      previousStatus: product.status,
      status: "draft",
    },
  });

  return {
    publicId,
    status: "draft",
    version: nextVersion,
  };
}

export async function restoreArchivedProduct(
  db: DbClient,
  tenantId: string,
  publicId: string,
  actor: string,
): Promise<RestoredCatalogueProductView> {
  try {
    return await withTenantContext(db, tenantId, async (tx) =>
      restoreArchivedProductInTx(tx, tenantId, publicId, actor),
    );
  } catch (error) {
    return mapCatalogueError(error);
  }
}
