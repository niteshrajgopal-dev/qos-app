import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type InventoryItemConversionRecord,
  type InventoryItemRecord,
  type InventoryItemReferenceCostRecord,
  type InventoryUnitRecord,
  type RecipeRecord,
  type RecipeSellableLinkRecord,
  type RecipeVersionLineRecord,
  type RecipeVersionRecord,
  type RecipeVersionStepRecord,
  catalogueProducts,
  catalogueProductTranslations,
  catalogueVariants,
  catalogueVariantTranslations,
  inventoryItemConversions,
  inventoryItemReferenceCosts,
  inventoryItems,
  recipes,
  recipeSellableLinks,
  recipeVersionLines,
  recipeVersions,
  recipeVersionSnapshots,
  recipeVersionSteps,
} from "@/db/schema";
import { buildItemGraph, findPath, type GraphRule, type GraphUnit } from "@/lib/inventory/conversion-graph";
import type { CostTaxBasis } from "@/lib/inventory/cost-completeness";
import {
  fromMicros,
  isExactAt,
  microsToDecimalString,
  mul,
  type Rational,
  toDecimalString,
  toExactDecimalString,
} from "@/lib/inventory/quantity-math";
import { loadTenantUnitsInTx, toUnitView, type UnitView } from "@/lib/inventory/shared";
import { estimateRecipeCost, type RecipeCostEstimate, type RecipeTaxBasis } from "@/lib/recipes/cost-estimate";
import { isOpenOn, versionPhase, type VersionPhase } from "@/lib/recipes/dates";
import { familyStates, lineStates, type RecipeStateKey, versionStates } from "@/lib/recipes/states";

/* QOS-198 recipe views. Everything a list, detail or history screen shows is
   built here from one tenant-scoped load, so list badges and detail notices
   use the same state derivation. Views carry public ids and codes only,
   never internal ids. Quantities and costs are exact decimal strings; when a
   value is rounded for display it says so. */

export type DecimalView = {
  /** Display text, rounded half-up when `rounded` is true. */
  text: string;
  /** Exact decimal text when it terminates within 12 places, otherwise null. */
  exact: string | null;
  rounded: boolean;
};

export type UnitRef = {
  publicId: string;
  code: string;
  nameEn: string;
  nameAr: string;
  decimalPlaces: number;
  status: "active" | "archived";
};

export type ItemRef = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  kind: "purchased" | "prepared";
  status: "active" | "archived";
  storageUnitCode: string | null;
};

export type LineView = {
  publicId: string;
  position: number;
  item: ItemRef;
  quantity: string;
  unit: UnitRef;
  labelEn: string | null;
  labelAr: string | null;
  /** The whole-yield line quantity in the item's storage unit, or why it cannot be converted. */
  conversion:
    | {
        status: "ok";
        inStorageUnit: DecimalView;
        storageUnitCode: string;
        path: Array<{ fromCode: string; toCode: string; source: "item_rule" | "standard" }>;
      }
    | { status: "missing" };
  cost:
    | { status: "known"; amount: DecimalView; currency: string; taxBasis: CostTaxBasis }
    | { status: "unknown" | "not_convertible" };
  states: RecipeStateKey[];
};

export type StepView = { publicId: string; position: number; textEn: string; textAr: string | null };

export type CostView =
  | {
      status: "known";
      perBatch: DecimalView;
      perYieldUnit: DecimalView | null;
      currency: string;
      taxBasis: RecipeTaxBasis;
    }
  | { status: "unavailable"; linesWithoutCost: number }
  | { status: "no_lines" };

export type VersionView = {
  publicId: string;
  versionNumber: number;
  status: RecipeVersionRecord["status"];
  phase: VersionPhase;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  yieldQuantity: string | null;
  yieldUnit: UnitRef | null;
  notes: string | null;
  approvedAt: string | null;
  approvedBySubject: string | null;
  version: number;
  /** When the approval snapshot was written; null for drafts and discarded versions. */
  snapshotAt: string | null;
  lines: LineView[];
  steps: StepView[];
  states: RecipeStateKey[];
  cost: CostView;
  createdAt: string;
  updatedAt: string;
};

export type LinkedVariantView = {
  linkPublicId: string;
  variantPublicId: string;
  productPublicId: string;
  productNameEn: string;
  productNameAr: string | null;
  variantNameEn: string | null;
  variantNameAr: string | null;
  isDefault: boolean;
  variantStatus: "draft" | "active" | "archived";
  productStatus: "draft" | "active" | "archived";
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type RecipeView = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  kind: RecipeRecord["kind"];
  status: RecipeRecord["status"];
  version: number;
  notes: string | null;
  outputItem: ItemRef | null;
  provenance: RecipeRecord["provenance"];
  createdAt: string;
  updatedAt: string;
};

export type PickerItem = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  kind: "purchased" | "prepared";
  /** Units a line for this item can use: its designated units and every unit they convert to. */
  unitPublicIds: string[];
};

export type RecipeDetailView = {
  recipe: RecipeView;
  /** Every version, newest first. */
  versions: VersionView[];
  /** Variants whose open link points at this family. */
  linkedVariants: LinkedVariantView[];
  /** Family-level states (no approved version, draft pending, no assignment, output item archived). */
  states: RecipeStateKey[];
  /** The tenant's business date used for current, scheduled and ended. */
  today: string;
  /** Active items and units for the editor pickers. */
  pickers: { items: PickerItem[]; units: UnitView[] };
};

export type RecipeSummaryView = RecipeView & {
  current: { publicId: string; versionNumber: number; effectiveFrom: string; yieldQuantity: string; yieldUnitCode: string } | null;
  draft: { publicId: string; versionNumber: number } | null;
  linkedVariantCount: number;
  shared: boolean;
  states: RecipeStateKey[];
  /** Estimate for the current version, or for the draft when nothing is approved yet. */
  cost: CostView;
};

export type VariantRow = {
  id: string;
  publicId: string;
  isDefault: boolean;
  sortOrder: number;
  status: "draft" | "active" | "archived";
  sellingQuantityBasis: string | null;
  nameEn: string | null;
  nameAr: string | null;
  product: {
    id: string;
    publicId: string;
    status: "draft" | "active" | "archived";
    directStockIntent: boolean | null;
    nameEn: string;
    nameAr: string | null;
  };
};

export type RecipeWorld = {
  today: string;
  recipes: RecipeRecord[];
  versions: RecipeVersionRecord[];
  /** Active lines and steps only, in position order. */
  lines: RecipeVersionLineRecord[];
  steps: RecipeVersionStepRecord[];
  snapshotAt: Map<string, Date>;
  units: InventoryUnitRecord[];
  items: InventoryItemRecord[];
  /** Current conversion rules and reference costs. */
  rules: InventoryItemConversionRecord[];
  costs: InventoryItemReferenceCostRecord[];
  /** Sellable links that have not ended by today. */
  links: RecipeSellableLinkRecord[];
  variants: VariantRow[];
};

export function toGraphUnit(unit: InventoryUnitRecord): GraphUnit {
  return { id: unit.id, code: unit.code, quantityKind: unit.quantityKind, standardCode: unit.standardCode, status: unit.status };
}

export function toGraphRule(rule: InventoryItemConversionRecord): GraphRule {
  return { id: rule.id, fromUnitId: rule.fromUnitId, toUnitId: rule.toUnitId, factorMicros: rule.factorMicros };
}

export function quantityView(value: Rational, places: number): DecimalView {
  return { text: toDecimalString(value, places), exact: toExactDecimalString(value), rounded: !isExactAt(value, places) };
}

/** Money: exact when it terminates within 6 places, otherwise rounded half-up to 6 and marked. */
export function moneyView(value: Rational): DecimalView {
  const exact = toExactDecimalString(value, 6);
  return exact !== null
    ? { text: exact, exact, rounded: false }
    : { text: toDecimalString(value, 6), exact: toExactDecimalString(value), rounded: true };
}

export function unitRef(unit: InventoryUnitRecord): UnitRef {
  return {
    publicId: unit.publicId,
    code: unit.code,
    nameEn: unit.nameEn,
    nameAr: unit.nameAr,
    decimalPlaces: unit.decimalPlaces,
    status: unit.status,
  };
}

export function itemRef(item: InventoryItemRecord, unitsById: ReadonlyMap<string, InventoryUnitRecord>): ItemRef {
  return {
    publicId: item.publicId,
    nameEn: item.nameEn,
    nameAr: item.nameAr,
    kind: item.kind,
    status: item.status,
    storageUnitCode: item.storageUnitId ? unitsById.get(item.storageUnitId)?.code ?? null : null,
  };
}

/** Every catalogue variant of the tenant with its product, both with EN/AR display names. */
export async function loadVariantRowsInTx(tx: DbClient, tenantId: string): Promise<VariantRow[]> {
  const rows = await tx
    .select({
      id: catalogueVariants.id,
      publicId: catalogueVariants.publicId,
      isDefault: catalogueVariants.isDefault,
      sortOrder: catalogueVariants.sortOrder,
      status: catalogueVariants.status,
      sellingQuantityBasis: catalogueVariants.sellingQuantityBasis,
      productId: catalogueProducts.id,
      productPublicId: catalogueProducts.publicId,
      productStatus: catalogueProducts.status,
      directStockIntent: catalogueProducts.directStockIntent,
      internalName: catalogueProducts.internalName,
    })
    .from(catalogueVariants)
    .innerJoin(
      catalogueProducts,
      and(eq(catalogueProducts.tenantId, catalogueVariants.tenantId), eq(catalogueProducts.id, catalogueVariants.productId)),
    )
    .where(eq(catalogueVariants.tenantId, tenantId))
    .orderBy(asc(catalogueProducts.internalName), asc(catalogueVariants.sortOrder), asc(catalogueVariants.publicId));
  const productNames = await tx
    .select({
      productId: catalogueProductTranslations.productId,
      locale: catalogueProductTranslations.locale,
      displayName: catalogueProductTranslations.displayName,
    })
    .from(catalogueProductTranslations)
    .where(eq(catalogueProductTranslations.tenantId, tenantId));
  const variantNames = await tx
    .select({
      variantId: catalogueVariantTranslations.variantId,
      locale: catalogueVariantTranslations.locale,
      displayName: catalogueVariantTranslations.displayName,
    })
    .from(catalogueVariantTranslations)
    .where(eq(catalogueVariantTranslations.tenantId, tenantId));
  const name = (list: Array<{ id: string; locale: string; displayName: string }>, id: string, locale: "en" | "ar") =>
    list.find((entry) => entry.id === id && entry.locale === locale)?.displayName.trim() || null;
  const products = productNames.map((entry) => ({ id: entry.productId, locale: entry.locale, displayName: entry.displayName }));
  const variants = variantNames.map((entry) => ({ id: entry.variantId, locale: entry.locale, displayName: entry.displayName }));
  return rows.map((row) => ({
    id: row.id,
    publicId: row.publicId,
    isDefault: row.isDefault,
    sortOrder: row.sortOrder,
    status: row.status,
    sellingQuantityBasis: row.sellingQuantityBasis,
    nameEn: name(variants, row.id, "en"),
    nameAr: name(variants, row.id, "ar"),
    product: {
      id: row.productId,
      publicId: row.productPublicId,
      status: row.productStatus,
      directStockIntent: row.directStockIntent,
      nameEn: name(products, row.productId, "en") ?? row.internalName,
      nameAr: name(products, row.productId, "ar"),
    },
  }));
}

/** Loads every record the recipe views need for this tenant (or one family). Pilot data volumes are small. */
export async function loadRecipeWorldInTx(
  tx: DbClient,
  tenantId: string,
  today: string,
  onlyRecipeId?: string,
): Promise<RecipeWorld> {
  const recipeRows = await tx
    .select()
    .from(recipes)
    .where(onlyRecipeId ? and(eq(recipes.tenantId, tenantId), eq(recipes.id, onlyRecipeId)) : eq(recipes.tenantId, tenantId))
    .orderBy(asc(recipes.nameEn), asc(recipes.publicId));
  const recipeIds = recipeRows.map((row) => row.id);
  const versions = recipeIds.length
    ? await tx
        .select()
        .from(recipeVersions)
        .where(and(eq(recipeVersions.tenantId, tenantId), inArray(recipeVersions.recipeId, recipeIds)))
        .orderBy(desc(recipeVersions.versionNumber))
    : [];
  const versionIds = versions.map((row) => row.id);
  const lines = versionIds.length
    ? await tx
        .select()
        .from(recipeVersionLines)
        .where(
          and(
            eq(recipeVersionLines.tenantId, tenantId),
            inArray(recipeVersionLines.recipeVersionId, versionIds),
            eq(recipeVersionLines.status, "active"),
          ),
        )
        .orderBy(asc(recipeVersionLines.position))
    : [];
  const steps = versionIds.length
    ? await tx
        .select()
        .from(recipeVersionSteps)
        .where(
          and(
            eq(recipeVersionSteps.tenantId, tenantId),
            inArray(recipeVersionSteps.recipeVersionId, versionIds),
            eq(recipeVersionSteps.status, "active"),
          ),
        )
        .orderBy(asc(recipeVersionSteps.position))
    : [];
  const snapshots = versionIds.length
    ? await tx
        .select({ versionId: recipeVersionSnapshots.recipeVersionId, createdAt: recipeVersionSnapshots.createdAt })
        .from(recipeVersionSnapshots)
        .where(and(eq(recipeVersionSnapshots.tenantId, tenantId), inArray(recipeVersionSnapshots.recipeVersionId, versionIds)))
    : [];
  const units = await loadTenantUnitsInTx(tx, tenantId);
  const items = await tx
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.tenantId, tenantId))
    .orderBy(asc(inventoryItems.nameEn), asc(inventoryItems.publicId));
  const rules = await tx
    .select()
    .from(inventoryItemConversions)
    .where(and(eq(inventoryItemConversions.tenantId, tenantId), isNull(inventoryItemConversions.effectiveTo)));
  const costs = await tx
    .select()
    .from(inventoryItemReferenceCosts)
    .where(and(eq(inventoryItemReferenceCosts.tenantId, tenantId), isNull(inventoryItemReferenceCosts.effectiveTo)));
  const links = (
    await tx.select().from(recipeSellableLinks).where(eq(recipeSellableLinks.tenantId, tenantId))
  ).filter((link) => isOpenOn(link.effectiveTo, today));
  return {
    today,
    recipes: recipeRows,
    versions,
    lines,
    steps,
    snapshotAt: new Map(snapshots.map((row) => [row.versionId, row.createdAt])),
    units,
    items,
    rules,
    costs,
    links,
    variants: await loadVariantRowsInTx(tx, tenantId),
  };
}

function versionCost(world: RecipeWorld, version: RecipeVersionRecord, lines: RecipeVersionLineRecord[]): RecipeCostEstimate {
  const itemIds = new Set(lines.map((line) => line.itemId));
  return estimateRecipeCost({
    lines: lines.map((line) => ({ lineId: line.id, itemId: line.itemId, unitId: line.unitId, quantityMicros: line.quantityMicros })),
    yieldQuantityMicros: version.yieldQuantityMicros,
    units: world.units.map(toGraphUnit),
    items: [...itemIds].map((itemId) => {
      const cost = world.costs.find((row) => row.itemId === itemId);
      return {
        itemId,
        cost: cost ? { unitId: cost.unitId, amountMicros: cost.amountMicros, currency: cost.currency, taxBasis: cost.taxBasis } : null,
        rules: world.rules.filter((rule) => rule.itemId === itemId).map(toGraphRule),
      };
    }),
  });
}

function costView(estimate: RecipeCostEstimate): CostView {
  const total = estimate.total;
  if (total.status !== "known") {
    return total;
  }
  return {
    status: "known",
    perBatch: moneyView(total.perBatch),
    perYieldUnit: total.perYieldUnit ? moneyView(total.perYieldUnit) : null,
    currency: total.currency,
    taxBasis: total.taxBasis,
  };
}

export function buildVersionView(world: RecipeWorld, version: RecipeVersionRecord): VersionView {
  const unitsById = new Map(world.units.map((unit) => [unit.id, unit]));
  const itemsById = new Map(world.items.map((item) => [item.id, item]));
  const graphUnits = world.units.map(toGraphUnit);
  const lines = world.lines.filter((line) => line.recipeVersionId === version.id);
  const estimate = versionCost(world, version, lines);
  const yieldUnit = version.yieldUnitId ? unitsById.get(version.yieldUnitId) ?? null : null;
  const lineViews: LineView[] = lines.map((line) => {
    const item = itemsById.get(line.itemId)!;
    const unit = unitsById.get(line.unitId)!;
    const storage = item.storageUnitId ? unitsById.get(item.storageUnitId) ?? null : null;
    const rules = world.rules.filter((rule) => rule.itemId === item.id).map(toGraphRule);
    const path = storage ? findPath(buildItemGraph(graphUnits, rules), unit.id, storage.id) : null;
    const conversion: LineView["conversion"] =
      path && storage
        ? {
            status: "ok",
            inStorageUnit: quantityView(mul(fromMicros(line.quantityMicros), path.factor), storage.decimalPlaces),
            storageUnitCode: storage.code,
            path: path.hops.map((hop) => ({ fromCode: hop.fromCode, toCode: hop.toCode, source: hop.source })),
          }
        : { status: "missing" };
    const lineCost = estimate.lines.find((entry) => entry.lineId === line.id)!;
    const cost: LineView["cost"] =
      lineCost.status === "known"
        ? { status: "known", amount: moneyView(lineCost.amount), currency: lineCost.currency, taxBasis: lineCost.taxBasis }
        : { status: lineCost.status };
    return {
      publicId: line.publicId,
      position: line.position,
      item: itemRef(item, unitsById),
      quantity: microsToDecimalString(line.quantityMicros),
      unit: unitRef(unit),
      labelEn: line.labelEn,
      labelAr: line.labelAr,
      conversion,
      cost,
      states: lineStates({ itemStatus: item.status, conversion: conversion.status, cost: lineCost.status }),
    };
  });
  const snapshotAt = world.snapshotAt.get(version.id);
  return {
    publicId: version.publicId,
    versionNumber: version.versionNumber,
    status: version.status,
    phase: versionPhase(version, world.today),
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    yieldQuantity: version.yieldQuantityMicros === null ? null : microsToDecimalString(version.yieldQuantityMicros),
    yieldUnit: yieldUnit ? unitRef(yieldUnit) : null,
    notes: version.notes,
    approvedAt: version.approvedAt?.toISOString() ?? null,
    approvedBySubject: version.approvedBySubject,
    version: version.version,
    snapshotAt: snapshotAt?.toISOString() ?? null,
    lines: lineViews,
    steps: world.steps
      .filter((step) => step.recipeVersionId === version.id)
      .map((step) => ({ publicId: step.publicId, position: step.position, textEn: step.textEn, textAr: step.textAr })),
    states: versionStates(
      {
        status: version.status,
        effectiveFrom: version.effectiveFrom,
        effectiveTo: version.effectiveTo,
        yieldQuantityMicros: version.yieldQuantityMicros,
        yieldUnitStatus: yieldUnit?.status ?? null,
        activeLineCount: lines.length,
      },
      world.today,
    ),
    cost: costView(estimate),
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  };
}

function recipeView(world: RecipeWorld, recipe: RecipeRecord): RecipeView {
  const unitsById = new Map(world.units.map((unit) => [unit.id, unit]));
  const output = recipe.outputItemId ? world.items.find((item) => item.id === recipe.outputItemId) ?? null : null;
  return {
    publicId: recipe.publicId,
    nameEn: recipe.nameEn,
    nameAr: recipe.nameAr,
    kind: recipe.kind,
    status: recipe.status,
    version: recipe.version,
    notes: recipe.notes,
    outputItem: output ? itemRef(output, unitsById) : null,
    provenance: recipe.provenance,
    createdAt: recipe.createdAt.toISOString(),
    updatedAt: recipe.updatedAt.toISOString(),
  };
}

function linkedVariants(world: RecipeWorld, recipeId: string): LinkedVariantView[] {
  return world.links
    .filter((link) => link.kind === "recipe" && link.recipeId === recipeId)
    .flatMap((link) => {
      const variant = world.variants.find((row) => row.id === link.variantId);
      if (!variant) return [];
      return [
        {
          linkPublicId: link.publicId,
          variantPublicId: variant.publicId,
          productPublicId: variant.product.publicId,
          productNameEn: variant.product.nameEn,
          productNameAr: variant.product.nameAr,
          variantNameEn: variant.nameEn,
          variantNameAr: variant.nameAr,
          isDefault: variant.isDefault,
          variantStatus: variant.status,
          productStatus: variant.product.status,
          effectiveFrom: link.effectiveFrom,
          effectiveTo: link.effectiveTo,
        },
      ];
    });
}

function recipeFamilyStates(world: RecipeWorld, recipe: RecipeRecord) {
  const output = recipe.outputItemId ? world.items.find((item) => item.id === recipe.outputItemId) ?? null : null;
  return familyStates({
    kind: recipe.kind,
    versions: world.versions.filter((version) => version.recipeId === recipe.id),
    liveLinkCount: world.links.filter((link) => link.kind === "recipe" && link.recipeId === recipe.id).length,
    outputItemStatus: output?.status ?? null,
  });
}

/** Units a line for the item may use: everything connected to one of its designated units, or all active units when none is set. */
export function pickerItems(world: RecipeWorld): PickerItem[] {
  const graphUnits = world.units.map(toGraphUnit);
  const active = world.units.filter((unit) => unit.status === "active");
  return world.items
    .filter((item) => item.status === "active")
    .map((item) => {
      const designated = [item.storageUnitId, item.recipeUnitId, item.purchaseUnitId].filter((id): id is string => id !== null);
      const graph = buildItemGraph(graphUnits, world.rules.filter((rule) => rule.itemId === item.id).map(toGraphRule));
      const reachable = designated.length
        ? active.filter((unit) => designated.some((from) => findPath(graph, from, unit.id) !== null))
        : active;
      return {
        publicId: item.publicId,
        nameEn: item.nameEn,
        nameAr: item.nameAr,
        kind: item.kind,
        unitPublicIds: reachable.map((unit) => unit.publicId),
      };
    });
}

export function buildRecipeDetail(world: RecipeWorld, recipe: RecipeRecord): RecipeDetailView {
  return {
    recipe: recipeView(world, recipe),
    versions: world.versions.filter((version) => version.recipeId === recipe.id).map((version) => buildVersionView(world, version)),
    linkedVariants: linkedVariants(world, recipe.id),
    states: recipeFamilyStates(world, recipe),
    today: world.today,
    pickers: {
      items: pickerItems(world),
      units: world.units.filter((unit) => unit.status === "active").map(toUnitView),
    },
  };
}

export function buildRecipeSummary(world: RecipeWorld, recipe: RecipeRecord): RecipeSummaryView {
  const versions = world.versions.filter((version) => version.recipeId === recipe.id);
  const current =
    versions.find((version) => versionPhase(version, world.today) === "current") ??
    versions.find((version) => version.status === "approved" && version.effectiveTo === null) ??
    null;
  const draft = versions.find((version) => version.status === "draft") ?? null;
  const shown = current ?? draft;
  const shownView = shown ? buildVersionView(world, shown) : null;
  const linked = world.links.filter((link) => link.kind === "recipe" && link.recipeId === recipe.id).length;
  const unitsById = new Map(world.units.map((unit) => [unit.id, unit]));
  const states = [
    ...recipeFamilyStates(world, recipe),
    ...(shownView?.states ?? []),
    ...(shownView?.lines.flatMap((line) => line.states) ?? []),
  ];
  return {
    ...recipeView(world, recipe),
    current:
      current && current.effectiveFrom && current.yieldQuantityMicros !== null && current.yieldUnitId
        ? {
            publicId: current.publicId,
            versionNumber: current.versionNumber,
            effectiveFrom: current.effectiveFrom,
            yieldQuantity: microsToDecimalString(current.yieldQuantityMicros),
            yieldUnitCode: unitsById.get(current.yieldUnitId)?.code ?? "",
          }
        : null,
    draft: draft ? { publicId: draft.publicId, versionNumber: draft.versionNumber } : null,
    linkedVariantCount: linked,
    shared: linked > 1,
    states: [...new Set(states)],
    cost: shownView?.cost ?? { status: "no_lines" },
  };
}
