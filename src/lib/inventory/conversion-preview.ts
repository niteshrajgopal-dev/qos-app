import { buildItemGraph, findPath, type GraphRule, type GraphUnit } from "@/lib/inventory/conversion-graph";
import {
  inverse,
  isExactAt,
  mul,
  rational,
  type Rational,
  toDecimalString,
  toExactDecimalString,
} from "@/lib/inventory/quantity-math";
import { type StaffLocale, staffCopyWith, staffUiCopy } from "@/lib/staff/locale";

/* QOS-195 conversion preview. Pure: explains how an item's storage, recipe
   and purchase quantities relate, using only that item's current rules and
   the standard table.

   Rounding (D5 assumption): exact rationals are rounded half-up for display
   only. Quantities (the receipt and recipe examples) are shown to the target
   unit's decimal places, because that is the precision quantities in that
   unit are entered and shown with. A factor is a ratio, not a quantity, so
   its line shows the exact value when it terminates within 6 places and is
   otherwise rounded to the target unit's places (at least 3). Whenever a
   shown value is rounded, `rounded` is set and the UI says so; the stored
   factor stays exact. */

export const RECEIPT_SAMPLE_QUANTITY = BigInt(2);
export const RECIPE_SAMPLE_QUANTITY = BigInt(30);
const MIN_FACTOR_PLACES = 3;
const EXACT_FACTOR_PLACES = 6;

export type PreviewUnit = GraphUnit & {
  publicId: string;
  nameEn: string;
  nameAr: string;
  decimalPlaces: number;
};

export type PreviewPairKey = "storage_recipe" | "purchase_storage" | "purchase_recipe";

export type PreviewMissingReason =
  | "not_designated"
  | "unit_archived"
  | "mass_volume_needs_item_rule"
  | "pack_needs_item_rule"
  | "no_rule";

export type PreviewValue = { text: string; places: number; rounded: boolean };

export type PreviewDerived = {
  status: "derived";
  /** Exact factor as a fraction (1 from = numerator / denominator to). */
  factor: { numerator: string; denominator: string };
  forward: PreviewValue;
  inverse: PreviewValue;
  path: Array<{ fromCode: string; toCode: string; source: "item_rule" | "standard" }>;
  example:
    | { kind: "receipt"; quantity: string; result: PreviewValue }
    | { kind: "recipe"; quantity: string; result: PreviewValue }
    | null;
};

export type PreviewPair = {
  key: PreviewPairKey;
  from: { publicId: string; code: string } | null;
  to: { publicId: string; code: string } | null;
  result: PreviewDerived | { status: "missing"; reason: PreviewMissingReason };
};

export type ItemQuantityPreview = {
  status: "complete" | "incomplete" | "none";
  pairs: PreviewPair[];
};

export type ExplainItemQuantitiesInput = {
  storageUnitId: string | null;
  recipeUnitId: string | null;
  purchaseUnitId: string | null;
  units: readonly PreviewUnit[];
  rules: readonly GraphRule[];
};

function factorValue(value: Rational, target: PreviewUnit): PreviewValue {
  const exact = toExactDecimalString(value, EXACT_FACTOR_PLACES);
  if (exact !== null) {
    return { text: exact, places: EXACT_FACTOR_PLACES, rounded: false };
  }
  const places = Math.max(target.decimalPlaces, MIN_FACTOR_PLACES);
  return { text: toDecimalString(value, places), places, rounded: true };
}

function quantityValue(value: Rational, target: PreviewUnit): PreviewValue {
  const places = target.decimalPlaces;
  return { text: toDecimalString(value, places), places, rounded: !isExactAt(value, places) };
}

/** Why two active units of one item have no derivation. Shared with the QOS-197 cost explanation. */
export function unreachableReason(
  from: Pick<GraphUnit, "quantityKind">,
  to: Pick<GraphUnit, "quantityKind">,
): Extract<PreviewMissingReason, "mass_volume_needs_item_rule" | "pack_needs_item_rule" | "no_rule"> {
  const kinds = new Set([from.quantityKind, to.quantityKind]);
  if (kinds.has("mass") && kinds.has("volume")) {
    return "mass_volume_needs_item_rule";
  }
  if (kinds.has("pack")) {
    return "pack_needs_item_rule";
  }
  return "no_rule";
}

function explainPair(
  key: PreviewPairKey,
  fromId: string | null,
  toId: string | null,
  units: ReadonlyMap<string, PreviewUnit>,
  graph: ReturnType<typeof buildItemGraph>,
): PreviewPair {
  const from = fromId ? units.get(fromId) ?? null : null;
  const to = toId ? units.get(toId) ?? null : null;
  const ref = (unit: PreviewUnit | null) => (unit ? { publicId: unit.publicId, code: unit.code } : null);
  const missing = (reason: PreviewMissingReason): PreviewPair => ({
    key,
    from: ref(from),
    to: ref(to),
    result: { status: "missing", reason },
  });

  if (!from || !to) {
    return missing("not_designated");
  }
  if (from.status !== "active" || to.status !== "active") {
    return missing("unit_archived");
  }
  const path = findPath(graph, from.id, to.id);
  if (!path) {
    return missing(unreachableReason(from, to));
  }

  let example: PreviewDerived["example"] = null;
  if (key === "purchase_storage") {
    example = {
      kind: "receipt",
      quantity: RECEIPT_SAMPLE_QUANTITY.toString(),
      result: quantityValue(mul(rational(RECEIPT_SAMPLE_QUANTITY), path.factor), to),
    };
  } else if (key === "storage_recipe") {
    example = {
      kind: "recipe",
      quantity: RECIPE_SAMPLE_QUANTITY.toString(),
      result: quantityValue(mul(rational(RECIPE_SAMPLE_QUANTITY), inverse(path.factor)), from),
    };
  }

  return {
    key,
    from: ref(from),
    to: ref(to),
    result: {
      status: "derived",
      factor: { numerator: path.factor.numerator.toString(), denominator: path.factor.denominator.toString() },
      forward: factorValue(path.factor, to),
      inverse: factorValue(inverse(path.factor), from),
      path: path.hops.map((hop) => ({ fromCode: hop.fromCode, toCode: hop.toCode, source: hop.source })),
      example,
    },
  };
}

/** Explains storage ↔ recipe, purchase ↔ storage and purchase ↔ recipe for one item. */
export function explainItemQuantities(input: ExplainItemQuantitiesInput): ItemQuantityPreview {
  const units = new Map(input.units.map((unit) => [unit.id, unit]));
  const graph = buildItemGraph(input.units, input.rules);
  const pairs = [
    explainPair("storage_recipe", input.storageUnitId, input.recipeUnitId, units, graph),
    explainPair("purchase_storage", input.purchaseUnitId, input.storageUnitId, units, graph),
    explainPair("purchase_recipe", input.purchaseUnitId, input.recipeUnitId, units, graph),
  ];
  const designated = pairs.filter(
    (pair) => !(pair.result.status === "missing" && pair.result.reason === "not_designated"),
  );
  const status =
    designated.length === 0
      ? "none"
      : designated.every((pair) => pair.result.status === "derived")
        ? "complete"
        : "incomplete";
  return { status, pairs };
}

// ---------------------------------------------------------------------------
// Sentences

export type PreviewSentences = {
  forward: string;
  inverse: string;
  example: string | null;
  rounding: string[];
};

/**
 * Locale sentences for one derived pair, for example "1 packet = 12 piece",
 * "1 piece = 0.083 packet" and "A receipt of 2 packet adds 24 piece to
 * stock." `wrap` lets the UI isolate numbers and codes for RTL.
 */
export function previewSentences(
  locale: StaffLocale,
  pair: PreviewPair,
  wrap: (text: string) => string = (text) => text,
): PreviewSentences | null {
  if (pair.result.status !== "derived" || !pair.from || !pair.to) {
    return null;
  }
  const { forward, inverse: back, example } = pair.result;
  const from = wrap(pair.from.code);
  const to = wrap(pair.to.code);
  const line = (fromCode: string, value: PreviewValue, toCode: string) =>
    staffCopyWith(locale, "previewLine", { from: fromCode, factor: wrap(value.text), to: toCode });
  const rounding = [forward, back, ...(example ? [example.result] : [])]
    .filter((value) => value.rounded)
    .map((value) => staffCopyWith(locale, "previewRounded", { dp: wrap(String(value.places)) }));

  let exampleText: string | null = null;
  if (example?.kind === "receipt") {
    exampleText = staffCopyWith(locale, "previewReceiptExample", {
      qty: wrap(example.quantity),
      purchase: from,
      result: wrap(example.result.text),
      storage: to,
    });
  } else if (example?.kind === "recipe") {
    exampleText = staffCopyWith(locale, "previewRecipeExample", {
      qty: wrap(example.quantity),
      recipe: to,
      result: wrap(example.result.text),
      storage: from,
    });
  }

  return {
    forward: line(from, forward, to),
    inverse: line(to, back, from),
    example: exampleText,
    rounding: [...new Set(rounding)],
  };
}

const MISSING_COPY = {
  not_designated: "previewMissingDesignation",
  unit_archived: "previewMissingArchived",
  mass_volume_needs_item_rule: "previewMissingMassVolume",
  pack_needs_item_rule: "previewMissingPack",
  no_rule: "previewMissingNoRule",
} as const;

export function previewMissingText(locale: StaffLocale, reason: PreviewMissingReason): string {
  return staffUiCopy(locale, MISSING_COPY[reason]);
}
