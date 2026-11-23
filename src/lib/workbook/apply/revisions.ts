import { and, eq, inArray } from "drizzle-orm";

import {
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
  catalogueModifierOptions,
  catalogueModifierOptionTranslations,
  catalogueProductCategories,
  catalogueProductModifierGroups,
  catalogueProducts,
  catalogueProductTranslations,
  catalogueVariantLocationPriceOverrides,
  catalogueVariantPrices,
  catalogueVariants,
  catalogueVariantTranslations,
  locations,
  tenants,
} from "@/db/schema";
import { loadCurrentCostPoliciesInTx } from "@/lib/catalogue/reference-cost-policies";
import type { DbTransaction } from "@/lib/tenant/context";
import { REVISION, translationsByOwner } from "@/lib/workbook/export";
import { idColumnOf } from "@/lib/workbook/validation/snapshot";

/* Current revision tokens for the records one apply unit may touch
   (QOS-217, plan section 1.3 step 5). Same recipes as the export's
   `expected_revision`, read inside the unit's transaction. A unit reads the
   tokens of its whole side-effect scope, because some services touch
   siblings: a default-variant change rewrites the other variants, a default
   option the other options, a product reorder its other assignments, a menu
   save every section, item and branch link of that menu. */

type Tx = DbTransaction;

/** What a unit may change besides its target. */
export type TokenScope =
  | { kind: "record"; sheet: "Categories" | "Products" | "Modifier Groups" | "Menus"; publicId: string }
  | { kind: "link"; sheet: "Product Categories" | "Branch Prices"; id: string }
  | { kind: "product"; productPublicId: string }
  | { kind: "group"; groupPublicId: string }
  | { kind: "menu"; menuPublicId: string };

/**
 * Identity of a record across a save. Menu branch links are recreated by
 * every location change (new id), so they are identified by their endpoints;
 * everything else by its QOS id.
 */
export function recordIdentity(sheet: string, row: Record<string, string>) {
  if (sheet === "Menu Branches") return `${row.menu_key ?? ""}~${row.branch_key ?? ""}`;
  return row[idColumnOf(sheet)] ?? "";
}

export function tokenKey(sheet: string, identity: string) {
  return `${sheet}\u0000${identity}`;
}

export type ScopeTokens = Map<string, string>;

export async function loadScopeTokens(tx: Tx, tenantId: string, scope: TokenScope): Promise<ScopeTokens> {
  const tokens: ScopeTokens = new Map();
  switch (scope.kind) {
    case "record":
      await loadRecord(tx, tenantId, scope, tokens);
      break;
    case "link":
      await loadLink(tx, tenantId, scope, tokens);
      break;
    case "product":
      await loadProductScope(tx, tenantId, scope.productPublicId, tokens);
      break;
    case "group":
      await loadGroupScope(tx, tenantId, scope.groupPublicId, tokens);
      break;
    case "menu":
      await loadMenuScope(tx, tenantId, scope.menuPublicId, tokens);
      break;
  }
  return tokens;
}

async function loadRecord(tx: Tx, tenantId: string, scope: Extract<TokenScope, { kind: "record" }>, tokens: ScopeTokens) {
  if (scope.sheet === "Categories") {
    const [row] = await tx
      .select()
      .from(catalogueCategories)
      .where(and(eq(catalogueCategories.tenantId, tenantId), eq(catalogueCategories.publicId, scope.publicId)));
    if (!row) return;
    const names = translationsByOwner(
      await tx
        .select()
        .from(catalogueCategoryTranslations)
        .where(and(eq(catalogueCategoryTranslations.tenantId, tenantId), eq(catalogueCategoryTranslations.categoryId, row.id))),
      (entry) => entry.categoryId,
    ).get(row.id);
    tokens.set(tokenKey("Categories", row.publicId), REVISION.category(row, names));
    return;
  }
  if (scope.sheet === "Products") {
    const [row] = await tx
      .select()
      .from(catalogueProducts)
      .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.publicId, scope.publicId)));
    if (!row) return;
    const names = translationsByOwner(
      await tx
        .select()
        .from(catalogueProductTranslations)
        .where(and(eq(catalogueProductTranslations.tenantId, tenantId), eq(catalogueProductTranslations.productId, row.id))),
      (entry) => entry.productId,
    ).get(row.id);
    tokens.set(tokenKey("Products", row.publicId), REVISION.product(row, names));
    return;
  }
  if (scope.sheet === "Modifier Groups") {
    const [row] = await tx
      .select()
      .from(catalogueModifierGroups)
      .where(and(eq(catalogueModifierGroups.tenantId, tenantId), eq(catalogueModifierGroups.publicId, scope.publicId)));
    if (!row) return;
    const names = translationsByOwner(
      await tx
        .select()
        .from(catalogueModifierGroupTranslations)
        .where(and(eq(catalogueModifierGroupTranslations.tenantId, tenantId), eq(catalogueModifierGroupTranslations.modifierGroupId, row.id))),
      (entry) => entry.modifierGroupId,
    ).get(row.id);
    tokens.set(tokenKey("Modifier Groups", row.publicId), REVISION.modifierGroup(row, names));
    return;
  }
  const [row] = await tx
    .select()
    .from(catalogueMenus)
    .where(and(eq(catalogueMenus.tenantId, tenantId), eq(catalogueMenus.publicId, scope.publicId)));
  if (!row) return;
  const names = translationsByOwner(
    await tx
      .select()
      .from(catalogueMenuTranslations)
      .where(and(eq(catalogueMenuTranslations.tenantId, tenantId), eq(catalogueMenuTranslations.menuId, row.id))),
    (entry) => entry.menuId,
  ).get(row.id);
  tokens.set(tokenKey("Menus", row.publicId), REVISION.menu(row, names));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function loadLink(tx: Tx, tenantId: string, scope: Extract<TokenScope, { kind: "link" }>, tokens: ScopeTokens) {
  if (!UUID.test(scope.id)) return;
  if (scope.sheet === "Product Categories") {
    const [row] = await tx
      .select()
      .from(catalogueProductCategories)
      .where(and(eq(catalogueProductCategories.tenantId, tenantId), eq(catalogueProductCategories.id, scope.id)));
    if (row) tokens.set(tokenKey("Product Categories", row.id), REVISION.productCategory(row));
    return;
  }
  const [row] = await tx
    .select()
    .from(catalogueVariantLocationPriceOverrides)
    .where(and(eq(catalogueVariantLocationPriceOverrides.tenantId, tenantId), eq(catalogueVariantLocationPriceOverrides.id, scope.id)));
  if (row) tokens.set(tokenKey("Branch Prices", row.id), REVISION.branchPrice(row));
}

async function loadProductScope(tx: Tx, tenantId: string, productPublicId: string, tokens: ScopeTokens) {
  const [product] = await tx
    .select({ id: catalogueProducts.id })
    .from(catalogueProducts)
    .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.publicId, productPublicId)));
  if (!product) return;
  const variants = await tx
    .select()
    .from(catalogueVariants)
    .where(and(eq(catalogueVariants.tenantId, tenantId), eq(catalogueVariants.productId, product.id)));
  if (variants.length > 0) {
    const ids = variants.map((row) => row.id);
    const labels = translationsByOwner(
      await tx
        .select()
        .from(catalogueVariantTranslations)
        .where(and(eq(catalogueVariantTranslations.tenantId, tenantId), inArray(catalogueVariantTranslations.variantId, ids))),
      (entry) => entry.variantId,
    );
    const prices = await tx
      .select()
      .from(catalogueVariantPrices)
      .where(and(eq(catalogueVariantPrices.tenantId, tenantId), inArray(catalogueVariantPrices.variantId, ids)));
    const currency = await tenantCurrency(tx, tenantId);
    const costPolicies = await loadCurrentCostPoliciesInTx(tx, tenantId, "variant", ids);
    for (const variant of variants) {
      // Same choice as the export: the tenant currency when present.
      const own = prices.filter((price) => price.variantId === variant.id).sort((a, b) => a.currency.localeCompare(b.currency));
      const price = own.find((entry) => entry.currency.trim() === currency) ?? own[0];
      tokens.set(
        tokenKey("Variants", variant.publicId),
        REVISION.variant(variant, labels.get(variant.id), price, costPolicies.get(variant.id)),
      );
    }
  }
  const assignments = await tx
    .select()
    .from(catalogueProductModifierGroups)
    .where(and(eq(catalogueProductModifierGroups.tenantId, tenantId), eq(catalogueProductModifierGroups.productId, product.id)));
  for (const row of assignments) tokens.set(tokenKey("Product Modifiers", row.id), REVISION.productModifier(row));
}

async function tenantCurrency(tx: Tx, tenantId: string) {
  const [tenant] = await tx.select({ baseCurrency: tenants.baseCurrency }).from(tenants).where(eq(tenants.id, tenantId));
  return tenant?.baseCurrency.trim() ?? "";
}

async function loadGroupScope(tx: Tx, tenantId: string, groupPublicId: string, tokens: ScopeTokens) {
  const [group] = await tx
    .select({ id: catalogueModifierGroups.id })
    .from(catalogueModifierGroups)
    .where(and(eq(catalogueModifierGroups.tenantId, tenantId), eq(catalogueModifierGroups.publicId, groupPublicId)));
  if (!group) return;
  const options = await tx
    .select()
    .from(catalogueModifierOptions)
    .where(and(eq(catalogueModifierOptions.tenantId, tenantId), eq(catalogueModifierOptions.modifierGroupId, group.id)));
  if (options.length === 0) return;
  const names = translationsByOwner(
    await tx
      .select()
      .from(catalogueModifierOptionTranslations)
      .where(
        and(
          eq(catalogueModifierOptionTranslations.tenantId, tenantId),
          inArray(
            catalogueModifierOptionTranslations.modifierOptionId,
            options.map((row) => row.id),
          ),
        ),
      ),
    (entry) => entry.modifierOptionId,
  );
  const costPolicies = await loadCurrentCostPoliciesInTx(
    tx,
    tenantId,
    "modifier_option",
    options.map((row) => row.id),
  );
  for (const option of options) {
    tokens.set(
      tokenKey("Modifier Options", option.publicId),
      REVISION.modifierOption(option, names.get(option.id), costPolicies.get(option.id)),
    );
  }
}

async function loadMenuScope(tx: Tx, tenantId: string, menuPublicId: string, tokens: ScopeTokens) {
  const [menu] = await tx
    .select({ id: catalogueMenus.id })
    .from(catalogueMenus)
    .where(and(eq(catalogueMenus.tenantId, tenantId), eq(catalogueMenus.publicId, menuPublicId)));
  if (!menu) return;
  const branchLinks = await tx
    .select({ id: catalogueMenuLocations.id, createdAt: catalogueMenuLocations.createdAt, branch: locations.publicId })
    .from(catalogueMenuLocations)
    .innerJoin(locations, and(eq(locations.tenantId, catalogueMenuLocations.tenantId), eq(locations.id, catalogueMenuLocations.locationId)))
    .where(and(eq(catalogueMenuLocations.tenantId, tenantId), eq(catalogueMenuLocations.menuId, menu.id)));
  for (const link of branchLinks) {
    tokens.set(tokenKey("Menu Branches", recordIdentity("Menu Branches", { menu_key: menuPublicId, branch_key: link.branch })), REVISION.menuBranch(link));
  }
  const sections = await tx
    .select()
    .from(catalogueMenuSections)
    .where(and(eq(catalogueMenuSections.tenantId, tenantId), eq(catalogueMenuSections.menuId, menu.id)));
  if (sections.length === 0) return;
  const sectionIds = sections.map((row) => row.id);
  const names = translationsByOwner(
    await tx
      .select()
      .from(catalogueMenuSectionTranslations)
      .where(and(eq(catalogueMenuSectionTranslations.tenantId, tenantId), inArray(catalogueMenuSectionTranslations.sectionId, sectionIds))),
    (entry) => entry.sectionId,
  );
  for (const section of sections) tokens.set(tokenKey("Menu Sections", section.publicId), REVISION.menuSection(section, names.get(section.id)));
  const items = await tx
    .select()
    .from(catalogueMenuSectionProducts)
    .where(and(eq(catalogueMenuSectionProducts.tenantId, tenantId), inArray(catalogueMenuSectionProducts.sectionId, sectionIds)));
  for (const item of items) tokens.set(tokenKey("Menu Items", item.id), REVISION.menuItem(item));
}
