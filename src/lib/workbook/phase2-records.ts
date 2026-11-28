import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import {
  type InventoryCategoryRecord,
  type InventoryItemConversionRecord,
  type InventoryItemRecord,
  type InventoryItemReferenceCostRecord,
  type InventorySupplierRecord,
  type InventoryUnitRecord,
  type RecipeRecord,
  type RecipeVersionLineRecord,
  type RecipeVersionModifierEffectRecord,
  type RecipeVersionRecord,
  type RecipeVersionStepRecord,
  catalogueModifierOptions,
  catalogueVariants,
  inventoryCategories,
  inventoryItemConversions,
  inventoryItemReferenceCosts,
  inventoryItems,
  inventorySuppliers,
  inventoryUnits,
  inventoryWarehouses,
  recipes,
  recipeSellableLinks,
  recipeVersionLines,
  recipeVersionModifierEffects,
  recipeVersions,
  recipeVersionSteps,
} from "@/db/schema";
import { costTaxBasisWorkbookValue, microsToMajorString } from "@/lib/catalogue/selling-tax-cost";
import { buildItemGraph, findPath, type GraphUnit } from "@/lib/inventory/conversion-graph";
import { fromMicros, inverse, toExactDecimalString, type Rational } from "@/lib/inventory/quantity-math";
import type { DbTransaction } from "@/lib/tenant/context";

/* Phase 2 domain records in workbook vocabulary (QOS-200, plan section 3.2):
   units, suppliers, warehouses, inventory categories, ingredients (with the
   current storage-to-recipe factor and reference cost), recipes (one row per
   draft or approved version of an active family), recipe lines, prep steps
   and modifier effects. Read only. The export writes these rows; the review
   snapshot and the apply revision guard use the same revision recipes, so a
   review compares like with like and apply rechecks the same token. */

type Row = Record<string, string>;
type Stamp = string | number | boolean | Date | null | undefined;
type Token = (entity: string, id: string, stamps: Stamp[]) => string;

function text(value: string | number | null | undefined) {
  return value == null ? "" : String(value);
}

function bool(value: boolean) {
  return value ? "TRUE" : "FALSE";
}

function micros(value: bigint | null | undefined) {
  return value == null ? "" : microsToMajorString(value);
}

function graphUnit(unit: InventoryUnitRecord): GraphUnit {
  return {
    id: unit.id,
    code: unit.code,
    quantityKind: unit.quantityKind,
    standardCode: unit.standardCode,
    status: unit.status,
  };
}

/** Exact decimal text of a factor, or null when it has more than six places. */
function factorText(value: Rational) {
  return toExactDecimalString(value, 6);
}

export type ItemFactor = {
  /** Workbook text of `recipe_units_per_storage_unit`, blank when the two units are not related. */
  text: string;
  /** How the factor is known: same unit, two standard units, the item's direct rule, or derived through other rules. */
  source: "same_unit" | "standard" | "rule" | "derived" | "none";
  /** The current direct rule between the two units, either direction. */
  rule: InventoryItemConversionRecord | null;
  /** Whether the direct rule is written storage → recipe. */
  forward: boolean;
};

/**
 * 1 storage unit = factor recipe units for one item, from its current rules
 * (effective_to null) and the standard conversions. Both the export and the
 * Ingredients handler use this, so a re-upload compares like with like.
 */
export function currentItemFactor(
  item: Pick<InventoryItemRecord, "storageUnitId" | "recipeUnitId">,
  units: InventoryUnitRecord[],
  currentRules: InventoryItemConversionRecord[],
): ItemFactor {
  const storage = item.storageUnitId;
  const recipe = item.recipeUnitId;
  if (!storage || !recipe) return { text: "", source: "none", rule: null, forward: true };
  if (storage === recipe) return { text: "1", source: "same_unit", rule: null, forward: true };
  const rule =
    currentRules.find((entry) => entry.fromUnitId === storage && entry.toUnitId === recipe) ??
    currentRules.find((entry) => entry.fromUnitId === recipe && entry.toUnitId === storage) ??
    null;
  if (rule) {
    const forward = rule.fromUnitId === storage;
    const value = forward ? fromMicros(rule.factorMicros) : inverse(fromMicros(rule.factorMicros));
    return { text: factorText(value) ?? "", source: "rule", rule, forward };
  }
  const graph = buildItemGraph(
    units.map(graphUnit),
    currentRules.map((entry) => ({
      id: entry.id,
      fromUnitId: entry.fromUnitId,
      toUnitId: entry.toUnitId,
      factorMicros: entry.factorMicros,
    })),
  );
  const path = findPath(graph, storage, recipe);
  if (!path) return { text: "", source: "none", rule: null, forward: true };
  const standardOnly = path.hops.every((hop) => hop.source === "standard");
  return {
    text: factorText(path.factor) ?? "",
    source: standardOnly ? "standard" : "derived",
    rule: null,
    forward: true,
  };
}

/** The item's current reference cost row (effective_to null), if any. */
export function currentItemCost(costs: InventoryItemReferenceCostRecord[]) {
  return costs.find((cost) => cost.effectiveTo === null) ?? null;
}

const QUANTITY_KIND_VALUE: Record<InventoryUnitRecord["quantityKind"], string> = {
  mass: "MASS",
  volume: "VOLUME",
  count: "COUNT",
  pack: "PACK",
};

/* Revision recipes of the Phase 2 records. Change a recipe only here. */
export function phase2Revision(token: Token) {
  return {
    unit: (row: InventoryUnitRecord) => token("inventory_unit", row.publicId, [row.version, row.updatedAt]),
    supplier: (row: InventorySupplierRecord) => token("inventory_supplier", row.publicId, [row.version, row.updatedAt]),
    warehouse: (row: { publicId: string; version: number; updatedAt: Date }) =>
      token("inventory_warehouse", row.publicId, [row.version, row.updatedAt]),
    inventoryCategory: (row: InventoryCategoryRecord) => token("inventory_category", row.publicId, [row.version, row.updatedAt]),
    item: (row: InventoryItemRecord, factor: ItemFactor, cost: InventoryItemReferenceCostRecord | null) =>
      token("inventory_item", row.publicId, [
        row.version,
        row.updatedAt,
        factor.rule?.publicId,
        factor.rule?.revision,
        cost?.publicId,
        cost?.revision,
      ]),
    recipeVersion: (version: RecipeVersionRecord, family: RecipeRecord, openLinks: Array<{ publicId: string; revision: number }>) =>
      token("recipe_version", version.publicId, [
        version.version,
        version.updatedAt,
        version.status,
        family.version,
        family.updatedAt,
        ...openLinks.map((link) => `${link.publicId}:${link.revision}`).sort(),
      ]),
    recipeLine: (row: RecipeVersionLineRecord, version: RecipeVersionRecord) =>
      token("recipe_line", row.publicId, [version.version, version.updatedAt, row.status, row.updatedAt]),
    prepStep: (row: RecipeVersionStepRecord, version: RecipeVersionRecord) =>
      token("prep_step", row.publicId, [version.version, version.updatedAt, row.status, row.updatedAt]),
    modifierEffect: (row: RecipeVersionModifierEffectRecord, version: RecipeVersionRecord) =>
      token("modifier_effect", row.publicId, [version.version, version.updatedAt, row.status, row.updatedAt]),
  };
}

export type Phase2Sheet =
  | "Units"
  | "Suppliers"
  | "Warehouses"
  | "Inventory Categories"
  | "Ingredients"
  | "Recipes"
  | "Recipe Lines"
  | "Prep Steps"
  | "Modifier Effects";

export type Phase2Filter = {
  /** Locations whose warehouses are exported (the export's permitted branches). */
  locationIds: string[];
  locationKey: Map<string, string>;
};

/**
 * Rows of every Phase 2 sheet, in export vocabulary with revision tokens.
 * Keys are public ids (the QOS namespace). Archived records are exported with
 * `active` FALSE; recipe versions of archived families and discarded versions
 * are not, because nothing in the workbook can change them.
 */
export async function loadPhase2Records(
  tx: DbTransaction,
  tenantId: string,
  token: Token,
  filter: Phase2Filter,
): Promise<Record<Phase2Sheet, Row[]>> {
  const REVISION = phase2Revision(token);
  const units = await tx.select().from(inventoryUnits).where(eq(inventoryUnits.tenantId, tenantId)).orderBy(asc(inventoryUnits.publicId));
  const unitKey = new Map(units.map((unit) => [unit.id, unit.publicId]));
  const keyOf = (map: Map<string, string>, id: string | null) => (id ? (map.get(id) ?? "") : "");

  const suppliers = await tx
    .select()
    .from(inventorySuppliers)
    .where(eq(inventorySuppliers.tenantId, tenantId))
    .orderBy(asc(inventorySuppliers.publicId));
  const supplierKey = new Map(suppliers.map((row) => [row.id, row.publicId]));

  const categories = await tx
    .select()
    .from(inventoryCategories)
    .where(eq(inventoryCategories.tenantId, tenantId))
    .orderBy(asc(inventoryCategories.publicId));
  const categoryKey = new Map(categories.map((row) => [row.id, row.publicId]));

  const warehouses =
    filter.locationIds.length === 0
      ? []
      : await tx
          .select()
          .from(inventoryWarehouses)
          .where(and(eq(inventoryWarehouses.tenantId, tenantId), inArray(inventoryWarehouses.locationId, filter.locationIds)))
          .orderBy(asc(inventoryWarehouses.publicId));

  const items = await tx.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId)).orderBy(asc(inventoryItems.publicId));
  const itemKey = new Map(items.map((row) => [row.id, row.publicId]));
  const itemsById = new Map(items.map((row) => [row.id, row]));
  const itemIds = items.map((row) => row.id);
  const rules =
    itemIds.length === 0
      ? []
      : await tx
          .select()
          .from(inventoryItemConversions)
          .where(
            and(
              eq(inventoryItemConversions.tenantId, tenantId),
              inArray(inventoryItemConversions.itemId, itemIds),
              isNull(inventoryItemConversions.effectiveTo),
            ),
          );
  const costs =
    itemIds.length === 0
      ? []
      : await tx
          .select()
          .from(inventoryItemReferenceCosts)
          .where(
            and(
              eq(inventoryItemReferenceCosts.tenantId, tenantId),
              inArray(inventoryItemReferenceCosts.itemId, itemIds),
              isNull(inventoryItemReferenceCosts.effectiveTo),
            ),
          );

  const families = await tx
    .select()
    .from(recipes)
    .where(and(eq(recipes.tenantId, tenantId), eq(recipes.status, "active")))
    .orderBy(asc(recipes.publicId));
  const familyIds = families.map((row) => row.id);
  const familiesById = new Map(families.map((row) => [row.id, row]));
  const versions =
    familyIds.length === 0
      ? []
      : (
          await tx
            .select()
            .from(recipeVersions)
            .where(and(eq(recipeVersions.tenantId, tenantId), inArray(recipeVersions.recipeId, familyIds)))
            .orderBy(asc(recipeVersions.recipeId), asc(recipeVersions.versionNumber))
        ).filter((version) => version.status !== "discarded");
  const versionIds = versions.map((row) => row.id);
  const versionsById = new Map(versions.map((row) => [row.id, row]));
  const links =
    familyIds.length === 0
      ? []
      : await tx
          .select({
            publicId: recipeSellableLinks.publicId,
            revision: recipeSellableLinks.revision,
            recipeId: recipeSellableLinks.recipeId,
            variantPublicId: catalogueVariants.publicId,
          })
          .from(recipeSellableLinks)
          .innerJoin(
            catalogueVariants,
            and(eq(catalogueVariants.tenantId, recipeSellableLinks.tenantId), eq(catalogueVariants.id, recipeSellableLinks.variantId)),
          )
          .where(
            and(
              eq(recipeSellableLinks.tenantId, tenantId),
              inArray(recipeSellableLinks.recipeId, familyIds),
              isNull(recipeSellableLinks.effectiveTo),
            ),
          );
  const linksByFamily = new Map<string, typeof links>();
  for (const link of links) linksByFamily.set(link.recipeId!, [...(linksByFamily.get(link.recipeId!) ?? []), link]);

  const lines =
    versionIds.length === 0
      ? []
      : await tx
          .select()
          .from(recipeVersionLines)
          .where(
            and(
              eq(recipeVersionLines.tenantId, tenantId),
              inArray(recipeVersionLines.recipeVersionId, versionIds),
              eq(recipeVersionLines.status, "active"),
            ),
          )
          .orderBy(asc(recipeVersionLines.recipeVersionId), asc(recipeVersionLines.position));
  const lineKey = new Map(lines.map((row) => [row.id, row.publicId]));
  const steps =
    versionIds.length === 0
      ? []
      : await tx
          .select()
          .from(recipeVersionSteps)
          .where(
            and(
              eq(recipeVersionSteps.tenantId, tenantId),
              inArray(recipeVersionSteps.recipeVersionId, versionIds),
              eq(recipeVersionSteps.status, "active"),
            ),
          )
          .orderBy(asc(recipeVersionSteps.recipeVersionId), asc(recipeVersionSteps.position));
  const effects =
    versionIds.length === 0
      ? []
      : await tx
          .select()
          .from(recipeVersionModifierEffects)
          .where(
            and(
              eq(recipeVersionModifierEffects.tenantId, tenantId),
              inArray(recipeVersionModifierEffects.recipeVersionId, versionIds),
              eq(recipeVersionModifierEffects.status, "active"),
            ),
          )
          .orderBy(asc(recipeVersionModifierEffects.recipeVersionId), asc(recipeVersionModifierEffects.position));
  const optionIds = [...new Set(effects.map((row) => row.modifierOptionId))];
  const options =
    optionIds.length === 0
      ? []
      : await tx
          .select({
            id: catalogueModifierOptions.id,
            publicId: catalogueModifierOptions.publicId,
          })
          .from(catalogueModifierOptions)
          .where(and(eq(catalogueModifierOptions.tenantId, tenantId), inArray(catalogueModifierOptions.id, optionIds)));
  const optionKey = new Map(options.map((row) => [row.id, row.publicId]));

  /** A quantity is in the item's recipe unit only when its unit is that unit; anything else is not expressible in the workbook. */
  const recipeUnitQuantity = (itemId: string | null, unitId: string | null, value: bigint | null) =>
    itemId && unitId && itemsById.get(itemId)?.recipeUnitId === unitId ? micros(value) : "";

  return {
    Units: units.map((unit) => ({
      unit_key: unit.publicId,
      qos_unit_id: unit.publicId,
      action: "skip",
      code: unit.code,
      name: unit.nameEn,
      name_ar: unit.nameAr,
      standard_code: text(unit.standardCode),
      quantity_kind: QUANTITY_KIND_VALUE[unit.quantityKind],
      decimal_places: text(unit.decimalPlaces),
      active: bool(unit.status === "active"),
      expected_revision: REVISION.unit(unit),
      clear_fields: "",
    })),
    Suppliers: suppliers.map((row) => ({
      supplier_key: row.publicId,
      qos_supplier_id: row.publicId,
      action: "skip",
      name: row.nameEn,
      contact_name: text(row.contactName),
      email: text(row.email),
      phone: text(row.phone),
      reference: text(row.code),
      active: bool(row.status === "active"),
      notes: text(row.notes),
      expected_revision: REVISION.supplier(row),
      clear_fields: "",
    })),
    Warehouses: warehouses.map((row) => ({
      warehouse_key: row.publicId,
      qos_warehouse_id: row.publicId,
      action: "skip",
      branch_key: filter.locationKey.get(row.locationId) ?? "",
      code: row.code,
      name: row.nameEn,
      active: bool(row.status === "active"),
      notes: text(row.notes),
      expected_revision: REVISION.warehouse(row),
      clear_fields: "",
    })),
    "Inventory Categories": categories.map((row) => ({
      inventory_category_key: row.publicId,
      qos_inventory_category_id: row.publicId,
      action: "skip",
      name_en: row.nameEn,
      name_ar: text(row.nameAr),
      active: bool(row.status === "active"),
      expected_revision: REVISION.inventoryCategory(row),
      clear_fields: "",
    })),
    Ingredients: items.map((row) => {
      const factor = currentItemFactor(
        row,
        units,
        rules.filter((rule) => rule.itemId === row.id),
      );
      const cost = currentItemCost(costs.filter((entry) => entry.itemId === row.id));
      // A cost priced in another unit is not a "per storage unit" value: it is not exported, and a blank keeps it.
      const exported = cost && cost.unitId === row.storageUnitId ? cost : null;
      return {
        ingredient_key: row.publicId,
        qos_ingredient_id: row.publicId,
        action: "skip",
        name_en: row.nameEn,
        name_ar: text(row.nameAr),
        inventory_category_key: keyOf(categoryKey, row.categoryId),
        ingredient_type: row.kind.toUpperCase(),
        storage_unit_key: keyOf(unitKey, row.storageUnitId),
        recipe_unit_key: keyOf(unitKey, row.recipeUnitId),
        recipe_units_per_storage_unit: factor.text,
        default_supplier_key: keyOf(supplierKey, row.defaultSupplierId),
        reference_cost_per_storage_unit: exported ? micros(exported.amountMicros) : "",
        cost_currency: exported ? exported.currency.trim() : "",
        cost_tax_basis: exported ? costTaxBasisWorkbookValue(exported.taxBasis) : "",
        cost_effective_date: exported ? exported.effectiveFrom : "",
        cost_source_reference: exported ? text(exported.sourceReference) : "",
        active: bool(row.status === "active"),
        notes: text(row.notes),
        expected_revision: REVISION.item(row, factor, cost),
        clear_fields: "",
      };
    }),
    Recipes: versions.map((version) => {
      const family = familiesById.get(version.recipeId)!;
      const familyLinks = linksByFamily.get(family.id) ?? [];
      // The workbook carries the primary variant target only; shared links stay in the recipe editor.
      const primary = [...familyLinks].sort((a, b) => a.variantPublicId.localeCompare(b.variantPublicId))[0];
      return {
        recipe_version_key: version.publicId,
        qos_recipe_version_id: version.publicId,
        action: "skip",
        recipe_key: family.publicId,
        version_number: text(version.versionNumber),
        name: family.nameEn,
        target_type: family.kind === "sellable" ? "SOLD_VARIANT" : "PREPARED_ITEM",
        variant_key: family.kind === "sellable" ? text(primary?.variantPublicId) : "",
        prepared_ingredient_key: keyOf(itemKey, family.outputItemId),
        yield_quantity: micros(version.yieldQuantityMicros),
        yield_unit_key: keyOf(unitKey, version.yieldUnitId),
        effective_from: text(version.effectiveFrom),
        effective_to: text(version.effectiveTo),
        notes: text(version.notes),
        expected_revision: REVISION.recipeVersion(version, family, familyLinks),
        clear_fields: "",
      };
    }),
    "Recipe Lines": lines.map((row) => {
      const version = versionsById.get(row.recipeVersionId)!;
      return {
        recipe_line_key: row.publicId,
        qos_recipe_line_id: row.publicId,
        action: "skip",
        recipe_version_key: version.publicId,
        ingredient_key: keyOf(itemKey, row.itemId),
        quantity_recipe_units: recipeUnitQuantity(row.itemId, row.unitId, row.quantityMicros),
        sort_order: text(row.position + 1),
        notes: "",
        expected_revision: REVISION.recipeLine(row, version),
        clear_fields: "",
      };
    }),
    "Prep Steps": steps.map((row) => {
      const version = versionsById.get(row.recipeVersionId)!;
      return {
        prep_step_key: row.publicId,
        qos_prep_step_id: row.publicId,
        action: "skip",
        recipe_version_key: version.publicId,
        step_number: text(row.position + 1),
        title: "",
        instruction: row.textEn,
        expected_minutes: "",
        checkpoint_required: "",
        notes: "",
        expected_revision: REVISION.prepStep(row, version),
        clear_fields: "",
      };
    }),
    "Modifier Effects": effects.map((row) => {
      const version = versionsById.get(row.recipeVersionId)!;
      return {
        effect_key: row.publicId,
        qos_effect_id: row.publicId,
        action: "skip",
        modifier_option_key: keyOf(optionKey, row.modifierOptionId),
        recipe_version_key: version.publicId,
        effect_type: row.effectType.toUpperCase(),
        target_recipe_line_key: keyOf(lineKey, row.targetLineId),
        ingredient_key: keyOf(itemKey, row.itemId),
        quantity_per_sold_unit: recipeUnitQuantity(row.itemId, row.unitId, row.quantityMicros),
        notes: text(row.notes),
        expected_revision: REVISION.modifierEffect(row, version),
        clear_fields: "",
      };
    }),
  };
}
