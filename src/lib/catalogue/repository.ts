import { and, asc, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueModifierGroupTranslations,
  catalogueModifierGroups,
  catalogueModifierOptionTranslations,
  catalogueModifierOptions,
  catalogueProductModifierGroups,
  catalogueProducts,
  catalogueProductTranslations,
  catalogueVariantPrices,
  catalogueVariants,
  catalogueVariantTranslations,
} from "@/db/schema";
import { withTenantContext } from "@/lib/tenant/context";

export type CatalogueVariantView = {
  publicId: string;
  isDefault: boolean;
  sortOrder: number;
  displayName: string;
  currency: string | null;
  amountMinor: number | null;
};

export type CatalogueModifierOptionView = {
  publicId: string;
  sortOrder: number;
  priceMinor: number;
  currency: string;
  displayName: string;
};

export type CatalogueModifierGroupView = {
  publicId: string;
  minSelections: number;
  maxSelections: number;
  displayName: string;
  options: CatalogueModifierOptionView[];
};

export type CatalogueProductView = {
  publicId: string;
  internalName: string;
  status: string;
  provenance: string;
  displayName: string;
  description: string | null;
  locale: string;
  variants: CatalogueVariantView[];
  modifierGroups: CatalogueModifierGroupView[];
};

export async function getCatalogueProductView(
  db: DbClient,
  tenantId: string,
  productPublicId: string,
  locale = "en",
): Promise<CatalogueProductView | null> {
  return withTenantContext(db, tenantId, async (tx) => {
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

    const [translation] = await tx
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

    const variantRows = await tx
      .select({
        id: catalogueVariants.id,
        publicId: catalogueVariants.publicId,
        isDefault: catalogueVariants.isDefault,
        sortOrder: catalogueVariants.sortOrder,
        currency: catalogueVariantPrices.currency,
        amountMinor: catalogueVariantPrices.amountMinor,
        displayName: catalogueVariantTranslations.displayName,
      })
      .from(catalogueVariants)
      .leftJoin(
        catalogueVariantPrices,
        and(
          eq(catalogueVariantPrices.tenantId, tenantId),
          eq(catalogueVariantPrices.variantId, catalogueVariants.id),
        ),
      )
      .leftJoin(
        catalogueVariantTranslations,
        and(
          eq(catalogueVariantTranslations.tenantId, tenantId),
          eq(catalogueVariantTranslations.variantId, catalogueVariants.id),
          eq(catalogueVariantTranslations.locale, locale),
        ),
      )
      .where(
        and(
          eq(catalogueVariants.tenantId, tenantId),
          eq(catalogueVariants.productId, product.id),
          eq(catalogueVariants.status, "active"),
        ),
      )
      .orderBy(asc(catalogueVariants.sortOrder), asc(catalogueVariants.publicId));

    const variants: CatalogueVariantView[] = variantRows.map((row) => ({
      publicId: row.publicId,
      isDefault: row.isDefault,
      sortOrder: row.sortOrder,
      displayName: row.displayName ?? "",
      currency: row.currency?.trim() ?? null,
      amountMinor: row.amountMinor ?? null,
    }));

    const productModifierGroups = await tx
      .select({
        publicId: catalogueModifierGroups.publicId,
        minSelections: catalogueModifierGroups.minSelections,
        maxSelections: catalogueModifierGroups.maxSelections,
        groupId: catalogueModifierGroups.id,
        displayName: catalogueModifierGroupTranslations.displayName,
      })
      .from(catalogueProductModifierGroups)
      .innerJoin(
        catalogueModifierGroups,
        and(
          eq(catalogueModifierGroups.tenantId, tenantId),
          eq(
            catalogueModifierGroups.id,
            catalogueProductModifierGroups.modifierGroupId,
          ),
        ),
      )
      .innerJoin(
        catalogueModifierGroupTranslations,
        and(
          eq(catalogueModifierGroupTranslations.tenantId, tenantId),
          eq(
            catalogueModifierGroupTranslations.modifierGroupId,
            catalogueModifierGroups.id,
          ),
          eq(catalogueModifierGroupTranslations.locale, locale),
        ),
      )
      .where(
        and(
          eq(catalogueProductModifierGroups.tenantId, tenantId),
          eq(catalogueProductModifierGroups.productId, product.id),
          eq(catalogueModifierGroups.status, "active"),
        ),
      )
      .orderBy(asc(catalogueProductModifierGroups.sortOrder));

    const groupIds = productModifierGroups.map((group) => group.groupId);
    const modifierGroups: CatalogueModifierGroupView[] = [];

    if (groupIds.length > 0) {
      const options = await tx
        .select({
          groupId: catalogueModifierOptions.modifierGroupId,
          publicId: catalogueModifierOptions.publicId,
          sortOrder: catalogueModifierOptions.sortOrder,
          priceMinor: catalogueModifierOptions.priceMinor,
          currency: catalogueModifierOptions.currency,
          displayName: catalogueModifierOptionTranslations.displayName,
        })
        .from(catalogueModifierOptions)
        .innerJoin(
          catalogueModifierOptionTranslations,
          and(
            eq(catalogueModifierOptionTranslations.tenantId, tenantId),
            eq(
              catalogueModifierOptionTranslations.modifierOptionId,
              catalogueModifierOptions.id,
            ),
            eq(catalogueModifierOptionTranslations.locale, locale),
          ),
        )
        .where(
          and(
            eq(catalogueModifierOptions.tenantId, tenantId),
            inArray(catalogueModifierOptions.modifierGroupId, groupIds),
            eq(catalogueModifierOptions.status, "active"),
          ),
        )
        .orderBy(asc(catalogueModifierOptions.sortOrder));

      for (const group of productModifierGroups) {
        modifierGroups.push({
          publicId: group.publicId,
          minSelections: group.minSelections,
          maxSelections: group.maxSelections,
          displayName: group.displayName,
          options: options
            .filter((option) => option.groupId === group.groupId)
            .map((option) => ({
              publicId: option.publicId,
              sortOrder: option.sortOrder,
              priceMinor: option.priceMinor,
              currency: option.currency,
              displayName: option.displayName,
            })),
        });
      }
    }

    return {
      publicId: product.publicId,
      internalName: product.internalName,
      status: product.status,
      provenance: product.provenance,
      displayName: translation?.displayName ?? product.internalName,
      description: translation?.description ?? null,
      locale,
      variants,
      modifierGroups,
    };
  });
}

export async function listCatalogueProductPublicIds(
  db: DbClient,
  tenantId: string,
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx
      .select({ publicId: catalogueProducts.publicId })
      .from(catalogueProducts)
      .where(eq(catalogueProducts.tenantId, tenantId))
      .orderBy(asc(catalogueProducts.publicId));

    return rows.map((row) => row.publicId);
  });
}

export async function listCatalogueProductSummaries(
  db: DbClient,
  tenantId: string,
  locale = "en",
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const rows = await tx
      .select({
        publicId: catalogueProducts.publicId,
        internalName: catalogueProducts.internalName,
        displayName: catalogueProductTranslations.displayName,
      })
      .from(catalogueProducts)
      .leftJoin(
        catalogueProductTranslations,
        and(
          eq(catalogueProductTranslations.tenantId, tenantId),
          eq(catalogueProductTranslations.productId, catalogueProducts.id),
          eq(catalogueProductTranslations.locale, locale),
        ),
      )
      .where(eq(catalogueProducts.tenantId, tenantId))
      .orderBy(asc(catalogueProducts.publicId));

    return rows.map((row) => ({
      publicId: row.publicId,
      internalName: row.internalName,
      displayName: row.displayName ?? row.internalName,
    }));
  });
}
