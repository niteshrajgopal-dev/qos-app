import { describe, expect, it } from "vitest";

import type { GraphRule } from "@/lib/inventory/conversion-graph";
import {
  explainItemQuantities,
  previewMissingText,
  previewSentences,
  type PreviewPair,
} from "@/lib/inventory/conversion-preview";
import { micros, unit } from "@/lib/inventory/test-units";

const kg = unit("kg", "mass", { standard: true, decimalPlaces: 3 });
const g = unit("g", "mass", { standard: true });
const ml = unit("ml", "volume", { standard: true });
const piece = unit("piece", "count", { standard: true });
const packet = unit("packet", "pack", { decimalPlaces: 3 });
const batch = unit("batch", "pack", { decimalPlaces: 2 });
const jug = unit("jug", "volume", { status: "archived" });
const UNITS = [kg, g, ml, piece, packet, batch, jug];

const rule = (from: { id: string }, to: { id: string }, factor: string): GraphRule => ({
  id: `${from.id}-${to.id}`,
  fromUnitId: from.id,
  toUnitId: to.id,
  factorMicros: micros(factor),
});

function pair(preview: ReturnType<typeof explainItemQuantities>, key: PreviewPair["key"]) {
  return preview.pairs.find((entry) => entry.key === key)!;
}

describe("explainItemQuantities", () => {
  it("explains a packet of 12 pieces with the inverse rounded to the unit's places", () => {
    const preview = explainItemQuantities({
      storageUnitId: piece.id,
      recipeUnitId: piece.id,
      purchaseUnitId: packet.id,
      units: UNITS,
      rules: [rule(packet, piece, "12")],
    });
    expect(preview.status).toBe("complete");
    const purchase = pair(preview, "purchase_storage");
    const sentences = previewSentences("en", purchase)!;
    expect(sentences.forward).toBe("1 packet = 12 piece");
    expect(sentences.inverse).toBe("1 piece = 0.083 packet");
    expect(sentences.rounding).toEqual(["Shown to 3 decimal places; the stored factor is exact."]);
    expect(sentences.example).toBe("A receipt of 2 packet adds 24 piece to stock.");
    expect(purchase.result).toMatchObject({
      status: "derived",
      factor: { numerator: "12", denominator: "1" },
      path: [{ fromCode: "packet", toCode: "piece", source: "item_rule" }],
    });
  });

  it("explains coffee beans: kg storage, g recipe, packet purchase with packet → kg", () => {
    const preview = explainItemQuantities({
      storageUnitId: kg.id,
      recipeUnitId: g.id,
      purchaseUnitId: packet.id,
      units: UNITS,
      rules: [rule(packet, kg, "0.25")],
    });
    expect(preview.status).toBe("complete");
    const storageRecipe = previewSentences("en", pair(preview, "storage_recipe"))!;
    expect(storageRecipe.forward).toBe("1 kg = 1000 g");
    expect(storageRecipe.inverse).toBe("1 g = 0.001 kg");
    expect(storageRecipe.example).toBe("A recipe line of 30 g uses 0.030 kg of stock.");
    expect(storageRecipe.rounding).toEqual([]);
    expect(previewSentences("en", pair(preview, "purchase_storage"))!.example).toBe(
      "A receipt of 2 packet adds 0.500 kg to stock.",
    );
    const purchaseRecipe = pair(preview, "purchase_recipe");
    expect(previewSentences("en", purchaseRecipe)!.forward).toBe("1 packet = 250 g");
    expect(purchaseRecipe.result).toMatchObject({
      path: [
        { fromCode: "packet", toCode: "kg", source: "item_rule" },
        { fromCode: "kg", toCode: "g", source: "standard" },
      ],
    });
  });

  it("rounds example quantities half-up to the storage unit's places and says so", () => {
    const preview = explainItemQuantities({
      storageUnitId: batch.id,
      recipeUnitId: piece.id,
      purchaseUnitId: null,
      units: UNITS,
      rules: [rule(batch, piece, "70")],
    });
    const sentences = previewSentences("en", pair(preview, "storage_recipe"))!;
    // 30 / 70 = 0.428571… → 0.43 at 2 places.
    expect(sentences.example).toBe("A recipe line of 30 piece uses 0.43 batch of stock.");
    expect(sentences.inverse).toBe("1 piece = 0.014 batch");
    expect(sentences.rounding).toEqual([
      "Shown to 3 decimal places; the stored factor is exact.",
      "Shown to 2 decimal places; the stored factor is exact.",
    ]);
  });

  it("reports every missing reason", () => {
    const missing = (storage: string | null, recipe: string | null, rules: GraphRule[] = []) =>
      pair(
        explainItemQuantities({ storageUnitId: storage, recipeUnitId: recipe, purchaseUnitId: null, units: UNITS, rules }),
        "storage_recipe",
      ).result;
    expect(missing(g.id, ml.id)).toEqual({ status: "missing", reason: "mass_volume_needs_item_rule" });
    expect(missing(batch.id, piece.id)).toEqual({ status: "missing", reason: "pack_needs_item_rule" });
    expect(missing(kg.id, piece.id)).toEqual({ status: "missing", reason: "no_rule" });
    expect(missing(jug.id, ml.id)).toEqual({ status: "missing", reason: "unit_archived" });
    expect(missing(kg.id, null)).toEqual({ status: "missing", reason: "not_designated" });
    // An explicit item rule is the only way mass and volume relate.
    expect(missing(g.id, ml.id, [rule(g, ml, "1.05")]).status).toBe("derived");
  });

  it("reports none, incomplete and complete overall", () => {
    const base = { units: UNITS, rules: [] as GraphRule[] };
    expect(explainItemQuantities({ ...base, storageUnitId: null, recipeUnitId: null, purchaseUnitId: null }).status).toBe(
      "none",
    );
    expect(explainItemQuantities({ ...base, storageUnitId: kg.id, recipeUnitId: null, purchaseUnitId: null }).status).toBe(
      "none",
    );
    expect(explainItemQuantities({ ...base, storageUnitId: kg.id, recipeUnitId: g.id, purchaseUnitId: null }).status).toBe(
      "complete",
    );
    expect(
      explainItemQuantities({ ...base, storageUnitId: kg.id, recipeUnitId: g.id, purchaseUnitId: packet.id }).status,
    ).toBe("incomplete");
  });

  it("builds Arabic sentences with isolated numbers and codes", () => {
    const preview = explainItemQuantities({
      storageUnitId: piece.id,
      recipeUnitId: null,
      purchaseUnitId: packet.id,
      units: UNITS,
      rules: [rule(packet, piece, "12")],
    });
    const wrap = (text: string) => `[${text}]`;
    const sentences = previewSentences("ar", pair(preview, "purchase_storage"), wrap)!;
    expect(sentences.forward).toBe("1 [packet] = [12] [piece]");
    expect(sentences.example).toBe("يضيف استلام [2] [packet] مقدار [24] [piece] إلى المخزون.");
    expect(sentences.rounding[0]).toMatch(/^يُعرض حتى \[3\] منازل عشرية/);
    expect(previewMissingText("ar", "mass_volume_needs_item_rule")).toMatch(/[؀-ۿ]/);
    expect(previewMissingText("en", "pack_needs_item_rule")).toBe("A pack unit needs a rule for this item.");
  });
});
