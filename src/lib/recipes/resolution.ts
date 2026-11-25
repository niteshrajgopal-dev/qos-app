import { buildItemGraph, findPath, type GraphUnit } from "@/lib/inventory/conversion-graph";
import { fromMicros, inverse, mul, rational, type Rational } from "@/lib/inventory/quantity-math";
import { isLiveOn } from "@/lib/recipes/dates";

/* QOS-198 consumption resolution. Pure and read-only: given a sold variant,
   its links, the linked recipe family with its versions, the items, units and
   item conversion rules, it says what one sale (or `soldQuantity` sales) of
   the variant uses on a business date. Nothing here writes or posts.

   Rules:
   - Exactly one link may be live on the date; none is `no_link`, more than one
     is `overlapping_links` (never silently picked).
   - A recipe link resolves to exactly one approved version live on the date.
     Drafts and discarded versions are never candidates. Two or more live
     approved versions is `overlapping_versions`, listing their numbers.
   - Line quantities describe the whole stated yield. One sale uses one yield
     unit, so per-sale usage is line quantity ÷ yield, as an exact rational,
     converted from the line unit to the item's storage unit through that
     item's conversion rules live on the date and the standard table. A line
     with no path is `missing_conversion` and carries no number.
   - A prepared item on a line is consumed as the prepared item itself in its
     storage unit; its own recipe is guidance and costing only and is never
     exploded here. */

export type ResolutionUnit = GraphUnit;

export type ResolutionRule = {
  id: string;
  itemId: string;
  fromUnitId: string;
  toUnitId: string;
  factorMicros: bigint;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type ResolutionItem = {
  id: string;
  status: "active" | "archived";
  kind: "purchased" | "prepared";
  storageUnitId: string | null;
};

export type ResolutionLine = {
  id: string;
  itemId: string;
  unitId: string;
  quantityMicros: bigint;
  status: "active" | "removed";
};

export type ResolutionVersion = {
  id: string;
  versionNumber: number;
  status: "draft" | "approved" | "discarded";
  effectiveFrom: string | null;
  effectiveTo: string | null;
  yieldQuantityMicros: bigint | null;
  yieldUnitId: string | null;
  lines: readonly ResolutionLine[];
};

export type ResolutionRecipe = {
  id: string;
  kind: "sellable" | "prepared";
  status: "active" | "archived";
  versions: readonly ResolutionVersion[];
};

export type ResolutionLink = {
  id: string;
  kind: "recipe" | "direct_stock";
  recipeId: string | null;
  itemId: string | null;
  quantityMicros: bigint | null;
  unitId: string | null;
  effectiveFrom: string;
  effectiveTo: string | null;
};

export type ResolutionInput = {
  businessDate: string;
  /** Positive whole number of sales. */
  soldQuantity: number;
  variant: {
    status: "draft" | "active" | "archived";
    productStatus: "draft" | "active" | "archived";
    sellingQuantityBasis: string | null;
  };
  links: readonly ResolutionLink[];
  recipes: readonly ResolutionRecipe[];
  items: readonly ResolutionItem[];
  units: readonly ResolutionUnit[];
  rules: readonly ResolutionRule[];
};

export type LineUsageStatus = "ok" | "missing_conversion" | "item_archived" | "storage_unit_missing";

export type LineUsage = {
  lineId: string | null;
  itemId: string;
  unitId: string;
  quantityMicros: bigint;
  status: LineUsageStatus;
  storageUnitId: string | null;
  /** Usage of one sale in the item's storage unit; null unless status is ok. */
  perSale: Rational | null;
  /** perSale × soldQuantity; null unless status is ok. */
  total: Rational | null;
  /** True for a prepared item, consumed as itself and never exploded. */
  prepared: boolean;
};

export type UnresolvedReason =
  | "variant_archived"
  | "weight_basis_unsupported"
  | "no_link"
  | "overlapping_links"
  | "recipe_archived"
  | "recipe_not_sellable"
  | "draft_only"
  | "no_approved_version"
  | "overlapping_versions"
  | "yield_missing"
  | "no_lines"
  | "item_archived"
  | "missing_conversion"
  | "storage_unit_missing";

export type ConsumptionResolution =
  | {
      status: "resolved";
      kind: "recipe";
      linkId: string;
      recipeId: string;
      versionId: string;
      versionNumber: number;
      lines: LineUsage[];
      /** False when any line could not be converted; such lines carry no quantity. */
      complete: boolean;
    }
  | { status: "resolved"; kind: "direct_stock"; linkId: string; lines: [LineUsage]; complete: true }
  | {
      status: "unresolved";
      reason: UnresolvedReason;
      linkId: string | null;
      detail: { versionNumbers?: number[]; linkIds?: string[]; line?: LineUsage };
    };

function unresolved(
  reason: UnresolvedReason,
  linkId: string | null = null,
  detail: { versionNumbers?: number[]; linkIds?: string[]; line?: LineUsage } = {},
): ConsumptionResolution {
  return { status: "unresolved", reason, linkId, detail };
}

/**
 * Converts `perYieldUnit` (in the line unit) to the item's storage unit for
 * one sale and for `soldQuantity` sales. Never guesses: no path, an archived
 * item or no storage unit gives a status and no number.
 */
export function lineUsage(
  input: Pick<ResolutionInput, "businessDate" | "items" | "units" | "rules">,
  line: { lineId: string | null; itemId: string; unitId: string; quantityMicros: bigint },
  perSaleInLineUnit: Rational,
  soldQuantity: number,
): LineUsage {
  const item = input.items.find((candidate) => candidate.id === line.itemId);
  const base = {
    lineId: line.lineId,
    itemId: line.itemId,
    unitId: line.unitId,
    quantityMicros: line.quantityMicros,
    storageUnitId: item?.storageUnitId ?? null,
    prepared: item?.kind === "prepared",
    perSale: null,
    total: null,
  };
  if (!item || item.status !== "active") {
    return { ...base, status: "item_archived" };
  }
  if (!item.storageUnitId) {
    return { ...base, status: "storage_unit_missing" };
  }
  const rules = input.rules
    .filter((rule) => rule.itemId === item.id && isLiveOn(rule.effectiveFrom, rule.effectiveTo, input.businessDate))
    .map((rule) => ({ id: rule.id, fromUnitId: rule.fromUnitId, toUnitId: rule.toUnitId, factorMicros: rule.factorMicros }));
  const path = findPath(buildItemGraph(input.units, rules), line.unitId, item.storageUnitId);
  if (!path) {
    return { ...base, status: "missing_conversion" };
  }
  const perSale = mul(perSaleInLineUnit, path.factor);
  return { ...base, status: "ok", perSale, total: mul(perSale, rational(BigInt(soldQuantity))) };
}

/** Resolves what `soldQuantity` sales of the variant use on `businessDate`. */
export function resolveConsumption(input: ResolutionInput): ConsumptionResolution {
  if (!Number.isInteger(input.soldQuantity) || input.soldQuantity < 1) {
    throw new Error("soldQuantity must be a positive whole number.");
  }
  if (input.variant.status === "archived" || input.variant.productStatus === "archived") {
    return unresolved("variant_archived");
  }
  if (input.variant.sellingQuantityBasis === "weight") {
    // Checkout sells whole units only; weight-sold variants are not resolved.
    return unresolved("weight_basis_unsupported");
  }

  const live = input.links.filter((link) => isLiveOn(link.effectiveFrom, link.effectiveTo, input.businessDate));
  if (live.length === 0) {
    return unresolved("no_link");
  }
  if (live.length > 1) {
    return unresolved("overlapping_links", null, { linkIds: live.map((link) => link.id) });
  }
  const link = live[0]!;

  if (link.kind === "direct_stock") {
    const usage = lineUsage(
      input,
      { lineId: null, itemId: link.itemId!, unitId: link.unitId!, quantityMicros: link.quantityMicros! },
      fromMicros(link.quantityMicros!),
      input.soldQuantity,
    );
    if (usage.status !== "ok") {
      return unresolved(usage.status, link.id, { line: usage });
    }
    return { status: "resolved", kind: "direct_stock", linkId: link.id, lines: [usage], complete: true };
  }

  const recipe = input.recipes.find((candidate) => candidate.id === link.recipeId);
  if (!recipe || recipe.status !== "active") {
    return unresolved("recipe_archived", link.id);
  }
  if (recipe.kind !== "sellable") {
    return unresolved("recipe_not_sellable", link.id);
  }
  const candidates = recipe.versions.filter(
    (version) => version.status === "approved" && isLiveOn(version.effectiveFrom, version.effectiveTo, input.businessDate),
  );
  if (candidates.length === 0) {
    const approvedExists = recipe.versions.some((version) => version.status === "approved");
    const draftExists = recipe.versions.some((version) => version.status === "draft");
    return unresolved(!approvedExists && draftExists ? "draft_only" : "no_approved_version", link.id);
  }
  if (candidates.length > 1) {
    return unresolved("overlapping_versions", link.id, {
      versionNumbers: candidates.map((version) => version.versionNumber).sort((a, b) => a - b),
    });
  }
  const version = candidates[0]!;
  if (version.yieldQuantityMicros === null || version.yieldUnitId === null) {
    return unresolved("yield_missing", link.id, { versionNumbers: [version.versionNumber] });
  }
  const activeLines = version.lines.filter((line) => line.status === "active");
  if (activeLines.length === 0) {
    return unresolved("no_lines", link.id, { versionNumbers: [version.versionNumber] });
  }
  const perYieldUnit = inverse(fromMicros(version.yieldQuantityMicros));
  const lines = activeLines.map((line) =>
    lineUsage(
      input,
      { lineId: line.id, itemId: line.itemId, unitId: line.unitId, quantityMicros: line.quantityMicros },
      mul(fromMicros(line.quantityMicros), perYieldUnit),
      input.soldQuantity,
    ),
  );
  return {
    status: "resolved",
    kind: "recipe",
    linkId: link.id,
    recipeId: recipe.id,
    versionId: version.id,
    versionNumber: version.versionNumber,
    lines,
    complete: lines.every((line) => line.status === "ok"),
  };
}
