import { and, asc, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  catalogueModifierGroups,
  catalogueModifierOptions,
  catalogueProductCategories,
  catalogueProductModifierGroups,
  catalogueProducts,
  catalogueProductTranslations,
  catalogueVariantPrices,
  catalogueVariants,
  locations,
} from "@/db/schema";
import {
  resolveProductEligibilityMap,
  type ItemEligibilityResult,
} from "@/lib/catalogue/item-eligibility";
import { loadDraftMenuEditorView } from "@/lib/catalogue/menus";
import type { ModifierGroupRules } from "@/lib/catalogue/modifier-selection";
import type { PublishTranslationFacts } from "@/lib/catalogue/translation-approval";
import { getApprovedThumbnailPublicIdsForProducts } from "@/lib/media/product-images";

export type MenuProductTranslationFacts = PublishTranslationFacts & {
  description: string | null;
};

export type MenuVariantFacts = {
  publicId: string;
  isDefault: boolean;
  prices: Array<{ currency: string; amountMinor: number }>;
};

export type MenuModifierGroupFacts = ModifierGroupRules & {
  internalName: string;
};

export type MenuProductFacts = {
  productPublicId: string;
  internalName: string;
  status: "draft" | "active" | "archived";
  sectionPublicIds: string[];
  translations: MenuProductTranslationFacts[];
  thumbnailPublicId: string | null;
  categoryCount: number;
  activeVariants: MenuVariantFacts[];
  modifierGroups: MenuModifierGroupFacts[];
  /** Keyed by location public ID. */
  eligibilityByLocation: Record<string, ItemEligibilityResult>;
};

export type MenuLocationFacts = {
  id: string;
  publicId: string;
  name: string;
};

export type MenuFacts = {
  menuPublicId: string;
  menuVersion: number;
  displayName: string;
  sectionCount: number;
  /** Internal location IDs, for QOS-side authorization only. */
  locationIds: string[];
  locations: MenuLocationFacts[];
  products: MenuProductFacts[];
  evaluatedAt: Date;
};

/**
 * Loads everything menu health (and later the menu snapshot) needs for one
 * draft menu with a fixed number of queries per menu, not per product.
 *
 * Must run inside `withTenantContext`. Returns null when the menu does not
 * exist for the tenant. Products are the non-archived placements in
 * non-archived sections, de-duplicated across sections.
 *
 * Eligibility reuses `resolveProductEligibilityMap`, which also expires
 * stop-sales whose end time has passed (the same housekeeping public menu
 * reads perform).
 */
export async function loadMenuFacts(
  tx: DbClient,
  tenantId: string,
  menuPublicId: string,
  at: Date = new Date(),
): Promise<MenuFacts | null> {
  const menu = await loadDraftMenuEditorView(tx, tenantId, menuPublicId);
  if (!menu) {
    return null;
  }

  const sectionsByProduct = new Map<string, string[]>();
  for (const section of menu.sections) {
    if (section.archived) {
      continue;
    }
    for (const placement of section.products) {
      if (placement.archived) {
        continue;
      }
      const sectionIds = sectionsByProduct.get(placement.productPublicId) ?? [];
      if (!sectionIds.includes(section.publicId)) {
        sectionIds.push(section.publicId);
      }
      sectionsByProduct.set(placement.productPublicId, sectionIds);
    }
  }

  const locationRows =
    menu.locationIds.length === 0
      ? []
      : await tx
          .select({
            id: locations.id,
            publicId: locations.publicId,
            name: locations.name,
          })
          .from(locations)
          .where(
            and(
              eq(locations.tenantId, tenantId),
              inArray(locations.id, menu.locationIds),
            ),
          )
          .orderBy(asc(locations.name));

  const productPublicIds = [...sectionsByProduct.keys()];
  const facts: MenuFacts = {
    menuPublicId: menu.publicId,
    menuVersion: menu.version,
    displayName: menu.displayName,
    sectionCount: menu.sectionCount,
    locationIds: menu.locationIds,
    locations: locationRows,
    products: [],
    evaluatedAt: at,
  };

  if (productPublicIds.length === 0) {
    return facts;
  }

  const productRows = await tx
    .select({
      id: catalogueProducts.id,
      publicId: catalogueProducts.publicId,
      internalName: catalogueProducts.internalName,
      status: catalogueProducts.status,
      primaryMediaAssetId: catalogueProducts.primaryMediaAssetId,
    })
    .from(catalogueProducts)
    .where(
      and(
        eq(catalogueProducts.tenantId, tenantId),
        inArray(catalogueProducts.publicId, productPublicIds),
      ),
    );
  const productIds = productRows.map((row) => row.id);

  const translationRows = await tx
    .select({
      productId: catalogueProductTranslations.productId,
      locale: catalogueProductTranslations.locale,
      displayName: catalogueProductTranslations.displayName,
      description: catalogueProductTranslations.description,
      approvalStatus: catalogueProductTranslations.approvalStatus,
      translationVersion: catalogueProductTranslations.translationVersion,
      approvedSourceTranslationVersion:
        catalogueProductTranslations.approvedSourceTranslationVersion,
    })
    .from(catalogueProductTranslations)
    .where(
      and(
        eq(catalogueProductTranslations.tenantId, tenantId),
        inArray(catalogueProductTranslations.productId, productIds),
      ),
    );

  const thumbnails = await getApprovedThumbnailPublicIdsForProducts(
    tx,
    tenantId,
    productRows,
  );

  const categoryRows = await tx
    .select({ productId: catalogueProductCategories.productId })
    .from(catalogueProductCategories)
    .where(
      and(
        eq(catalogueProductCategories.tenantId, tenantId),
        inArray(catalogueProductCategories.productId, productIds),
      ),
    );

  const variantRows = await tx
    .select({
      id: catalogueVariants.id,
      productId: catalogueVariants.productId,
      publicId: catalogueVariants.publicId,
      isDefault: catalogueVariants.isDefault,
    })
    .from(catalogueVariants)
    .where(
      and(
        eq(catalogueVariants.tenantId, tenantId),
        inArray(catalogueVariants.productId, productIds),
        eq(catalogueVariants.status, "active"),
      ),
    )
    .orderBy(asc(catalogueVariants.sortOrder), asc(catalogueVariants.publicId));

  const productGroupRows = await tx
    .select({
      productId: catalogueProductModifierGroups.productId,
      groupId: catalogueModifierGroups.id,
      publicId: catalogueModifierGroups.publicId,
      internalName: catalogueModifierGroups.internalName,
      minSelections: catalogueModifierGroups.minSelections,
      maxSelections: catalogueModifierGroups.maxSelections,
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
    .where(
      and(
        eq(catalogueProductModifierGroups.tenantId, tenantId),
        inArray(catalogueProductModifierGroups.productId, productIds),
        eq(catalogueModifierGroups.status, "active"),
      ),
    )
    .orderBy(asc(catalogueProductModifierGroups.sortOrder));

  const variantIds = variantRows.map((row) => row.id);
  const groupIds = [...new Set(productGroupRows.map((row) => row.groupId))];

  const priceRows =
    variantIds.length === 0
      ? []
      : await tx
          .select({
            variantId: catalogueVariantPrices.variantId,
            currency: catalogueVariantPrices.currency,
            amountMinor: catalogueVariantPrices.amountMinor,
          })
          .from(catalogueVariantPrices)
          .where(
            and(
              eq(catalogueVariantPrices.tenantId, tenantId),
              inArray(catalogueVariantPrices.variantId, variantIds),
            ),
          );

  const optionRows =
    groupIds.length === 0
      ? []
      : await tx
          .select({
            groupId: catalogueModifierOptions.modifierGroupId,
            publicId: catalogueModifierOptions.publicId,
            status: catalogueModifierOptions.status,
            isDefault: catalogueModifierOptions.isDefault,
            allowsQuantity: catalogueModifierOptions.allowsQuantity,
            maxQuantity: catalogueModifierOptions.maxQuantity,
            priceMinor: catalogueModifierOptions.priceMinor,
          })
          .from(catalogueModifierOptions)
          .where(
            and(
              eq(catalogueModifierOptions.tenantId, tenantId),
              inArray(catalogueModifierOptions.modifierGroupId, groupIds),
            ),
          )
          .orderBy(asc(catalogueModifierOptions.sortOrder));

  const eligibilityByLocation = new Map<
    string,
    Map<string, ItemEligibilityResult>
  >();
  for (const location of locationRows) {
    eligibilityByLocation.set(
      location.publicId,
      await resolveProductEligibilityMap(tx, {
        tenantId,
        locationId: location.id,
        productPublicIds,
        at,
      }),
    );
  }

  const pricesByVariant = groupBy(priceRows, (row) => row.variantId);
  const optionsByGroup = groupBy(optionRows, (row) => row.groupId);
  const translationsByProduct = groupBy(translationRows, (row) => row.productId);
  const variantsByProduct = groupBy(variantRows, (row) => row.productId);
  const groupsByProduct = groupBy(productGroupRows, (row) => row.productId);
  const categoryCountByProduct = new Map<string, number>();
  for (const row of categoryRows) {
    categoryCountByProduct.set(
      row.productId,
      (categoryCountByProduct.get(row.productId) ?? 0) + 1,
    );
  }

  const productByPublicId = new Map(
    productRows.map((row) => [row.publicId, row]),
  );

  for (const productPublicId of productPublicIds) {
    const product = productByPublicId.get(productPublicId);
    if (!product) {
      continue;
    }

    const eligibility: Record<string, ItemEligibilityResult> = {};
    for (const [locationPublicId, results] of eligibilityByLocation) {
      const result = results.get(productPublicId);
      if (result) {
        eligibility[locationPublicId] = result;
      }
    }

    facts.products.push({
      productPublicId,
      internalName: product.internalName,
      status: product.status,
      sectionPublicIds: sectionsByProduct.get(productPublicId) ?? [],
      translations: (translationsByProduct.get(product.id) ?? []).map(
        (row) => ({
          locale: row.locale,
          displayName: row.displayName,
          description: row.description,
          approvalStatus: row.approvalStatus,
          translationVersion: row.translationVersion,
          approvedSourceTranslationVersion: row.approvedSourceTranslationVersion,
        }),
      ),
      thumbnailPublicId: thumbnails.get(product.id) ?? null,
      categoryCount: categoryCountByProduct.get(product.id) ?? 0,
      activeVariants: (variantsByProduct.get(product.id) ?? []).map(
        (variant) => ({
          publicId: variant.publicId,
          isDefault: variant.isDefault,
          prices: (pricesByVariant.get(variant.id) ?? []).map((price) => ({
            currency: price.currency.trim(),
            amountMinor: price.amountMinor,
          })),
        }),
      ),
      modifierGroups: (groupsByProduct.get(product.id) ?? []).map((group) => ({
        publicId: group.publicId,
        internalName: group.internalName,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        options: (optionsByGroup.get(group.groupId) ?? []).map((option) => ({
          publicId: option.publicId,
          status: option.status === "active" ? "active" : "archived",
          isDefault: option.isDefault,
          allowsQuantity: option.allowsQuantity,
          maxQuantity: option.maxQuantity,
          priceMinor: option.priceMinor,
        })),
      })),
      eligibilityByLocation: eligibility,
    });
  }

  return facts;
}

function groupBy<T>(rows: T[], key: (row: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const bucket = grouped.get(id) ?? [];
    bucket.push(row);
    grouped.set(id, bucket);
  }
  return grouped;
}
