import { buildItemGraph, findPath, type GraphRule } from "@/lib/inventory/conversion-graph";
import { type PreviewMissingReason, type PreviewUnit, unreachableReason } from "@/lib/inventory/conversion-preview";
import {
  fromMicros,
  inverse,
  microsToDecimalString,
  mul,
  type Rational,
  toDecimalString,
  toExactDecimalString,
} from "@/lib/inventory/quantity-math";

/* QOS-197 cost completeness. Pure: explains an item's current reference cost
   and what it means per storage unit and per recipe unit, using only that
   item's current conversion rules and the standard table (QOS-195).

   Unknown is a state, not a number: an item with no current cost row is
   `{ status: "unknown" }` and carries no amount at all, so nothing can read
   it as zero. A known zero is a stored explicit 0 and stays "0" everywhere.
   Derived per-unit values are exact rationals; they are rounded half-up to
   6 decimal places only when they do not terminate, and say so. Nothing here
   compares a cost with a price: there are no recipes or selling prices in
   inventory, so no ratio of cost to price is ever produced. */

export const COST_PLACES = 6;

export type CostTaxBasis = "net" | "gross" | "unconfirmed";
export type CostSource = "manual" | "supplier_quote" | "invoice";

export type CostUnitRef = { publicId: string; code: string };

export type CostPerUnit =
  | {
      status: "derived";
      unit: CostUnitRef;
      /** Cost of 1 target unit, exact or rounded to `places`. */
      text: string;
      rounded: boolean;
      places: number;
      path: Array<{ fromCode: string; toCode: string; source: "item_rule" | "standard" }>;
    }
  | { status: "missing"; unit: CostUnitRef | null; reason: PreviewMissingReason };

export type KnownItemCost = {
  status: "known" | "known_not_convertible";
  costPublicId: string;
  /** Exact decimal text of the stored amount, for 1 `unit`. */
  amount: string;
  amountMicros: string;
  currency: string;
  taxBasis: CostTaxBasis;
  source: CostSource;
  sourceReference: string | null;
  effectiveFrom: string;
  revision: number;
  unit: CostUnitRef;
  perStorageUnit: CostPerUnit;
  perRecipeUnit: CostPerUnit;
};

export type ItemCostExplanation = { status: "unknown" } | KnownItemCost;
export type ItemCostStatus = ItemCostExplanation["status"];

export type CurrentCostInput = {
  publicId: string;
  unitId: string;
  amountMicros: bigint;
  currency: string;
  taxBasis: CostTaxBasis;
  source: CostSource;
  sourceReference: string | null;
  effectiveFrom: string;
  revision: number;
};

export type ExplainItemCostInput = {
  storageUnitId: string | null;
  recipeUnitId: string | null;
  units: readonly PreviewUnit[];
  rules: readonly GraphRule[];
  /** The item's current cost row, or null when it has none. */
  cost: CurrentCostInput | null;
};

function perUnitValue(value: Rational) {
  const exact = toExactDecimalString(value, COST_PLACES);
  if (exact !== null) {
    const fraction = exact.split(".")[1] ?? "";
    return { text: exact, rounded: false, places: fraction.length };
  }
  return { text: toDecimalString(value, COST_PLACES), rounded: true, places: COST_PLACES };
}

function explainPerUnit(
  amount: Rational,
  costUnit: PreviewUnit,
  targetId: string | null,
  units: ReadonlyMap<string, PreviewUnit>,
  graph: ReturnType<typeof buildItemGraph>,
): CostPerUnit {
  const target = targetId ? units.get(targetId) : undefined;
  const ref = target ? { publicId: target.publicId, code: target.code } : null;
  if (!target) {
    return { status: "missing", unit: ref, reason: "not_designated" };
  }
  if (target.status !== "active" || costUnit.status !== "active") {
    return { status: "missing", unit: ref, reason: "unit_archived" };
  }
  const path = findPath(graph, costUnit.id, target.id);
  if (!path) {
    return { status: "missing", unit: ref, reason: unreachableReason(costUnit, target) };
  }
  // 1 cost unit = factor target units, so 1 target unit costs amount / factor.
  return {
    status: "derived",
    unit: ref!,
    ...perUnitValue(mul(amount, inverse(path.factor))),
    path: path.hops.map((hop) => ({ fromCode: hop.fromCode, toCode: hop.toCode, source: hop.source })),
  };
}

/** Explains one item's current reference cost. Never turns a missing cost into a number. */
export function explainItemCost(input: ExplainItemCostInput): ItemCostExplanation {
  const { cost } = input;
  if (!cost) {
    return { status: "unknown" };
  }
  const units = new Map(input.units.map((unit) => [unit.id, unit]));
  const graph = buildItemGraph(input.units, input.rules);
  const costUnit = units.get(cost.unitId);
  if (!costUnit) {
    throw new Error("The cost row's unit must be among the units passed in.");
  }
  const amount = fromMicros(cost.amountMicros);
  const perStorageUnit = explainPerUnit(amount, costUnit, input.storageUnitId, units, graph);
  const perRecipeUnit = explainPerUnit(amount, costUnit, input.recipeUnitId, units, graph);
  const convertible = [perStorageUnit, perRecipeUnit].every(
    (value) => value.status === "derived" || value.reason === "not_designated",
  );
  return {
    status: convertible ? "known" : "known_not_convertible",
    costPublicId: cost.publicId,
    amount: microsToDecimalString(cost.amountMicros),
    amountMicros: cost.amountMicros.toString(),
    currency: cost.currency,
    taxBasis: cost.taxBasis,
    source: cost.source,
    sourceReference: cost.sourceReference,
    effectiveFrom: cost.effectiveFrom,
    revision: cost.revision,
    unit: { publicId: costUnit.publicId, code: costUnit.code },
    perStorageUnit,
    perRecipeUnit,
  };
}
