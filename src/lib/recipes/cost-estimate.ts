import { buildItemGraph, findPath, type GraphRule, type GraphUnit } from "@/lib/inventory/conversion-graph";
import type { CostTaxBasis } from "@/lib/inventory/cost-completeness";
import { fromMicros, inverse, mul, rational, type Rational } from "@/lib/inventory/quantity-math";

/* QOS-198 current recipe cost estimate. Pure. Uses the QOS-197 current
   reference cost of each line item and that item's current conversion rules:
   a line costs quantity (in the line unit) converted to the cost unit ×
   amount. Any line whose item has no current cost, or whose unit cannot be
   converted to the cost unit, makes the total unavailable with a count of
   such lines. Unknown is never zero. No price, margin or modifier effect is
   computed here (those belong to QOS-199), and nothing is a posted snapshot:
   these are current reference estimates. */

export type CostLineInput = { lineId: string; itemId: string; unitId: string; quantityMicros: bigint };

export type CostItemInput = {
  itemId: string;
  /** The item's current reference cost, or null when it has none. */
  cost: { unitId: string; amountMicros: bigint; currency: string; taxBasis: CostTaxBasis } | null;
  /** The item's current conversion rules. */
  rules: readonly GraphRule[];
};

export type LineCostEstimate =
  | { lineId: string; status: "known"; amount: Rational; currency: string; taxBasis: CostTaxBasis }
  | { lineId: string; status: "unknown" | "not_convertible" };

export type RecipeTaxBasis = CostTaxBasis | "mixed";

export type RecipeCostTotal =
  | {
      status: "known";
      perBatch: Rational;
      /** perBatch ÷ yield; null when the version has no yield yet. */
      perYieldUnit: Rational | null;
      currency: string;
      taxBasis: RecipeTaxBasis;
    }
  | { status: "unavailable"; linesWithoutCost: number }
  | { status: "no_lines" };

export type RecipeCostEstimate = { lines: LineCostEstimate[]; total: RecipeCostTotal };

export function estimateRecipeCost(input: {
  lines: readonly CostLineInput[];
  yieldQuantityMicros: bigint | null;
  units: readonly GraphUnit[];
  items: readonly CostItemInput[];
}): RecipeCostEstimate {
  const itemsById = new Map(input.items.map((item) => [item.itemId, item]));
  const lines: LineCostEstimate[] = input.lines.map((line) => {
    const item = itemsById.get(line.itemId);
    if (!item?.cost) {
      return { lineId: line.lineId, status: "unknown" };
    }
    const path = findPath(buildItemGraph(input.units, item.rules), line.unitId, item.cost.unitId);
    if (!path) {
      return { lineId: line.lineId, status: "not_convertible" };
    }
    // 1 line unit = factor cost units, so the line costs quantity × factor × amount.
    const amount = mul(mul(fromMicros(line.quantityMicros), path.factor), fromMicros(item.cost.amountMicros));
    return {
      lineId: line.lineId,
      status: "known",
      amount,
      currency: item.cost.currency,
      taxBasis: item.cost.taxBasis,
    };
  });

  if (lines.length === 0) {
    return { lines, total: { status: "no_lines" } };
  }
  const known = lines.filter((line): line is Extract<LineCostEstimate, { status: "known" }> => line.status === "known");
  if (known.length !== lines.length) {
    return { lines, total: { status: "unavailable", linesWithoutCost: lines.length - known.length } };
  }
  const currencies = new Set(known.map((line) => line.currency));
  if (currencies.size !== 1) {
    // One tenant has one base currency; a mixture is never added up.
    return { lines, total: { status: "unavailable", linesWithoutCost: 0 } };
  }
  const perBatch = known.reduce(
    (sum, line) =>
      rational(
        sum.numerator * line.amount.denominator + line.amount.numerator * sum.denominator,
        sum.denominator * line.amount.denominator,
      ),
    rational(BigInt(0)),
  );
  const bases = new Set(known.map((line) => line.taxBasis));
  return {
    lines,
    total: {
      status: "known",
      perBatch,
      perYieldUnit: input.yieldQuantityMicros ? mul(perBatch, inverse(fromMicros(input.yieldQuantityMicros))) : null,
      currency: known[0]!.currency,
      taxBasis: bases.size === 1 ? known[0]!.taxBasis : "mixed",
    },
  };
}
