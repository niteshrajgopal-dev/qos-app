import { createHash } from "node:crypto";

import { and, asc, eq, inArray } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  brands,
  catalogueCategories,
  catalogueCategoryTranslations,
  catalogueMenuLocations,
  catalogueMenus,
  catalogueMenuSectionProducts,
  catalogueMenuSections,
  catalogueMenuSectionTranslations,
  catalogueMenuTranslations,
  catalogueModifierGroups,
  catalogueModifierGroupTranslations,
  catalogueModifierOptionChannelPrices,
  catalogueModifierOptions,
  catalogueModifierOptionTranslations,
  catalogueProductCategories,
  catalogueProductModifierGroups,
  catalogueProducts,
  catalogueProductTranslations,
  catalogueVariantChannelPrices,
  catalogueVariantLocationPriceOverrides,
  catalogueVariantPrices,
  catalogueVariants,
  catalogueVariantTranslations,
  locations,
  salesChannels,
  tenants,
} from "@/db/schema";
import {
  loadCurrentCostPoliciesInTx,
  type ReferenceCostPolicyRow,
} from "@/lib/catalogue/reference-cost-policies";
import {
  costTaxBasisWorkbookValue,
  microsToMajorString,
  sellingTaxBasisWorkbookValue,
} from "@/lib/catalogue/selling-tax-cost";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { ALL_BRANCHES, assertReadableBranch, loadBranchContext } from "@/lib/staff/branch-context";
import { withTenantContext } from "@/lib/tenant/context";
import { WORKBOOK_CONTRACT, WORKBOOK_PROFILE_ID, type SupportedEntitySheet } from "@/lib/workbook/contract";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import type { WorkbookManifest } from "@/lib/workbook/manifest";
import { buildQosWorkbook } from "@/lib/workbook/template";

/* Current-record export (QOS-193). Reads the caller's actual catalogue
   records for the supported sheets and writes them into the contract
   workbook with QOS ids, workbook keys, revision tokens and immutable
   context. It is read-only: nothing is created, changed or audited.

   Authorisation: any active member may read the tenant catalogue (the same
   rule as the catalogue list routes). Branch rows, branch prices and menu
   branch links are limited to the branches the membership may work in, and
   to the one branch requested, if any. */

export class WorkbookExportError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(code: string, message: string, statusCode: number, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "WorkbookExportError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

type Row = Record<string, string>;
type Stamp = string | number | boolean | Date | null | undefined;

/** Export rows start as `skip`, so uploading an untouched export changes nothing. */
export const EXPORT_ROW_ACTION = "skip";

/** Opaque, stable token derived from the record's own version and timestamps. */
export function revisionToken(entity: string, id: string, stamps: Stamp[]) {
  const material = JSON.stringify([
    entity,
    id,
    ...stamps.map((stamp) => (stamp instanceof Date ? stamp.toISOString() : stamp ?? null)),
  ]);
  return `rv1.${createHash("sha256").update(material).digest("base64url").slice(0, 22)}`;
}

/** qos-generated source namespace for exported keys (assumption; see the QOS-193 report). */
export function exportSourceNamespace(tenantPublicId: string) {
  return `qos:${tenantPublicId}`;
}

/**
 * The current reference-cost policy (effective_to IS NULL) as workbook
 * cells. Superseded policies are history and are not exported as rows.
 * Recipe-derived policies export a blank amount: QOS-199 computes it.
 */
function costPolicyCells(policy: ReferenceCostPolicyRow | undefined): Row {
  return {
    cost_method: policy?.method ?? "",
    reference_cost_amount: policy?.amountMicros == null ? "" : microsToMajorString(policy.amountMicros),
    cost_currency: policy?.currency?.trim() ?? "",
    cost_unit: policy?.unit ?? "",
    cost_tax_basis: costTaxBasisWorkbookValue(policy?.taxBasis ?? null),
    cost_effective_date: policy?.effectiveFrom ?? "",
    cost_source: policy?.source ?? "",
    cost_source_reference: policy?.sourceReference ?? "",
  };
}

function costPolicyStamps(policy: { publicId?: string | null; revision?: number | null } | undefined): Stamp[] {
  return [policy?.publicId, policy?.revision];
}

function linkKey(...parts: string[]) {
  return parts.join("~");
}

function bool(value: boolean) {
  return value ? "TRUE" : "FALSE";
}

/** Declared booleans keep unknown blank; it is never exported as FALSE. */
function declaredBool(value: boolean | null) {
  return value == null ? "" : bool(value);
}

function text(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

/** ISO 8601 with an explicit offset, as the contract asks for `exported_at`. */
export function isoWithOffset(date: Date) {
  return date.toISOString().replace(/Z$/, "+00:00");
}

function byLocale<T extends { locale: string }>(rows: T[], ownerId: (row: T) => string) {
  const map = new Map<string, { en?: T; ar?: T }>();
  for (const row of rows) {
    if (row.locale !== "en" && row.locale !== "ar") continue;
    const entry = map.get(ownerId(row)) ?? {};
    entry[row.locale] = row;
    map.set(ownerId(row), entry);
  }
  return map;
}

function translationStamps(entry: { en?: { updatedAt: Date }; ar?: { updatedAt: Date } } | undefined): Stamp[] {
  return [entry?.en?.updatedAt, entry?.ar?.updatedAt];
}

/* Per-entity revision recipes. The export writes them as `expected_revision`;
   the workbook apply (QOS-217) recomputes the same tokens for one record
   immediately before mutating it. Change a recipe only here. */
type Stamped = { updatedAt: Date };
type Versioned = { updatedAt: Date; translationVersion: number };
type ByLocale<T> = { en?: T; ar?: T } | undefined;

export const REVISION = {
  location: (row: { publicId: string; updatedAt: Date }) => revisionToken("location", row.publicId, [row.updatedAt]),
  category: (row: { publicId: string; version: number; updatedAt: Date }, names: ByLocale<Stamped>) =>
    revisionToken("category", row.publicId, [row.version, row.updatedAt, ...translationStamps(names)]),
  product: (row: { publicId: string; version: number; updatedAt: Date; primaryMediaAssetId: string | null }, names: ByLocale<Versioned>) =>
    revisionToken("product", row.publicId, [
      row.version,
      row.updatedAt,
      row.primaryMediaAssetId,
      names?.en?.updatedAt,
      names?.en?.translationVersion,
      names?.ar?.updatedAt,
      names?.ar?.translationVersion,
    ]),
  productCategory: (row: { id: string; createdAt: Date; sortOrder: number }) =>
    revisionToken("product_category", row.id, [row.createdAt, row.sortOrder]),
  variant: (
    row: { publicId: string; updatedAt: Date },
    labels: ByLocale<Stamped>,
    price: { currency: string; version: number; updatedAt: Date } | undefined,
    costPolicy?: { publicId?: string; revision?: number },
  ) =>
    revisionToken("variant", row.publicId, [
      row.updatedAt,
      labels?.en?.updatedAt,
      labels?.ar?.updatedAt,
      price?.currency,
      price?.version,
      price?.updatedAt,
      ...costPolicyStamps(costPolicy),
    ]),
  branchPrice: (row: { id: string; updatedAt: Date; amountMinor: number; centralPriceVersionAtOverride: number }) =>
    revisionToken("branch_price", row.id, [row.updatedAt, row.amountMinor, row.centralPriceVersionAtOverride]),
  modifierGroup: (row: { publicId: string; version: number; updatedAt: Date }, names: ByLocale<Stamped>) =>
    revisionToken("modifier_group", row.publicId, [row.version, row.updatedAt, ...translationStamps(names)]),
  modifierOption: (
    row: { publicId: string; updatedAt: Date },
    names: ByLocale<Stamped>,
    costPolicy?: { publicId?: string; revision?: number },
  ) =>
    revisionToken("modifier_option", row.publicId, [
      row.updatedAt,
      ...translationStamps(names),
      ...costPolicyStamps(costPolicy),
    ]),
  productModifier: (row: { id: string; createdAt: Date; sortOrder: number; version: number; updatedAt: Date }) =>
    revisionToken("product_modifier", row.id, [row.createdAt, row.sortOrder, row.version, row.updatedAt]),
  menu: (row: { publicId: string; version: number; updatedAt: Date }, names: ByLocale<Versioned>) =>
    revisionToken("menu", row.publicId, [
      row.version,
      row.updatedAt,
      names?.en?.updatedAt,
      names?.en?.translationVersion,
      names?.ar?.updatedAt,
      names?.ar?.translationVersion,
    ]),
  menuBranch: (row: { id: string; createdAt: Date }) => revisionToken("menu_branch", row.id, [row.createdAt]),
  menuSection: (row: { publicId: string; updatedAt: Date }, names: ByLocale<Versioned>) =>
    revisionToken("menu_section", row.publicId, [
      row.updatedAt,
      names?.en?.updatedAt,
      names?.en?.translationVersion,
      names?.ar?.updatedAt,
      names?.ar?.translationVersion,
    ]),
  menuItem: (row: { id: string; updatedAt: Date; sortOrder: number; archived: boolean }) =>
    revisionToken("menu_item", row.id, [row.updatedAt, row.sortOrder, row.archived]),
};

/** Groups translation rows by owner and locale (en/ar only). */
export function translationsByOwner<T extends { locale: string }>(rows: T[], ownerId: (row: T) => string) {
  return byLocale(rows, ownerId);
}

export type CurrentRecordExport = {
  manifest: WorkbookManifest;
  records: Record<SupportedEntitySheet, Row[]>;
  branchPublicIds: string[];
  fileName: string;
};

export async function loadCurrentRecordExport(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  options: { branch?: string | null; brand?: string | null; now?: Date } = {},
): Promise<CurrentRecordExport> {
  const branchContext = await loadBranchContext(db, tenantId, membership);
  const requested = options.branch?.trim();
  const selection = requested ? assertReadableBranch(requested, branchContext) : ALL_BRANCHES;
  const permittedPublicIds = branchContext.branches
    .map((branch) => branch.publicId)
    .filter((publicId) => selection === ALL_BRANCHES || publicId === selection);

  return withTenantContext(db, tenantId, async (tx) => {
    const [tenant] = await tx
      .select({
        publicId: tenants.publicId,
        baseCurrency: tenants.baseCurrency,
        defaultTimezone: tenants.defaultTimezone,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!tenant) {
      throw new WorkbookExportError("not_found", "Business not found.", 404);
    }

    const tenantBrands = await tx
      .select({ id: brands.id, publicId: brands.publicId, name: brands.name })
      .from(brands)
      .where(eq(brands.tenantId, tenantId))
      .orderBy(asc(brands.name), asc(brands.publicId));

    const requestedBrand = options.brand?.trim();
    const brand = requestedBrand
      ? tenantBrands.find((candidate) => candidate.publicId === requestedBrand)
      : tenantBrands.length === 1
        ? tenantBrands[0]
        : undefined;
    if (requestedBrand && !brand) {
      throw new WorkbookExportError("brand_not_found", "Brand not found.", 404);
    }
    if (!brand) {
      if (tenantBrands.length === 0) {
        throw new WorkbookExportError("no_brand", "This business has no brand to export.", 409);
      }
      throw new WorkbookExportError("brand_required", "Choose the brand to export.", 400, {
        brands: tenantBrands.map((candidate) => ({ publicId: candidate.publicId, name: candidate.name })),
      });
    }

    const currency = tenant.baseCurrency.trim();

    // Branches: permitted for this membership, in the selected brand.
    const branchRows =
      permittedPublicIds.length === 0
        ? []
        : await tx
            .select()
            .from(locations)
            .where(
              and(
                eq(locations.tenantId, tenantId),
                eq(locations.brandId, brand.id),
                inArray(locations.publicId, permittedPublicIds),
              ),
            )
            .orderBy(asc(locations.publicId));
    const locationIds = branchRows.map((row) => row.id);
    const locationKey = new Map(branchRows.map((row) => [row.id, row.publicId]));

    // Categories and modifier groups are tenant-wide.
    const categoryRows = await tx
      .select()
      .from(catalogueCategories)
      .where(eq(catalogueCategories.tenantId, tenantId))
      .orderBy(asc(catalogueCategories.sortOrder), asc(catalogueCategories.publicId));
    const categoryTranslations = byLocale(
      categoryRows.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueCategoryTranslations)
            .where(
              and(
                eq(catalogueCategoryTranslations.tenantId, tenantId),
                inArray(catalogueCategoryTranslations.categoryId, categoryRows.map((row) => row.id)),
              ),
            ),
      (row) => row.categoryId,
    );
    const categoryKey = new Map(categoryRows.map((row) => [row.id, row.publicId]));

    const productRows = await tx
      .select()
      .from(catalogueProducts)
      .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.brandId, brand.id)))
      .orderBy(asc(catalogueProducts.publicId));
    const productIds = productRows.map((row) => row.id);
    const productKey = new Map(productRows.map((row) => [row.id, row.publicId]));
    const productTranslations = byLocale(
      productIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueProductTranslations)
            .where(
              and(
                eq(catalogueProductTranslations.tenantId, tenantId),
                inArray(catalogueProductTranslations.productId, productIds),
              ),
            ),
      (row) => row.productId,
    );

    const productCategoryRows =
      productIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueProductCategories)
            .where(
              and(
                eq(catalogueProductCategories.tenantId, tenantId),
                inArray(catalogueProductCategories.productId, productIds),
              ),
            );

    const variantRows =
      productIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueVariants)
            .where(and(eq(catalogueVariants.tenantId, tenantId), inArray(catalogueVariants.productId, productIds)));
    const variantIds = variantRows.map((row) => row.id);
    const variantKey = new Map(variantRows.map((row) => [row.id, row.publicId]));
    const variantCostPolicies = await loadCurrentCostPoliciesInTx(tx, tenantId, "variant", variantIds);
    const variantTranslations = byLocale(
      variantIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueVariantTranslations)
            .where(
              and(
                eq(catalogueVariantTranslations.tenantId, tenantId),
                inArray(catalogueVariantTranslations.variantId, variantIds),
              ),
            ),
      (row) => row.variantId,
    );
    const priceRows =
      variantIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueVariantPrices)
            .where(
              and(eq(catalogueVariantPrices.tenantId, tenantId), inArray(catalogueVariantPrices.variantId, variantIds)),
            )
            .orderBy(asc(catalogueVariantPrices.currency));
    // One base price per variant: the tenant currency when present.
    const priceByVariant = new Map<string, (typeof priceRows)[number]>();
    for (const price of priceRows) {
      const current = priceByVariant.get(price.variantId);
      if (!current || (current.currency.trim() !== currency && price.currency.trim() === currency)) {
        priceByVariant.set(price.variantId, price);
      }
    }

    const overrideRows =
      variantIds.length === 0 || locationIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueVariantLocationPriceOverrides)
            .where(
              and(
                eq(catalogueVariantLocationPriceOverrides.tenantId, tenantId),
                inArray(catalogueVariantLocationPriceOverrides.variantId, variantIds),
                inArray(catalogueVariantLocationPriceOverrides.locationId, locationIds),
              ),
            );

    // Sales channels are tenant-wide price-list identities, not branches.
    const channelRows = await tx
      .select()
      .from(salesChannels)
      .where(eq(salesChannels.tenantId, tenantId))
      .orderBy(asc(salesChannels.code));
    const channelById = new Map(channelRows.map((row) => [row.id, row]));
    const variantChannelPriceRows =
      variantIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueVariantChannelPrices)
            .where(
              and(
                eq(catalogueVariantChannelPrices.tenantId, tenantId),
                inArray(catalogueVariantChannelPrices.variantId, variantIds),
              ),
            );

    const groupRows = await tx
      .select()
      .from(catalogueModifierGroups)
      .where(eq(catalogueModifierGroups.tenantId, tenantId))
      .orderBy(asc(catalogueModifierGroups.publicId));
    const groupIds = groupRows.map((row) => row.id);
    const groupKey = new Map(groupRows.map((row) => [row.id, row.publicId]));
    const groupTranslations = byLocale(
      groupIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueModifierGroupTranslations)
            .where(
              and(
                eq(catalogueModifierGroupTranslations.tenantId, tenantId),
                inArray(catalogueModifierGroupTranslations.modifierGroupId, groupIds),
              ),
            ),
      (row) => row.modifierGroupId,
    );
    const optionRows =
      groupIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueModifierOptions)
            .where(
              and(
                eq(catalogueModifierOptions.tenantId, tenantId),
                inArray(catalogueModifierOptions.modifierGroupId, groupIds),
              ),
            );
    const optionCostPolicies = await loadCurrentCostPoliciesInTx(
      tx,
      tenantId,
      "modifier_option",
      optionRows.map((row) => row.id),
    );
    const optionTranslations = byLocale(
      optionRows.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueModifierOptionTranslations)
            .where(
              and(
                eq(catalogueModifierOptionTranslations.tenantId, tenantId),
                inArray(catalogueModifierOptionTranslations.modifierOptionId, optionRows.map((row) => row.id)),
              ),
            ),
      (row) => row.modifierOptionId,
    );
    const optionKey = new Map(optionRows.map((row) => [row.id, row.publicId]));
    const optionChannelPriceRows =
      optionRows.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueModifierOptionChannelPrices)
            .where(
              and(
                eq(catalogueModifierOptionChannelPrices.tenantId, tenantId),
                inArray(catalogueModifierOptionChannelPrices.modifierOptionId, optionRows.map((row) => row.id)),
              ),
            );
    const productModifierRows =
      productIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueProductModifierGroups)
            .where(
              and(
                eq(catalogueProductModifierGroups.tenantId, tenantId),
                inArray(catalogueProductModifierGroups.productId, productIds),
              ),
            );

    const menuRows = await tx
      .select()
      .from(catalogueMenus)
      .where(and(eq(catalogueMenus.tenantId, tenantId), eq(catalogueMenus.brandId, brand.id)))
      .orderBy(asc(catalogueMenus.publicId));
    const menuIds = menuRows.map((row) => row.id);
    const menuKey = new Map(menuRows.map((row) => [row.id, row.publicId]));
    const menuTranslations = byLocale(
      menuIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueMenuTranslations)
            .where(and(eq(catalogueMenuTranslations.tenantId, tenantId), inArray(catalogueMenuTranslations.menuId, menuIds))),
      (row) => row.menuId,
    );
    const menuLocationRows =
      menuIds.length === 0 || locationIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueMenuLocations)
            .where(
              and(
                eq(catalogueMenuLocations.tenantId, tenantId),
                inArray(catalogueMenuLocations.menuId, menuIds),
                inArray(catalogueMenuLocations.locationId, locationIds),
              ),
            );
    const sectionRows =
      menuIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueMenuSections)
            .where(and(eq(catalogueMenuSections.tenantId, tenantId), inArray(catalogueMenuSections.menuId, menuIds)));
    const sectionIds = sectionRows.map((row) => row.id);
    const sectionKey = new Map(sectionRows.map((row) => [row.id, row.publicId]));
    const sectionTranslations = byLocale(
      sectionIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueMenuSectionTranslations)
            .where(
              and(
                eq(catalogueMenuSectionTranslations.tenantId, tenantId),
                inArray(catalogueMenuSectionTranslations.sectionId, sectionIds),
              ),
            ),
      (row) => row.sectionId,
    );
    const sectionProductRows =
      sectionIds.length === 0
        ? []
        : await tx
            .select()
            .from(catalogueMenuSectionProducts)
            .where(
              and(
                eq(catalogueMenuSectionProducts.tenantId, tenantId),
                inArray(catalogueMenuSectionProducts.sectionId, sectionIds),
              ),
            );

    const keyOf = (map: Map<string, string>, id: string) => map.get(id) ?? "";
    const sortByKey = (rows: Row[], key: string) => rows.sort((a, b) => a[key]!.localeCompare(b[key]!));

    const records: Record<SupportedEntitySheet, Row[]> = {
      Branches: branchRows.map((row) => ({
        branch_key: row.publicId,
        qos_location_id: row.publicId,
        action: EXPORT_ROW_ACTION,
        name: row.name,
        timezone: row.timezone,
        slug: row.slug,
        status: row.status,
        expected_revision: REVISION.location(row),
        clear_fields: "",
      })),
      Categories: categoryRows.map((row) => {
        const names = categoryTranslations.get(row.id);
        return {
          category_key: row.publicId,
          qos_category_id: row.publicId,
          action: EXPORT_ROW_ACTION,
          internal_name: row.internalName,
          display_name_en: text(names?.en?.displayName),
          display_name_ar: text(names?.ar?.displayName),
          sort_order: text(row.sortOrder),
          status: row.status,
          expected_revision: REVISION.category(row, names),
          clear_fields: "",
        };
      }),
      Products: productRows.map((row) => {
        const names = productTranslations.get(row.id);
        return {
          product_key: row.publicId,
          qos_product_id: row.publicId,
          action: EXPORT_ROW_ACTION,
          internal_name: row.internalName,
          display_name_en: text(names?.en?.displayName),
          display_name_ar: text(names?.ar?.displayName),
          description_en: text(names?.en?.description),
          description_ar: text(names?.ar?.description),
          sku: text(row.sku),
          barcode: text(row.barcode),
          nutrition_calories: text(row.nutritionCalories),
          preparation_time_minutes: text(row.preparationTimeMinutes),
          walking_time_minutes: text(row.walkingTimeMinutes),
          high_salt: declaredBool(row.highSalt),
          is_stock_product: declaredBool(row.directStockIntent),
          // Blank means "keep the current image"; QOS media is not re-ingested from an export.
          image_url: "",
          status: row.status,
          expected_revision: REVISION.product(row, names),
          clear_fields: "",
        };
      }),
      "Product Categories": sortByKey(
        productCategoryRows.map((row) => {
          const product = keyOf(productKey, row.productId);
          const category = keyOf(categoryKey, row.categoryId);
          return {
            product_category_key: linkKey(product, category),
            qos_product_category_id: row.id,
            action: EXPORT_ROW_ACTION,
            product_key: product,
            category_key: category,
            sort_order: text(row.sortOrder),
            expected_revision: REVISION.productCategory(row),
            clear_fields: "",
          };
        }),
        "product_category_key",
      ),
      Variants: sortByKey(
        variantRows.map((row) => {
          const labels = variantTranslations.get(row.id);
          const price = priceByVariant.get(row.id);
          const costPolicy = variantCostPolicies.get(row.id);
          return {
            variant_key: row.publicId,
            qos_variant_id: row.publicId,
            action: EXPORT_ROW_ACTION,
            product_key: keyOf(productKey, row.productId),
            variant_label_en: text(labels?.en?.displayName),
            variant_label_ar: text(labels?.ar?.displayName),
            is_default: bool(row.isDefault),
            sort_order: text(row.sortOrder),
            sku: text(row.sku),
            barcode: text(row.barcode),
            amount_minor: text(price?.amountMinor),
            currency: text(price?.currency.trim()),
            selling_quantity_basis: text(row.sellingQuantityBasis),
            price_unit: text(row.priceUnit),
            price_unit_quantity: text(row.priceUnitQuantity),
            status: row.status,
            price_tax_basis: sellingTaxBasisWorkbookValue(row.priceTaxBasis ?? null),
            // 0 is a known 0% rate and is written as "0"; blank means not recorded.
            tax_rate_basis_points: text(row.taxRateBasisPoints),
            ...costPolicyCells(costPolicy),
            expected_revision: REVISION.variant(row, labels, price, costPolicy),
            clear_fields: "",
          };
        }),
        "variant_key",
      ),
      "Branch Prices": sortByKey(
        overrideRows.map((row) => {
          const variant = keyOf(variantKey, row.variantId);
          const branch = keyOf(locationKey, row.locationId);
          return {
            branch_price_key: linkKey(variant, branch, row.currency.trim()),
            qos_branch_price_id: row.id,
            action: EXPORT_ROW_ACTION,
            variant_key: variant,
            branch_key: branch,
            amount_minor: text(row.amountMinor),
            currency: row.currency.trim(),
            central_price_version: text(row.centralPriceVersionAtOverride),
            expected_revision: REVISION.branchPrice(row),
            clear_fields: "",
          };
        }),
        "branch_price_key",
      ),
      "Sales Channels": channelRows.map((row) => ({
        qos_channel_id: row.publicId,
        channel_code: row.code,
        display_name: row.displayName,
        kind: row.kind,
        workbook_slot: text(row.workbookSlot),
        status: row.status,
        expected_revision: revisionToken("sales_channel", row.publicId, [row.version, row.updatedAt]),
      })),
      "Variant Channel Prices": variantChannelPriceRows
        .map((row) => {
          const channel = channelById.get(row.channelId);
          return {
            qos_variant_id: keyOf(variantKey, row.variantId),
            qos_channel_id: text(channel?.publicId),
            workbook_slot: text(channel?.workbookSlot),
            amount_minor: text(row.amountMinor),
            currency: row.currency.trim(),
            // Blank keeps the current value, so an untouched export changes nothing.
            action: "",
            expected_revision: revisionToken("variant_channel_price", row.id, [row.version, row.updatedAt, row.amountMinor]),
          };
        })
        .sort(
          (a, b) =>
            a.qos_variant_id.localeCompare(b.qos_variant_id) ||
            a.qos_channel_id.localeCompare(b.qos_channel_id) ||
            a.currency.localeCompare(b.currency),
        ),
      "Modifier Groups": groupRows.map((row) => {
        const names = groupTranslations.get(row.id);
        return {
          modifier_group_key: row.publicId,
          qos_modifier_group_id: row.publicId,
          action: EXPORT_ROW_ACTION,
          internal_name: row.internalName,
          display_name_en: text(names?.en?.displayName),
          display_name_ar: text(names?.ar?.displayName),
          min_selections: text(row.minSelections),
          max_selections: text(row.maxSelections),
          status: row.status,
          expected_revision: REVISION.modifierGroup(row, names),
          clear_fields: "",
        };
      }),
      "Modifier Options": optionRows
        .map((row) => {
          const names = optionTranslations.get(row.id);
          const costPolicy = optionCostPolicies.get(row.id);
          return {
            modifier_option_key: row.publicId,
            qos_modifier_option_id: row.publicId,
            action: EXPORT_ROW_ACTION,
            modifier_group_key: keyOf(groupKey, row.modifierGroupId),
            display_name_en: text(names?.en?.displayName),
            display_name_ar: text(names?.ar?.displayName),
            price_minor: text(row.priceMinor),
            currency: row.currency.trim(),
            nutrition_calories: text(row.nutritionCalories),
            is_default: bool(row.isDefault),
            allows_quantity: bool(row.allowsQuantity),
            max_quantity: text(row.maxQuantity),
            sort_order: text(row.sortOrder),
            status: row.status,
            ...costPolicyCells(costPolicy),
            expected_revision: REVISION.modifierOption(row, names, costPolicy),
            clear_fields: "",
          };
        })
        .sort(
          (a, b) =>
            a.modifier_group_key.localeCompare(b.modifier_group_key) ||
            Number(a.sort_order) - Number(b.sort_order) ||
            a.modifier_option_key.localeCompare(b.modifier_option_key),
        ),
      "Modifier Option Channel Prices": optionChannelPriceRows
        .map((row) => {
          const channel = channelById.get(row.channelId);
          return {
            qos_modifier_option_id: keyOf(optionKey, row.modifierOptionId),
            qos_channel_id: text(channel?.publicId),
            workbook_slot: text(channel?.workbookSlot),
            amount_minor: text(row.amountMinor),
            currency: row.currency.trim(),
            action: "",
            expected_revision: revisionToken("modifier_option_channel_price", row.id, [
              row.version,
              row.updatedAt,
              row.amountMinor,
            ]),
          };
        })
        .sort(
          (a, b) =>
            a.qos_modifier_option_id.localeCompare(b.qos_modifier_option_id) ||
            a.qos_channel_id.localeCompare(b.qos_channel_id) ||
            a.currency.localeCompare(b.currency),
        ),
      "Product Modifiers": sortByKey(
        productModifierRows.map((row) => {
          const product = keyOf(productKey, row.productId);
          const group = keyOf(groupKey, row.modifierGroupId);
          return {
            product_modifier_key: linkKey(product, group),
            qos_product_modifier_id: row.id,
            action: EXPORT_ROW_ACTION,
            product_key: product,
            modifier_group_key: group,
            sort_order: text(row.sortOrder),
            // Assignment policy overrides (v1.1): blank means inherit.
            min_selections: text(row.minSelections),
            max_selections: text(row.maxSelections),
            repeat_allowed: row.repeatAllowed == null ? "" : bool(row.repeatAllowed),
            selection_count_mode: text(row.selectionCountMode),
            // Free-option allowances are unsupported; never exported as a value.
            free_options_count: "",
            expected_revision: REVISION.productModifier(row),
            clear_fields: "",
          };
        }),
        "product_modifier_key",
      ),
      Menus: menuRows.map((row) => {
        const names = menuTranslations.get(row.id);
        return {
          menu_key: row.publicId,
          qos_menu_id: row.publicId,
          action: EXPORT_ROW_ACTION,
          internal_name: row.internalName,
          display_name_en: text(names?.en?.displayName),
          display_name_ar: text(names?.ar?.displayName),
          description_en: text(names?.en?.description),
          description_ar: text(names?.ar?.description),
          status: row.status,
          expected_revision: REVISION.menu(row, names),
          clear_fields: "",
        };
      }),
      "Menu Branches": sortByKey(
        menuLocationRows.map((row) => {
          const menu = keyOf(menuKey, row.menuId);
          const branch = keyOf(locationKey, row.locationId);
          return {
            menu_branch_key: linkKey(menu, branch),
            qos_menu_branch_id: row.id,
            action: EXPORT_ROW_ACTION,
            menu_key: menu,
            branch_key: branch,
            expected_revision: REVISION.menuBranch(row),
            clear_fields: "",
          };
        }),
        "menu_branch_key",
      ),
      "Menu Sections": sectionRows
        .map((row) => {
          const names = sectionTranslations.get(row.id);
          return {
            section_key: row.publicId,
            qos_section_id: row.publicId,
            action: EXPORT_ROW_ACTION,
            menu_key: keyOf(menuKey, row.menuId),
            internal_name: row.internalName,
            display_name_en: text(names?.en?.displayName),
            display_name_ar: text(names?.ar?.displayName),
            sort_order: text(row.sortOrder),
            archived: bool(row.archived),
            expected_revision: REVISION.menuSection(row, names),
            clear_fields: "",
          };
        })
        .sort(
          (a, b) =>
            a.menu_key.localeCompare(b.menu_key) ||
            Number(a.sort_order) - Number(b.sort_order) ||
            a.section_key.localeCompare(b.section_key),
        ),
      "Menu Items": sectionProductRows
        .map((row) => {
          const section = keyOf(sectionKey, row.sectionId);
          const product = keyOf(productKey, row.productId);
          return {
            menu_item_key: linkKey(section, product),
            qos_menu_item_id: row.id,
            action: EXPORT_ROW_ACTION,
            section_key: section,
            product_key: product,
            sort_order: text(row.sortOrder),
            archived: bool(row.archived),
            expected_revision: REVISION.menuItem(row),
            clear_fields: "",
          };
        })
        .sort(
          (a, b) =>
            a.section_key.localeCompare(b.section_key) ||
            Number(a.sort_order) - Number(b.sort_order) ||
            a.menu_item_key.localeCompare(b.menu_item_key),
        ),
    };

    for (const [sheet, rows] of Object.entries(records)) {
      if (rows.length > WORKBOOK_LIMITS.maxRowsPerTable) {
        throw new WorkbookExportError(
          "export_too_large",
          `${sheet} has more than ${WORKBOOK_LIMITS.maxRowsPerTable} records; the workbook profile cannot carry them.`,
          422,
          { sheet, max: WORKBOOK_LIMITS.maxRowsPerTable },
        );
      }
    }

    const selectionLabel = selection === ALL_BRANCHES ? "all" : selection;
    const exportRevision = revisionToken("export", tenant.publicId, [
      brand.publicId,
      selectionLabel,
      ...Object.values(records).flatMap((rows) => rows.map((row) => row.expected_revision)),
    ]);
    const now = options.now ?? new Date();

    const manifest: WorkbookManifest = {
      profile: WORKBOOK_PROFILE_ID,
      template_version: WORKBOOK_CONTRACT.version,
      prepared_on: WORKBOOK_CONTRACT.context.find((entry) => entry.field === "prepared_on")?.value ?? "",
      tenant_public_id: tenant.publicId,
      brand_public_id: brand.publicId,
      source_namespace: exportSourceNamespace(tenant.publicId),
      export_revision: exportRevision,
      exported_at: isoWithOffset(now),
      pilot_currency: currency,
      business_timezone: tenant.defaultTimezone,
    };

    const stamp = now.toISOString().slice(0, 16).replace(/[-:]/g, "");
    const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "-");
    return {
      manifest,
      records,
      branchPublicIds: branchRows.map((row) => row.publicId),
      fileName: `qos-export-${safe(tenant.publicId)}-${safe(brand.publicId)}-${stamp}Z.xlsx`,
    };
  });
}

export async function buildCurrentRecordWorkbook(data: CurrentRecordExport) {
  return buildQosWorkbook({ manifest: data.manifest, records: data.records });
}

/** Tenant and brand public ids, so a parsed manifest naming another business can be flagged. */
export async function loadWorkbookTenantIdentity(db: DbClient, tenantId: string) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [tenant] = await tx
      .select({ publicId: tenants.publicId, baseCurrency: tenants.baseCurrency, defaultTimezone: tenants.defaultTimezone })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    const brandRows = await tx
      .select({ publicId: brands.publicId, name: brands.name })
      .from(brands)
      .where(eq(brands.tenantId, tenantId))
      .orderBy(asc(brands.name), asc(brands.publicId));
    return {
      tenantPublicId: tenant?.publicId,
      brandPublicIds: brandRows.map((row) => row.publicId),
      baseCurrency: tenant?.baseCurrency.trim(),
      defaultTimezone: tenant?.defaultTimezone,
      brands: brandRows.map((row) => ({ publicId: row.publicId, name: row.name })),
    };
  });
}

export type WorkbookTenantIdentity = Awaited<ReturnType<typeof loadWorkbookTenantIdentity>>;

/**
 * Brand a source conversion is for: the requested brand when it belongs to
 * the tenant (404 otherwise), the only brand, or none yet when there are
 * several. Parse never fails for a missing brand; convert does.
 */
export function resolveWorkbookBrand(identity: WorkbookTenantIdentity, requested: string | null | undefined) {
  const wanted = requested?.trim();
  if (wanted) {
    if (!identity.brands.some((brand) => brand.publicId === wanted)) {
      throw new WorkbookExportError("brand_not_found", "Brand not found.", 404);
    }
    return wanted;
  }
  return identity.brands.length === 1 ? identity.brands[0]!.publicId : null;
}
