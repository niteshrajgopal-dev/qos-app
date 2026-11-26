import { and, eq, inArray, isNull } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  type InventoryItemConversionRecord,
  type InventoryItemRecord,
  type InventoryItemReferenceCostRecord,
  type InventoryUnitRecord,
  type RecipeRecord,
  type RecipeSellableLinkRecord,
  type RecipeVersionLineRecord,
  type RecipeVersionModifierEffectRecord,
  type RecipeVersionRecord,
  catalogueModifierOptionChannelPrices,
  catalogueModifierOptions,
  catalogueProducts,
  catalogueVariantChannelPrices,
  catalogueVariantPrices,
  catalogueVariants,
  inventoryItemConversions,
  inventoryItemReferenceCosts,
  inventoryItems,
  recipes,
  recipeSellableLinks,
  recipeVersionLines,
  recipeVersionModifierEffects,
  recipeVersions,
  salesChannels,
} from "@/db/schema";
import type { ChannelPriceOverride } from "@/lib/catalogue/channel-price-resolver";
import { loadProductModifierGroupsInTx, selectionRulesForAssignment } from "@/lib/catalogue/modifiers";
import type { ModifierSelectionInput } from "@/lib/catalogue/modifier-selection";
import { loadCurrentCostPoliciesInTx, type RecipeDerivedOutcome, type ReferenceCostPolicyRow } from "@/lib/catalogue/reference-cost-policies";
import { isCalendarDate, microsToMajorString, type SellingPriceTaxBasis } from "@/lib/catalogue/selling-tax-cost";
import { InventoryError } from "@/lib/inventory/errors";
import { microsToDecimalString, toMicrosHalfUp } from "@/lib/inventory/quantity-math";
import { loadTenantUnitsInTx, tenantToday } from "@/lib/inventory/shared";
import type { CostItemInput, RecipeTaxBasis } from "@/lib/recipes/cost-estimate";
import {
  batchCost,
  type ConfigurationCost,
  type ConfigurationMarginReason,
  configurationMargin,
  configurationPrice,
  type ContributionCost,
  costConfiguration,
  type CostPolicyInput,
  type PriceInheritance,
} from "@/lib/recipes/costing";
import {
  type AssignedGroup,
  applyModifierEffects,
  type ConfigurationResult,
  type ContributionKind,
  type RejectionCode,
} from "@/lib/recipes/effects";
import type { LineUsageStatus, ResolutionInput } from "@/lib/recipes/resolution";
import type { ConsumptionPreviewView } from "@/lib/recipes/resolution-service";
import { loadVariantByPublicIdInTx } from "@/lib/recipes/shared";
import {
  type CostView,
  type DecimalView,
  type ItemRef,
  itemRef,
  loadModifierWorldInTx,
  loadVariantRowsInTx,
  type ModifierWorld,
  moneyView,
  quantityView,
  toGraphRule,
  toGraphUnit,
} from "@/lib/recipes/views";
import { withTenantContext } from "@/lib/tenant/context";

/* QOS-199 configuration preview and recipe-derived reference cost. Loads one
   tenant's recipe, effect, modifier, cost, policy and price records and runs
   the pure engine (effects.ts) and costing (costing.ts). Read-only: nothing
   is written, stored, posted or deducted, and option prices and selection
   rules are only read. Estimates use today's current reference costs and
   are never a posted snapshot. Any active member may read. */

export const MAX_PREVIEW_QUANTITY = 1000;
export const MAX_OPTION_QUANTITY = 99;
const MAX_OPTIONS = 50;

export type PreviewOptionRef = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  groupPublicId: string;
  groupNameEn: string;
  groupNameAr: string | null;
};

export type PreviewGroupView = {
  publicId: string;
  nameEn: string;
  nameAr: string | null;
  status: "active" | "archived";
  /** Effective for this product (QOS-212). */
  minSelections: number;
  maxSelections: number;
  selectionCountMode: "distinct_options" | "total_quantity";
  options: Array<{
    publicId: string;
    nameEn: string;
    nameAr: string | null;
    status: "active" | "archived";
    isDefault: boolean;
    /** Effective cap for this product. */
    maxQuantity: number;
    priceMinor: number;
    currency: string;
    /** Active effects of this option on the resolved version. */
    effectCount: number;
  }>;
};

export type ContributionView = {
  kind: ContributionKind;
  linePublicId: string | null;
  effectPublicId: string | null;
  option: PreviewOptionRef | null;
  item: ItemRef;
  /** As entered on the line (whole yield) or the effect (per selection, per sale). */
  quantity: string;
  unitCode: string;
  multiplier: number;
  status: LineUsageStatus;
  storageUnitCode: string | null;
  /** Signed: removals are negative. */
  perSale: DecimalView | null;
  total: DecimalView | null;
  cost:
    | { status: "known"; amount: DecimalView; currency: string; taxBasis: "net" | "gross" | "unconfirmed" }
    | { status: "unknown" | "not_convertible" }
    | { status: "not_costed"; reason: "manual_base" | "manual_option" };
};

export type CostComponentView = {
  source: "base" | "option";
  option: PreviewOptionRef | null;
  method: "manual" | "derived";
  quantity: number;
  status: "known" | "unavailable";
  amount: DecimalView | null;
  currency: string | null;
  taxBasis: RecipeTaxBasis | null;
};

export type ConfigurationCostView =
  | {
      status: "known";
      perSale: DecimalView;
      total: DecimalView;
      currency: string;
      taxBasis: RecipeTaxBasis;
      baseMethod: "manual" | "derived";
      components: CostComponentView[];
    }
  | {
      status: "unavailable";
      reason: Extract<ConfigurationCost, { status: "unavailable" }>["reason"];
      missingCount: number;
      attributionOptions: PreviewOptionRef[];
      baseMethod: "manual" | "derived";
      components: CostComponentView[];
    };

export type PriceView =
  | {
      status: "available";
      base: string;
      baseInheritance: PriceInheritance;
      options: string;
      total: string;
      totalMinor: number;
      currency: string;
      priceTaxBasis: SellingPriceTaxBasis | null;
      taxRateBasisPoints: number | null;
      channel: { publicId: string; displayName: string } | null;
    }
  | { status: "unavailable"; reason: "missing_price" | "option_currency_mismatch"; channel: { publicId: string; displayName: string } | null };

export type MarginView =
  | {
      status: "available";
      basis: "net" | "gross";
      currency: string;
      price: string;
      cost: string;
      margin: string;
      marginMicros: string;
      marginPercent: { text: string; rounded: boolean };
      rounding: "none" | "half_up_micros";
    }
  | { status: "unavailable"; reason: ConfigurationMarginReason };

export type ConfigurationPreviewView = ConsumptionPreviewView & {
  defaults: "auto" | "none";
  defaultsApplied: boolean;
  configurationStatus: "resolved" | "rejected" | "unresolved";
  groups: PreviewGroupView[];
  selections: Array<{ option: PreviewOptionRef; quantity: number; source: "selected" | "default"; priceMinor: number }>;
  rejections: Array<{
    code: RejectionCode;
    options: PreviewOptionRef[];
    group: { publicId: string; nameEn: string; nameAr: string | null } | null;
    item: ItemRef | null;
    linePublicId: string | null;
  }>;
  contributions: ContributionView[];
  perItem: Array<{ item: ItemRef; storageUnitCode: string | null; perSale: DecimalView | null; total: DecimalView | null }>;
  configurationComplete: boolean;
  cost: ConfigurationCostView;
  /** The resolved version's batch and per-output estimate (QOS-198), or null without a recipe version. */
  batchCost: CostView | null;
  price: PriceView;
  margin: MarginView;
};

type PreviewQuery = {
  variantPublicId: string | null;
  date: string | null;
  quantity: string | null;
  options?: readonly string[];
  defaults?: string | null;
  channelPublicId?: string | null;
};

function parseSoldQuantity(value: string | null): number {
  if (value === null || value === "") return 1;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > MAX_PREVIEW_QUANTITY) {
    throw new InventoryError(`Enter a whole number of sales from 1 to ${MAX_PREVIEW_QUANTITY}.`, 400, "quantity_invalid", "quantity");
  }
  return Number(value);
}

/** `opt_x` or `opt_x:2`; a whole quantity from 1 to 99. */
export function parseOptionParams(values: readonly string[]): ModifierSelectionInput[] {
  if (values.length > MAX_OPTIONS) {
    throw new InventoryError(`Choose at most ${MAX_OPTIONS} options.`, 400, "option_param_invalid", "option");
  }
  return values.map((value) => {
    const match = /^([A-Za-z0-9_-]+)(?::(\d{1,2}))?$/.exec(value.trim());
    const quantity = match?.[2] === undefined ? 1 : Number(match[2]);
    if (!match || quantity < 1 || quantity > MAX_OPTION_QUANTITY) {
      throw new InventoryError("Send each option as its id, optionally followed by a colon and a quantity from 1 to 99.", 400, "option_param_invalid", "option");
    }
    return { optionPublicId: match[1]!, quantity };
  });
}

function parseDefaults(value: string | null | undefined): "auto" | "none" {
  if (value === undefined || value === null || value === "" || value === "auto") return "auto";
  if (value === "none") return "none";
  throw new InventoryError("Defaults must be auto or none.", 400, "defaults_invalid", "defaults");
}

/** Everything the engine needs for a set of variants: links, recipes, versions, lines, effects, items, units, rules and current costs. */
type CostWorld = {
  links: RecipeSellableLinkRecord[];
  families: RecipeRecord[];
  versions: RecipeVersionRecord[];
  lines: RecipeVersionLineRecord[];
  effects: RecipeVersionModifierEffectRecord[];
  items: InventoryItemRecord[];
  units: InventoryUnitRecord[];
  rules: InventoryItemConversionRecord[];
  costs: InventoryItemReferenceCostRecord[];
};

async function loadCostWorldInTx(tx: DbClient, tenantId: string, variantIds: string[]): Promise<CostWorld> {
  const links = variantIds.length
    ? await tx
        .select()
        .from(recipeSellableLinks)
        .where(and(eq(recipeSellableLinks.tenantId, tenantId), inArray(recipeSellableLinks.variantId, variantIds)))
    : [];
  const recipeIds = [...new Set(links.map((link) => link.recipeId).filter((id): id is string => id !== null))];
  const families = recipeIds.length
    ? await tx.select().from(recipes).where(and(eq(recipes.tenantId, tenantId), inArray(recipes.id, recipeIds)))
    : [];
  const versions = recipeIds.length
    ? await tx.select().from(recipeVersions).where(and(eq(recipeVersions.tenantId, tenantId), inArray(recipeVersions.recipeId, recipeIds)))
    : [];
  const versionIds = versions.map((version) => version.id);
  const lines = versionIds.length
    ? (
        await tx
          .select()
          .from(recipeVersionLines)
          .where(and(eq(recipeVersionLines.tenantId, tenantId), inArray(recipeVersionLines.recipeVersionId, versionIds)))
      ).sort((a, b) => a.position - b.position)
    : [];
  const effects = versionIds.length
    ? (
        await tx
          .select()
          .from(recipeVersionModifierEffects)
          .where(
            and(
              eq(recipeVersionModifierEffects.tenantId, tenantId),
              inArray(recipeVersionModifierEffects.recipeVersionId, versionIds),
              eq(recipeVersionModifierEffects.status, "active"),
            ),
          )
      ).sort((a, b) => a.position - b.position)
    : [];
  return {
    links,
    families,
    versions,
    lines,
    effects,
    items: await tx.select().from(inventoryItems).where(eq(inventoryItems.tenantId, tenantId)),
    units: await loadTenantUnitsInTx(tx, tenantId),
    rules: await tx.select().from(inventoryItemConversions).where(eq(inventoryItemConversions.tenantId, tenantId)),
    costs: await tx
      .select()
      .from(inventoryItemReferenceCosts)
      .where(and(eq(inventoryItemReferenceCosts.tenantId, tenantId), isNull(inventoryItemReferenceCosts.effectiveTo))),
  };
}

function resolutionInput(
  world: CostWorld,
  variant: { id: string; status: "draft" | "active" | "archived"; productStatus: "draft" | "active" | "archived"; sellingQuantityBasis: string | null },
  businessDate: string,
  soldQuantity: number,
): ResolutionInput {
  return {
    businessDate,
    soldQuantity,
    variant: { status: variant.status, productStatus: variant.productStatus, sellingQuantityBasis: variant.sellingQuantityBasis },
    links: world.links
      .filter((link) => link.variantId === variant.id)
      .map((link) => ({
        id: link.id,
        kind: link.kind,
        recipeId: link.recipeId,
        itemId: link.itemId,
        quantityMicros: link.quantityMicros,
        unitId: link.unitId,
        effectiveFrom: link.effectiveFrom,
        effectiveTo: link.effectiveTo,
      })),
    recipes: world.families.map((family) => ({
      id: family.id,
      kind: family.kind,
      status: family.status,
      versions: world.versions
        .filter((version) => version.recipeId === family.id)
        .map((version) => ({
          id: version.id,
          versionNumber: version.versionNumber,
          status: version.status,
          effectiveFrom: version.effectiveFrom,
          effectiveTo: version.effectiveTo,
          yieldQuantityMicros: version.yieldQuantityMicros,
          yieldUnitId: version.yieldUnitId,
          lines: world.lines.filter((line) => line.recipeVersionId === version.id),
        })),
    })),
    items: world.items.map((item) => ({ id: item.id, status: item.status, kind: item.kind, storageUnitId: item.storageUnitId })),
    units: world.units.map(toGraphUnit),
    rules: world.rules.map((rule) => ({
      id: rule.id,
      itemId: rule.itemId,
      fromUnitId: rule.fromUnitId,
      toUnitId: rule.toUnitId,
      factorMicros: rule.factorMicros,
      effectiveFrom: rule.effectiveFrom,
      effectiveTo: rule.effectiveTo,
    })),
  };
}

/** Current item costs with current conversion rules, as estimateRecipeCost uses them. */
function costItems(world: CostWorld): CostItemInput[] {
  return world.items.map((item) => {
    const cost = world.costs.find((row) => row.itemId === item.id);
    return {
      itemId: item.id,
      cost: cost ? { unitId: cost.unitId, amountMicros: cost.amountMicros, currency: cost.currency, taxBasis: cost.taxBasis } : null,
      rules: world.rules.filter((rule) => rule.itemId === item.id && rule.effectiveTo === null).map(toGraphRule),
    };
  });
}

function policyInput(row: ReferenceCostPolicyRow | undefined): CostPolicyInput {
  if (!row) return null;
  return { method: row.method, amountMicros: row.amountMicros ?? null, currency: row.currency?.trim() ?? null, unit: row.unit ?? null, taxBasis: row.taxBasis ?? null };
}

function versionBatchCost(world: CostWorld, versionId: string): CostView {
  const version = world.versions.find((row) => row.id === versionId)!;
  const lines = world.lines.filter((line) => line.recipeVersionId === versionId && line.status === "active");
  const estimate = batchCost({
    lines: lines.map((line) => ({ lineId: line.id, itemId: line.itemId, unitId: line.unitId, quantityMicros: line.quantityMicros })),
    yieldQuantityMicros: version.yieldQuantityMicros,
    units: world.units.map(toGraphUnit),
    items: costItems(world),
  });
  const total = estimate.total;
  if (total.status !== "known") return total;
  return {
    status: "known",
    perBatch: moneyView(total.perBatch),
    perYieldUnit: total.perYieldUnit ? moneyView(total.perYieldUnit) : null,
    currency: total.currency,
    taxBasis: total.taxBasis,
  };
}

/**
 * QOS-199: the recipe-derived reference cost of each variant for the product
 * editor: the base configuration (lines only, no options), one sale, today's
 * business date and current reference costs. Never stored.
 */
export async function resolveVariantRecipeCostsInTx(
  tx: DbClient,
  tenantId: string,
  variants: Array<{ id: string; status: "draft" | "active" | "archived"; productStatus: "draft" | "active" | "archived"; sellingQuantityBasis: string | null }>,
  now: Date = new Date(),
): Promise<Map<string, RecipeDerivedOutcome>> {
  const result = new Map<string, RecipeDerivedOutcome>();
  if (variants.length === 0) return result;
  const today = await tenantToday(tx, tenantId, now);
  const world = await loadCostWorldInTx(tx, tenantId, variants.map((variant) => variant.id));
  for (const variant of variants) {
    const configuration = applyModifierEffects({
      ...resolutionInput(world, variant, today, 1),
      effects: [],
      groups: [],
      selections: [],
      defaults: "none",
    });
    if (configuration.status !== "resolved") {
      const reason = configuration.status === "unresolved" ? configuration.base.reason : null;
      result.set(variant.id, {
        status: "unavailable",
        reason:
          reason === "no_link"
            ? "recipe_no_link"
            : reason === "draft_only" || reason === "no_approved_version" || reason === "overlapping_versions"
              ? "recipe_no_version"
              : "recipe_unresolved",
      });
      continue;
    }
    const cost = costConfiguration({
      configuration,
      soldQuantity: 1,
      units: world.units.map(toGraphUnit),
      items: costItems(world),
      basePolicy: null,
      optionPolicies: new Map(),
    });
    if (cost.status !== "known") {
      result.set(variant.id, { status: "unavailable", reason: "recipe_incomplete" });
      continue;
    }
    const base = configuration.base;
    const family = base.kind === "recipe" ? world.families.find((row) => row.id === base.recipeId)! : null;
    const rounded = toMicrosHalfUp(cost.perSale);
    result.set(variant.id, {
      status: "computed",
      amountMicros: rounded.micros,
      rounding: rounded.exact ? "none" : "half_up_micros",
      currency: cost.currency,
      taxBasis: cost.taxBasis,
      recipe: family ? { publicId: family.publicId, nameEn: family.nameEn, nameAr: family.nameAr } : null,
      versionNumber: base.kind === "recipe" ? base.versionNumber : null,
    });
  }
  return result;
}

/**
 * What `quantity` sales of a variant with the chosen options use on a
 * business date, what that costs today and the ingredient margin against
 * the configured price. Without options it shows the base usage exactly as
 * QOS-198 did, plus the new fields.
 */
export async function getConfigurationPreview(
  db: DbClient,
  tenantId: string,
  query: PreviewQuery,
  now: Date = new Date(),
): Promise<ConfigurationPreviewView> {
  const soldQuantity = parseSoldQuantity(query.quantity);
  if (query.date !== null && query.date !== "" && !isCalendarDate(query.date)) {
    throw new InventoryError("Enter a date as YYYY-MM-DD.", 400, "effective_from_invalid", "date");
  }
  const requested = parseOptionParams(query.options ?? []);
  const defaults = parseDefaults(query.defaults);
  return withTenantContext(db, tenantId, async (tx) => {
    const variant = await loadVariantByPublicIdInTx(tx, tenantId, query.variantPublicId);
    let channel: { id: string; publicId: string; displayName: string } | null = null;
    if (query.channelPublicId) {
      const [row] = await tx
        .select({ id: salesChannels.id, publicId: salesChannels.publicId, displayName: salesChannels.displayName })
        .from(salesChannels)
        .where(and(eq(salesChannels.tenantId, tenantId), eq(salesChannels.publicId, query.channelPublicId)))
        .limit(1);
      if (!row) {
        throw new InventoryError("Sales channel not found.", 404, "channel_not_found", "channelPublicId");
      }
      channel = row;
    }
    const businessDate = query.date || (await tenantToday(tx, tenantId, now));
    const world = await loadCostWorldInTx(tx, tenantId, [variant.id]);
    const modifiers = await loadModifierWorldInTx(tx, tenantId);
    const [product] = await tx
      .select()
      .from(catalogueProducts)
      .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.id, variant.productId)))
      .limit(1);
    const assignments = (await loadProductModifierGroupsInTx(tx, tenantId, product!)).modifierGroups;
    const optionIdByPublicId = new Map(modifiers.options.map((option) => [option.publicId, option.id]));
    const groups: AssignedGroup[] = assignments.map((assignment) => ({
      status: assignment.status,
      rules: selectionRulesForAssignment(assignment),
      optionIds: new Map(assignment.options.map((option) => [option.publicId, optionIdByPublicId.get(option.publicId)!])),
    }));

    const configuration = applyModifierEffects({
      ...resolutionInput(world, variant, businessDate, soldQuantity),
      effects: world.effects.map((effect) => ({
        id: effect.id,
        recipeVersionId: effect.recipeVersionId,
        modifierOptionId: effect.modifierOptionId,
        effectType: effect.effectType,
        targetLineId: effect.targetLineId,
        itemId: effect.itemId,
        unitId: effect.unitId,
        quantityMicros: effect.quantityMicros,
        status: effect.status,
      })),
      groups,
      selections: requested,
      defaults,
    });

    // Costs and policies.
    const variantPolicies = await loadCurrentCostPoliciesInTx(tx, tenantId, "variant", [variant.id]);
    const selectedOptionIds = configuration.selections.map((selection) => selection.optionId);
    const optionPolicies = await loadCurrentCostPoliciesInTx(tx, tenantId, "modifier_option", selectedOptionIds);
    const cost = costConfiguration({
      configuration,
      soldQuantity,
      units: world.units.map(toGraphUnit),
      items: costItems(world),
      basePolicy: policyInput(variantPolicies.get(variant.id)),
      optionPolicies: new Map(selectedOptionIds.map((id) => [id, policyInput(optionPolicies.get(id))])),
    });

    // Price (read only).
    const [variantRow] = await tx
      .select({ priceTaxBasis: catalogueVariants.priceTaxBasis, taxRateBasisPoints: catalogueVariants.taxRateBasisPoints })
      .from(catalogueVariants)
      .where(and(eq(catalogueVariants.tenantId, tenantId), eq(catalogueVariants.id, variant.id)))
      .limit(1);
    const [central] = await tx
      .select({ amountMinor: catalogueVariantPrices.amountMinor, currency: catalogueVariantPrices.currency })
      .from(catalogueVariantPrices)
      .where(and(eq(catalogueVariantPrices.tenantId, tenantId), eq(catalogueVariantPrices.variantId, variant.id)))
      .limit(1);
    const optionRows = selectedOptionIds.length
      ? await tx
          .select({ id: catalogueModifierOptions.id, priceMinor: catalogueModifierOptions.priceMinor, currency: catalogueModifierOptions.currency })
          .from(catalogueModifierOptions)
          .where(and(eq(catalogueModifierOptions.tenantId, tenantId), inArray(catalogueModifierOptions.id, selectedOptionIds)))
      : [];
    let baseChannel: ChannelPriceOverride | null | undefined;
    const optionChannel = new Map<string, ChannelPriceOverride>();
    if (channel) {
      const [row] = await tx
        .select({ amountMinor: catalogueVariantChannelPrices.amountMinor, currency: catalogueVariantChannelPrices.currency, version: catalogueVariantChannelPrices.version })
        .from(catalogueVariantChannelPrices)
        .where(
          and(
            eq(catalogueVariantChannelPrices.tenantId, tenantId),
            eq(catalogueVariantChannelPrices.variantId, variant.id),
            eq(catalogueVariantChannelPrices.channelId, channel.id),
          ),
        );
      baseChannel = row ?? null;
      if (selectedOptionIds.length) {
        const rows = await tx
          .select({
            optionId: catalogueModifierOptionChannelPrices.modifierOptionId,
            amountMinor: catalogueModifierOptionChannelPrices.amountMinor,
            currency: catalogueModifierOptionChannelPrices.currency,
            version: catalogueModifierOptionChannelPrices.version,
          })
          .from(catalogueModifierOptionChannelPrices)
          .where(
            and(
              eq(catalogueModifierOptionChannelPrices.tenantId, tenantId),
              eq(catalogueModifierOptionChannelPrices.channelId, channel.id),
              inArray(catalogueModifierOptionChannelPrices.modifierOptionId, selectedOptionIds),
            ),
          );
        for (const row of rows) optionChannel.set(row.optionId, row);
      }
    }
    const price = configurationPrice({
      base: central ? { amountMinor: central.amountMinor, currency: central.currency.trim() } : null,
      ...(channel ? { baseChannel } : {}),
      options: configuration.selections.map((selection) => {
        const row = optionRows.find((entry) => entry.id === selection.optionId)!;
        return {
          optionId: selection.optionId,
          priceMinor: row.priceMinor,
          currency: row.currency.trim(),
          quantity: selection.quantity,
          ...(channel ? { channel: optionChannel.get(selection.optionId) ?? null } : {}),
        };
      }),
    });
    const sellingTax = { priceTaxBasis: variantRow?.priceTaxBasis ?? null, taxRateBasisPoints: variantRow?.taxRateBasisPoints ?? null };
    const margin = configurationMargin(price, sellingTax, cost);

    return buildPreviewView({
      tx,
      tenantId,
      variant,
      businessDate,
      soldQuantity,
      world,
      modifiers,
      assignments,
      configuration,
      cost,
      price,
      sellingTax,
      channel,
      margin,
      defaults,
    });
  });
}

type ViewInput = {
  tx: DbClient;
  tenantId: string;
  variant: Awaited<ReturnType<typeof loadVariantByPublicIdInTx>>;
  businessDate: string;
  soldQuantity: number;
  world: CostWorld;
  modifiers: ModifierWorld;
  assignments: Awaited<ReturnType<typeof loadProductModifierGroupsInTx>>["modifierGroups"];
  configuration: ConfigurationResult;
  cost: ConfigurationCost;
  price: ReturnType<typeof configurationPrice>;
  sellingTax: { priceTaxBasis: SellingPriceTaxBasis | null; taxRateBasisPoints: number | null };
  channel: { publicId: string; displayName: string } | null;
  margin: ReturnType<typeof configurationMargin>;
  defaults: "auto" | "none";
};

const majorFromMinor = (minor: number) => microsToMajorString(BigInt(minor) * BigInt(10_000), 2);

async function buildPreviewView(input: ViewInput): Promise<ConfigurationPreviewView> {
  const { world, modifiers, configuration, cost } = input;
  const unitsById = new Map(world.units.map((unit) => [unit.id, unit]));
  const itemsById = new Map(world.items.map((item) => [item.id, item]));
  const linesById = new Map(world.lines.map((line) => [line.id, line]));
  const effectsById = new Map(world.effects.map((effect) => [effect.id, effect]));
  const optionRefById = (optionId: string): PreviewOptionRef => {
    const option = modifiers.options.find((entry) => entry.id === optionId)!;
    const group = modifiers.groups.find((entry) => entry.id === option.groupId)!;
    return {
      publicId: option.publicId,
      nameEn: option.nameEn,
      nameAr: option.nameAr,
      groupPublicId: group.publicId,
      groupNameEn: group.nameEn,
      groupNameAr: group.nameAr,
    };
  };
  const optionRefByPublicId = (publicId: string): PreviewOptionRef => {
    const option = modifiers.options.find((entry) => entry.publicId === publicId);
    return option
      ? optionRefById(option.id)
      : { publicId, nameEn: publicId, nameAr: null, groupPublicId: "", groupNameEn: "", groupNameAr: null };
  };
  const places = (storageUnitId: string | null) => (storageUnitId ? unitsById.get(storageUnitId)?.decimalPlaces ?? 3 : 3);

  // QOS-198 fields: base usage exactly as before.
  const base = configuration.base;
  const names = (await loadVariantRowsInTx(input.tx, input.tenantId)).find((row) => row.id === input.variant.id)!;
  const link = base.linkId ? world.links.find((row) => row.id === base.linkId) ?? null : null;
  const family = link?.recipeId ? world.families.find((row) => row.id === link.recipeId) ?? null : null;
  const resolvedVersion = base.status === "resolved" && base.kind === "recipe" ? world.versions.find((row) => row.id === base.versionId) ?? null : null;
  const usageLines = base.status === "resolved" ? base.lines : base.detail.line ? [base.detail.line] : [];

  const versionEffects = resolvedVersion ? world.effects.filter((effect) => effect.recipeVersionId === resolvedVersion.id) : [];
  const groups: PreviewGroupView[] = input.assignments.map((assignment) => {
    const rules = selectionRulesForAssignment(assignment);
    return {
      publicId: assignment.modifierGroupPublicId,
      nameEn: assignment.translations.en.displayName.trim() || assignment.internalName,
      nameAr: assignment.translations.ar.displayName.trim() || null,
      status: assignment.status,
      minSelections: rules.minSelections,
      maxSelections: rules.maxSelections,
      selectionCountMode: rules.selectionCountMode ?? "distinct_options",
      options: assignment.options.map((option) => {
        const effective = rules.options.find((entry) => entry.publicId === option.publicId)!;
        const optionId = modifiers.options.find((entry) => entry.publicId === option.publicId)?.id;
        return {
          publicId: option.publicId,
          nameEn: option.translations.en.displayName.trim() || option.publicId,
          nameAr: option.translations.ar.displayName.trim() || null,
          status: option.status,
          isDefault: option.isDefault,
          maxQuantity: effective.allowsQuantity ? effective.maxQuantity : 1,
          priceMinor: option.priceMinor,
          currency: option.currency,
          effectCount: versionEffects.filter((effect) => effect.modifierOptionId === optionId).length,
        };
      }),
    };
  });

  const contributionCosts: ContributionCost[] = cost.contributionCosts;
  const contributions: ContributionView[] =
    configuration.status === "resolved"
      ? configuration.contributions.map((contribution, index) => {
          const contributionCost = contributionCosts[index];
          return {
            kind: contribution.kind,
            linePublicId: contribution.lineId ? linesById.get(contribution.lineId)?.publicId ?? null : null,
            effectPublicId: contribution.effectId ? effectsById.get(contribution.effectId)?.publicId ?? null : null,
            option: contribution.optionId ? optionRefById(contribution.optionId) : null,
            item: itemRef(itemsById.get(contribution.itemId)!, unitsById),
            quantity: microsToDecimalString(contribution.quantityMicros),
            unitCode: unitsById.get(contribution.unitId)?.code ?? "",
            multiplier: contribution.multiplier,
            status: contribution.status,
            storageUnitCode: contribution.storageUnitId ? unitsById.get(contribution.storageUnitId)?.code ?? null : null,
            perSale: contribution.perSale ? quantityView(contribution.perSale, places(contribution.storageUnitId)) : null,
            total: contribution.total ? quantityView(contribution.total, places(contribution.storageUnitId)) : null,
            cost: !contributionCost
              ? { status: "unknown" }
              : contributionCost.status === "known"
                ? { status: "known", amount: moneyView(contributionCost.amount), currency: contributionCost.currency, taxBasis: contributionCost.taxBasis }
                : contributionCost,
          };
        })
      : [];

  const componentView = (component: (typeof cost.components)[number]): CostComponentView => ({
    source: component.source,
    option: component.optionId ? optionRefById(component.optionId) : null,
    method: component.method,
    quantity: component.quantity,
    status: component.status,
    amount: component.amount ? moneyView(component.amount) : null,
    currency: component.currency,
    taxBasis: component.taxBasis,
  });
  const costView: ConfigurationCostView =
    cost.status === "known"
      ? {
          status: "known",
          perSale: moneyView(cost.perSale),
          total: moneyView(cost.total),
          currency: cost.currency,
          taxBasis: cost.taxBasis,
          baseMethod: cost.baseMethod,
          components: cost.components.map(componentView),
        }
      : {
          status: "unavailable",
          reason: cost.reason,
          missingCount: cost.missingCount,
          attributionOptions: cost.attributionOptionIds.map(optionRefById),
          baseMethod: cost.baseMethod,
          components: cost.components.map(componentView),
        };

  const channel = input.channel ? { publicId: input.channel.publicId, displayName: input.channel.displayName } : null;
  const priceView: PriceView =
    input.price.status === "available"
      ? {
          status: "available",
          base: majorFromMinor(input.price.baseMinor),
          baseInheritance: input.price.baseInheritance,
          options: majorFromMinor(input.price.optionsMinor),
          total: majorFromMinor(input.price.totalMinor),
          totalMinor: input.price.totalMinor,
          currency: input.price.currency,
          priceTaxBasis: input.sellingTax.priceTaxBasis,
          taxRateBasisPoints: input.sellingTax.taxRateBasisPoints,
          channel,
        }
      : { status: "unavailable", reason: input.price.reason, channel };
  const marginView: MarginView =
    input.margin.status === "available"
      ? {
          status: "available",
          basis: input.margin.basis,
          currency: input.margin.currency,
          price: microsToMajorString(input.margin.priceMicros, 2),
          cost: microsToMajorString(input.margin.costMicros, 2),
          margin: microsToMajorString(input.margin.marginMicros, 2),
          marginMicros: input.margin.marginMicros.toString(),
          marginPercent: input.margin.marginPercent,
          rounding: input.margin.rounding,
        }
      : input.margin;

  const groupName = (publicId: string | null) => {
    if (!publicId) return null;
    const group = modifiers.groups.find((entry) => entry.publicId === publicId);
    return group ? { publicId, nameEn: group.nameEn, nameAr: group.nameAr } : null;
  };

  return {
    variantPublicId: input.variant.publicId,
    productNameEn: names.product.nameEn,
    productNameAr: names.product.nameAr,
    variantNameEn: names.nameEn,
    variantNameAr: names.nameAr,
    businessDate: input.businessDate,
    soldQuantity: input.soldQuantity,
    status: base.status,
    kind: base.status === "resolved" ? base.kind : link?.kind ?? null,
    reason: base.status === "unresolved" ? base.reason : null,
    linkPublicId: link?.publicId ?? null,
    recipe: family ? { publicId: family.publicId, nameEn: family.nameEn, nameAr: family.nameAr } : null,
    version: resolvedVersion
      ? {
          publicId: resolvedVersion.publicId,
          versionNumber: resolvedVersion.versionNumber,
          yieldQuantity: microsToDecimalString(resolvedVersion.yieldQuantityMicros!),
          yieldUnitCode: unitsById.get(resolvedVersion.yieldUnitId!)?.code ?? "",
        }
      : null,
    overlappingVersionNumbers: base.status === "unresolved" ? base.detail.versionNumbers ?? [] : [],
    lines: usageLines.map((usage) => {
      const storage = usage.storageUnitId ? unitsById.get(usage.storageUnitId) ?? null : null;
      return {
        linePublicId: usage.lineId ? linesById.get(usage.lineId)?.publicId ?? null : null,
        item: itemRef(itemsById.get(usage.itemId)!, unitsById),
        quantity: microsToDecimalString(usage.quantityMicros),
        unitCode: unitsById.get(usage.unitId)?.code ?? "",
        status: usage.status,
        prepared: usage.prepared,
        storageUnitCode: storage?.code ?? null,
        perSale: usage.perSale ? quantityView(usage.perSale, storage?.decimalPlaces ?? 3) : null,
        total: usage.total ? quantityView(usage.total, storage?.decimalPlaces ?? 3) : null,
      };
    }),
    complete: base.status === "resolved" && base.complete,
    defaults: input.defaults,
    defaultsApplied: configuration.defaultsApplied,
    configurationStatus: configuration.status,
    groups,
    selections: configuration.selections.map((selection) => ({
      option: optionRefById(selection.optionId),
      quantity: selection.quantity,
      source: selection.source,
      priceMinor: selection.priceMinor,
    })),
    rejections: configuration.rejections.map((rejection) => ({
      code: rejection.code,
      options: rejection.optionPublicIds.map(optionRefByPublicId),
      group: groupName(rejection.groupPublicId),
      item: rejection.itemId ? itemRef(itemsById.get(rejection.itemId)!, unitsById) : null,
      linePublicId: rejection.lineId ? linesById.get(rejection.lineId)?.publicId ?? null : null,
    })),
    contributions,
    perItem:
      configuration.status === "resolved"
        ? configuration.perItem.map((entry) => ({
            item: itemRef(itemsById.get(entry.itemId)!, unitsById),
            storageUnitCode: entry.storageUnitId ? unitsById.get(entry.storageUnitId)?.code ?? null : null,
            perSale: entry.perSale ? quantityView(entry.perSale, places(entry.storageUnitId)) : null,
            total: entry.total ? quantityView(entry.total, places(entry.storageUnitId)) : null,
          }))
        : [],
    configurationComplete: configuration.status === "resolved" && configuration.complete,
    cost: costView,
    batchCost: resolvedVersion ? versionBatchCost(world, resolvedVersion.id) : null,
    price: priceView,
    margin: marginView,
  };
}

