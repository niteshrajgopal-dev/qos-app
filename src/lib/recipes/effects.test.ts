import { describe, expect, it } from "vitest";

import { toEffectiveModifierGroupRules } from "@/lib/catalogue/modifier-assignment-policy";
import { type Rational, toDecimalString } from "@/lib/inventory/quantity-math";
import { micros } from "@/lib/inventory/test-units";
import {
  BEANS_LINE,
  beans,
  configuration,
  effect,
  EFFECTS,
  EXTRAS,
  g,
  group,
  latteVersion,
  milk,
  MILK_LINE,
  ml,
  oat,
  pack,
  sugar,
  SWEETNESS,
  syrup,
} from "@/lib/recipes/configuration-test-fixtures";
import { applyModifierEffects, type ConfigurationResult } from "@/lib/recipes/effects";

const text = (value: Rational | null, places = 3) => (value === null ? null : toDecimalString(value, places));

function resolved(result: ConfigurationResult) {
  if (result.status !== "resolved") throw new Error(`expected resolved, got ${result.status}: ${JSON.stringify(result.rejections)}`);
  return result;
}

function perItem(result: ConfigurationResult, places = 3) {
  return Object.fromEntries(
    resolved(result).perItem.map((entry) => [entry.itemId, [text(entry.perSale, places), text(entry.total, places)]]),
  );
}

describe("applyModifierEffects: base and the worked example", () => {
  it("with no options and no defaults equals the QOS-198 base usage", () => {
    const result = resolved(applyModifierEffects(configuration()));
    expect(result.selections).toEqual([]);
    expect(result.contributions.map((entry) => entry.kind)).toEqual(["base", "base"]);
    expect(perItem(result)).toEqual({ [milk.id]: ["0.200", "0.200"], [beans.id]: ["0.018", "0.018"] });
    expect(result.complete).toBe(true);
  });

  it("extra shot ×2 and oat milk ×1 sold 3: beans 36 g per sale, milk removed once, oat added 200 ml × 1", () => {
    const result = resolved(
      applyModifierEffects(
        configuration({
          soldQuantity: 3,
          selections: [
            { optionPublicId: "modopt_shot", quantity: 2 },
            { optionPublicId: "modopt_oat", quantity: 1 },
          ],
        }),
      ),
    );
    expect(perItem(result)).toEqual({
      [milk.id]: ["0.000", "0.000"],
      [beans.id]: ["0.036", "0.108"],
      [oat.id]: ["0.200", "0.600"],
    });
    expect(result.contributions.map((entry) => [entry.kind, entry.itemId, entry.multiplier, text(entry.perSale)])).toEqual([
      ["base", milk.id, 1, "0.200"],
      ["base", beans.id, 1, "0.018"],
      ["add", beans.id, 2, "0.018"],
      ["replace_remove", milk.id, 1, "-0.200"],
      ["replace_add", oat.id, 1, "0.200"],
    ]);
    // Contributions keep their source: the oat line points at the replaced base line and its effect.
    expect(result.contributions[4]).toMatchObject({ effectId: "eff-oat", optionId: "opt-oat", lineId: MILK_LINE });
  });
});

describe("applyModifierEffects: remove and replace", () => {
  it("REMOVE subtracts exactly the targeted line's per-sale base contribution, once", () => {
    const result = applyModifierEffects(configuration({ soldQuantity: 4, selections: [{ optionPublicId: "modopt_nomilk", quantity: 1 }] }));
    expect(perItem(result)).toEqual({ [milk.id]: ["0.000", "0.000"], [beans.id]: ["0.018", "0.072"] });
    const removal = resolved(result).contributions.filter((entry) => entry.kind === "remove");
    expect(removal).toHaveLength(1);
    expect(removal[0]).toMatchObject({ lineId: MILK_LINE, multiplier: 1 });
  });

  it("REMOVE divides the base line by the yield like the base does", () => {
    const version = latteVersion({
      yieldQuantityMicros: micros("4"),
      lines: [
        { id: MILK_LINE, itemId: milk.id, unitId: ml.id, quantityMicros: micros("1000"), status: "active" },
        { id: BEANS_LINE, itemId: beans.id, unitId: g.id, quantityMicros: micros("72"), status: "active" },
      ],
    });
    const recipes = [{ id: "rec-latte", kind: "sellable" as const, status: "active" as const, versions: [version] }];
    const result = resolved(applyModifierEffects(configuration({ recipes, selections: [{ optionPublicId: "modopt_nomilk", quantity: 1 }] })));
    expect(result.contributions.find((entry) => entry.kind === "remove")!.perSale).toEqual({ numerator: BigInt(-1), denominator: BigInt(4) });
    expect(perItem(result)[milk.id]).toEqual(["0.000", "0.000"]);
  });

  it("REPLACE with the line's own item is a quantity change for that option", () => {
    const effects = [effect({ id: "eff-more", modifierOptionId: "opt-oat", effectType: "replace", targetLineId: MILK_LINE, itemId: milk.id, unitId: ml.id, quantityMicros: micros("300") })];
    const result = applyModifierEffects(configuration({ effects, selections: [{ optionPublicId: "modopt_oat", quantity: 1 }] }));
    expect(perItem(result)[milk.id]).toEqual(["0.300", "0.300"]);
  });

  it("rejects a remove or replace option selected more than once", () => {
    const result = applyModifierEffects(configuration({ selections: [{ optionPublicId: "modopt_oat", quantity: 2 }] }));
    expect(result.status).toBe("rejected");
    expect(result.rejections).toEqual([
      { code: "repeat_not_allowed_for_effect", optionPublicIds: ["modopt_oat"], groupPublicId: null, lineId: null, itemId: null },
    ]);
    expect("contributions" in result).toBe(false);
  });

  it("rejects two options that change the same base line instead of subtracting twice", () => {
    const result = applyModifierEffects(
      configuration({
        selections: [
          { optionPublicId: "modopt_oat", quantity: 1 },
          { optionPublicId: "modopt_nomilk", quantity: 1 },
        ],
      }),
    );
    expect(result.status).toBe("rejected");
    expect(result.rejections).toEqual([
      { code: "conflicting_effects", optionPublicIds: ["modopt_oat", "modopt_nomilk"], groupPublicId: null, lineId: MILK_LINE, itemId: milk.id },
    ]);
  });

  it("rejects negative consumption and never clamps it to zero", () => {
    // Defensive: the database forbids two active effects of one option on one line; if they ever met, the item would go below zero.
    const effects = [
      effect({ id: "eff-a", modifierOptionId: "opt-nomilk", effectType: "remove", targetLineId: MILK_LINE }),
      effect({ id: "eff-b", modifierOptionId: "opt-nomilk", effectType: "replace", targetLineId: MILK_LINE, itemId: milk.id, unitId: ml.id, quantityMicros: micros("50") }),
    ];
    const result = applyModifierEffects(configuration({ effects, selections: [{ optionPublicId: "modopt_nomilk", quantity: 1 }] }));
    expect(result.status).toBe("rejected");
    expect(result.rejections).toEqual([
      { code: "negative_consumption", optionPublicIds: ["modopt_nomilk"], groupPublicId: null, lineId: null, itemId: milk.id },
    ]);
    expect("perItem" in result).toBe(false);
  });
});

describe("applyModifierEffects: add after yield and unit conversion", () => {
  it("multiplies ADD by the accepted option quantity and the sold quantity, in the storage unit", () => {
    const result = applyModifierEffects(configuration({ soldQuantity: 2, selections: [{ optionPublicId: "modopt_shot", quantity: 3 }] }));
    // 18 g base + 9 g × 3 = 45 g per sale, 90 g for two sales.
    expect(perItem(result)[beans.id]).toEqual(["0.045", "0.090"]);
  });

  it("converts an effect through the item's own pack rule live on the date", () => {
    const effects = [effect({ id: "eff-pack", modifierOptionId: "opt-shot", effectType: "add", itemId: sugar.id, unitId: pack.id, quantityMicros: micros("1") })];
    const rules = [
      { id: "r-pack", itemId: sugar.id, fromUnitId: pack.id, toUnitId: g.id, factorMicros: micros("500"), effectiveFrom: "2026-11-01", effectiveTo: null },
    ];
    const result = applyModifierEffects(configuration({ effects, rules, soldQuantity: 3, selections: [{ optionPublicId: "modopt_shot", quantity: 2 }] }));
    expect(perItem(result)[sugar.id]).toEqual(["1.000", "3.000"]);
  });

  it("an effect unit with no conversion on the date is incomplete and carries no number", () => {
    const effects = [effect({ id: "eff-pack", modifierOptionId: "opt-shot", effectType: "add", itemId: beans.id, unitId: pack.id, quantityMicros: micros("1") })];
    const result = resolved(applyModifierEffects(configuration({ effects, selections: [{ optionPublicId: "modopt_shot", quantity: 1 }] })));
    expect(result.complete).toBe(false);
    expect(result.contributions.at(-1)).toMatchObject({ status: "missing_conversion", perSale: null, total: null });
    expect(perItem(result)[beans.id]).toEqual([null, null]);
    expect(perItem(result)[milk.id]).toEqual(["0.200", "0.200"]);
  });

  it("uses a prepared item as itself and never explodes its recipe", () => {
    const effects = [effect({ id: "eff-syrup", modifierOptionId: "opt-shot", effectType: "add", itemId: syrup.id, unitId: ml.id, quantityMicros: micros("20") })];
    const result = resolved(applyModifierEffects(configuration({ effects, selections: [{ optionPublicId: "modopt_shot", quantity: 1 }] })));
    expect(result.contributions.at(-1)).toMatchObject({ itemId: syrup.id, prepared: true });
    expect(perItem(result)[syrup.id]).toEqual(["0.020", "0.020"]);
  });

  it("ignores removed effects and effects of other versions", () => {
    const effects = [
      ...EFFECTS.filter((entry) => entry.id !== "eff-shot"),
      effect({ id: "eff-old", modifierOptionId: "opt-shot", effectType: "add", itemId: beans.id, unitId: g.id, quantityMicros: micros("9"), status: "removed" }),
      effect({ id: "eff-v0", recipeVersionId: "v0", modifierOptionId: "opt-shot", effectType: "add", itemId: beans.id, unitId: g.id, quantityMicros: micros("9") }),
    ];
    const result = applyModifierEffects(configuration({ effects, selections: [{ optionPublicId: "modopt_shot", quantity: 1 }] }));
    expect(perItem(result)[beans.id]).toEqual(["0.018", "0.018"]);
  });
});

describe("applyModifierEffects: selections, defaults and caps", () => {
  it("applies a group's default once when the group is left empty", () => {
    const result = resolved(applyModifierEffects(configuration({ defaults: "auto", soldQuantity: 2 })));
    expect(result.defaultsApplied).toBe(true);
    expect(result.selections).toEqual([
      { optionId: "opt-sugar", optionPublicId: "modopt_sugar", groupPublicId: "grp_sweet", quantity: 1, priceMinor: 0, source: "default" },
    ]);
    expect(perItem(result)[sugar.id]).toEqual(["0.005", "0.010"]);
  });

  it("never adds a default to a group with an explicit selection", () => {
    const result = resolved(applyModifierEffects(configuration({ defaults: "auto", selections: [{ optionPublicId: "modopt_plain", quantity: 1 }] })));
    expect(result.selections.map((entry) => [entry.optionPublicId, entry.source])).toEqual([["modopt_plain", "selected"]]);
    expect(perItem(result)[sugar.id]).toBeUndefined();
  });

  it("with defaults none, a required group left empty is rejected", () => {
    const required = group("grp_sweet", [{ publicId: "modopt_sugar", id: "opt-sugar", isDefault: true }], { minSelections: 1, maxSelections: 1 });
    const result = applyModifierEffects(configuration({ groups: [EXTRAS, required] }));
    expect(result.rejections.map((entry) => [entry.code, entry.groupPublicId])).toEqual([["selection_required", "grp_sweet"]]);
    const auto = resolved(applyModifierEffects(configuration({ groups: [EXTRAS, required], defaults: "auto" })));
    expect(auto.selections.map((entry) => entry.optionPublicId)).toEqual(["modopt_sugar"]);
  });

  it("caps quantities with the product's effective policy (repeat not allowed caps at one)", () => {
    const capped = { ...EXTRAS, rules: toEffectiveModifierGroupRules(EXTRAS.rules, { minSelections: null, maxSelections: null, repeatAllowed: false, selectionCountMode: null }) };
    const result = applyModifierEffects(configuration({ groups: [capped, SWEETNESS], selections: [{ optionPublicId: "modopt_shot", quantity: 2 }] }));
    expect(result.rejections.map((entry) => [entry.code, entry.optionPublicIds])).toEqual([["option_quantity_exceeds_cap", ["modopt_shot"]]]);
    expect(applyModifierEffects(configuration({ selections: [{ optionPublicId: "modopt_shot", quantity: 4 }] })).rejections[0]!.code).toBe(
      "option_quantity_exceeds_cap",
    );
  });

  it("counts total quantity against the maximum when the assignment says so", () => {
    const counted = { ...EXTRAS, rules: { ...EXTRAS.rules, maxSelections: 2, selectionCountMode: "total_quantity" as const } };
    const result = applyModifierEffects(configuration({ groups: [counted, SWEETNESS], selections: [{ optionPublicId: "modopt_shot", quantity: 3 }] }));
    expect(result.rejections.map((entry) => [entry.code, entry.groupPublicId])).toEqual([["selection_exceeds_max", "grp_extras"]]);
    const distinct = applyModifierEffects(configuration({ groups: [{ ...counted, rules: { ...counted.rules, selectionCountMode: "distinct_options" } }, SWEETNESS], selections: [{ optionPublicId: "modopt_shot", quantity: 3 }] }));
    expect(distinct.status).toBe("resolved");
  });

  it("rejects unassigned, archived and duplicate options", () => {
    const archivedGroup = group("grp_old", [{ publicId: "modopt_old", id: "opt-old" }], {}, "archived");
    const result = applyModifierEffects(
      configuration({
        groups: [EXTRAS, SWEETNESS, archivedGroup],
        selections: [
          { optionPublicId: "modopt_elsewhere", quantity: 1 },
          { optionPublicId: "modopt_old", quantity: 1 },
          { optionPublicId: "modopt_shot", quantity: 1 },
          { optionPublicId: "modopt_shot", quantity: 1 },
        ],
      }),
    );
    expect(result.rejections.map((entry) => [entry.code, entry.optionPublicIds])).toEqual([
      ["option_not_available", ["modopt_elsewhere"]],
      ["option_not_available", ["modopt_old"]],
      ["duplicate_selection", ["modopt_shot"]],
    ]);
  });

  it("reports an unresolved base and still validates the selections", () => {
    const result = applyModifierEffects(configuration({ links: [], defaults: "auto" }));
    expect(result.status).toBe("unresolved");
    if (result.status !== "unresolved") return;
    expect(result.base.reason).toBe("no_link");
    expect(result.selections.map((entry) => entry.optionPublicId)).toEqual(["modopt_sugar"]);
  });
});
