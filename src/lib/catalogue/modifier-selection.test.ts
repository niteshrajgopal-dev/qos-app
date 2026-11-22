import { describe, expect, it } from "vitest";

import {
  INHERIT_ALL_OVERRIDES,
  toEffectiveModifierGroupRules,
  type ModifierAssignmentOverrides,
} from "@/lib/catalogue/modifier-assignment-policy";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import {
  assertModifierDefaultsAreFeasible,
  calculateModifierPriceDelta,
  validateModifierGroupSelections,
  type ModifierGroupRules,
} from "@/lib/catalogue/modifier-selection";

const giftWrapGroup: ModifierGroupRules = {
  publicId: "modgrp_gift_wrapping",
  minSelections: 0,
  maxSelections: 1,
  options: [
    {
      publicId: "modopt_standard",
      status: "active",
      isDefault: true,
      allowsQuantity: false,
      maxQuantity: 1,
      priceMinor: 0,
    },
    {
      publicId: "modopt_premium",
      status: "active",
      isDefault: false,
      allowsQuantity: false,
      maxQuantity: 1,
      priceMinor: 2500,
    },
  ],
};

const milkGroup: ModifierGroupRules = {
  publicId: "modgrp_milk",
  minSelections: 1,
  maxSelections: 1,
  options: [
    {
      publicId: "modopt_oat",
      status: "active",
      isDefault: true,
      allowsQuantity: false,
      maxQuantity: 1,
      priceMinor: 300,
    },
    {
      publicId: "modopt_soy",
      status: "active",
      isDefault: false,
      allowsQuantity: false,
      maxQuantity: 1,
      priceMinor: 300,
    },
  ],
};

describe("modifier selection validation", () => {
  it("blocks zero selections when minimum one is required", () => {
    expect(() =>
      validateModifierGroupSelections(milkGroup, []),
    ).toThrow(CatalogueValidationError);
  });

  it("blocks two selections when maximum one is allowed", () => {
    expect(() =>
      validateModifierGroupSelections(giftWrapGroup, [
        { optionPublicId: "modopt_standard", quantity: 1 },
        { optionPublicId: "modopt_premium", quantity: 1 },
      ]),
    ).toThrow(CatalogueValidationError);
  });

  it("rejects repeated quantities when quantity is not allowed", () => {
    expect(() =>
      validateModifierGroupSelections(giftWrapGroup, [
        { optionPublicId: "modopt_premium", quantity: 2 },
      ]),
    ).toThrow(CatalogueValidationError);
  });

  it("rejects unknown option IDs", () => {
    expect(() =>
      validateModifierGroupSelections(giftWrapGroup, [
        { optionPublicId: "modopt_foreign", quantity: 1 },
      ]),
    ).toThrow(CatalogueValidationError);
  });

  it("calculates exact AED price deltas", () => {
    expect(
      calculateModifierPriceDelta(giftWrapGroup, [
        { optionPublicId: "modopt_premium", quantity: 1 },
      ]),
    ).toBe(2500);

    expect(
      calculateModifierPriceDelta(giftWrapGroup, [], { applyDefaults: true }),
    ).toBe(0);
  });

  it("requires feasible defaults for required groups", () => {
    expect(() =>
      assertModifierDefaultsAreFeasible({
        ...milkGroup,
        options: milkGroup.options.map((option) => ({
          ...option,
          isDefault: false,
        })),
      }),
    ).not.toThrow();

    expect(() =>
      assertModifierDefaultsAreFeasible({
        ...milkGroup,
        minSelections: 2,
        maxSelections: 1,
      }),
    ).toThrow(CatalogueValidationError);
  });
});

/* QOS-212: the same shared Extras group under product-specific policies. */
const extrasGroup: ModifierGroupRules = {
  publicId: "modgrp_extras",
  minSelections: 0,
  maxSelections: 2,
  options: [
    { publicId: "modopt_cheese", status: "active", isDefault: false, allowsQuantity: true, maxQuantity: 3, priceMinor: 200 },
    { publicId: "modopt_sauce", status: "active", isDefault: false, allowsQuantity: false, maxQuantity: 1, priceMinor: 150 },
    // A legacy row: quantity not allowed but a stale max above one.
    { publicId: "modopt_onion", status: "active", isDefault: false, allowsQuantity: false, maxQuantity: 4, priceMinor: 50 },
    { publicId: "modopt_bacon", status: "archived", isDefault: false, allowsQuantity: true, maxQuantity: 5, priceMinor: 500 },
  ],
};

function forProduct(partial: Partial<ModifierAssignmentOverrides>) {
  return toEffectiveModifierGroupRules(extrasGroup, { ...INHERIT_ALL_OVERRIDES, ...partial });
}

function outcome(group: ModifierGroupRules, selections: Array<{ optionPublicId: string; quantity: number }>) {
  try {
    const result = validateModifierGroupSelections(group, selections, { applyDefaults: true });
    return { ok: true as const, totalPriceMinor: result.totalPriceMinor, selections: result.selections };
  } catch (error) {
    if (error instanceof CatalogueValidationError) {
      return { ok: false as const, message: error.message, field: error.field };
    }
    throw error;
  }
}

const SELECTION_CASES: Array<Array<{ optionPublicId: string; quantity: number }>> = [
  [],
  [{ optionPublicId: "modopt_cheese", quantity: 1 }],
  [{ optionPublicId: "modopt_cheese", quantity: 3 }],
  [{ optionPublicId: "modopt_cheese", quantity: 4 }],
  [{ optionPublicId: "modopt_sauce", quantity: 2 }],
  [{ optionPublicId: "modopt_onion", quantity: 2 }],
  [{ optionPublicId: "modopt_onion", quantity: 1 }],
  [{ optionPublicId: "modopt_bacon", quantity: 1 }],
  [{ optionPublicId: "modopt_cheese", quantity: 0 }],
  [
    { optionPublicId: "modopt_cheese", quantity: 2 },
    { optionPublicId: "modopt_sauce", quantity: 1 },
  ],
  [
    { optionPublicId: "modopt_cheese", quantity: 1 },
    { optionPublicId: "modopt_sauce", quantity: 1 },
    { optionPublicId: "modopt_onion", quantity: 1 },
  ],
  [
    { optionPublicId: "modopt_cheese", quantity: 1 },
    { optionPublicId: "modopt_cheese", quantity: 1 },
  ],
];

describe("modifier selection under product assignment policy (QOS-212)", () => {
  it("keeps pass/fail, messages and prices identical to the raw group rules when every override is null", () => {
    const inherited = forProduct({});
    for (const selections of SELECTION_CASES) {
      expect(outcome(inherited, selections), JSON.stringify(selections)).toEqual(outcome(extrasGroup, selections));
    }
    // Pinned results from main for the raw group (distinct counting, quantity priced in).
    expect(outcome(extrasGroup, [{ optionPublicId: "modopt_cheese", quantity: 3 }])).toMatchObject({ ok: true, totalPriceMinor: 600 });
    expect(
      outcome(extrasGroup, [
        { optionPublicId: "modopt_cheese", quantity: 2 },
        { optionPublicId: "modopt_sauce", quantity: 1 },
      ]),
    ).toMatchObject({ ok: true, totalPriceMinor: 550 });
    expect(outcome(extrasGroup, [{ optionPublicId: "modopt_onion", quantity: 2 }])).toMatchObject({
      ok: false,
      message: "This modifier option does not allow quantity greater than one.",
    });
    expect(
      outcome(extrasGroup, [
        { optionPublicId: "modopt_cheese", quantity: 1 },
        { optionPublicId: "modopt_sauce", quantity: 1 },
        { optionPublicId: "modopt_onion", quantity: 1 },
      ]),
    ).toMatchObject({ ok: false, field: "selections" });
  });

  it("prices an allowed repeat and returns the accepted quantity for downstream consumers", () => {
    const result = validateModifierGroupSelections(forProduct({ repeatAllowed: true, minSelections: 1 }), [
      { optionPublicId: "modopt_cheese", quantity: 3 },
      { optionPublicId: "modopt_sauce", quantity: 1 },
    ]);

    expect(result.selections).toEqual([
      { optionPublicId: "modopt_cheese", quantity: 3, priceMinor: 200 },
      { optionPublicId: "modopt_sauce", quantity: 1, priceMinor: 150 },
    ]);
    expect(result.totalPriceMinor).toBe(3 * 200 + 150);
  });

  it("fails repeats that the product tightens or that exceed the option's own cap", () => {
    const noRepeats = forProduct({ repeatAllowed: false });
    expect(outcome(noRepeats, [{ optionPublicId: "modopt_cheese", quantity: 2 }])).toMatchObject({
      ok: false,
      field: "selections[0].quantity",
    });
    expect(outcome(noRepeats, [{ optionPublicId: "modopt_cheese", quantity: 1 }])).toMatchObject({ ok: true, totalPriceMinor: 200 });

    const repeatsOn = forProduct({ repeatAllowed: true });
    // repeat_allowed = true does not lift cheese above 3 or sauce above 1.
    expect(outcome(repeatsOn, [{ optionPublicId: "modopt_cheese", quantity: 4 }])).toMatchObject({
      ok: false,
      message: "quantity exceeds the configured maximum for this option.",
    });
    expect(outcome(repeatsOn, [{ optionPublicId: "modopt_sauce", quantity: 2 }])).toMatchObject({ ok: false });
  });

  it("gives two products different bounds on the same shared group", () => {
    const burger = forProduct({ minSelections: 1, maxSelections: 1 });
    const fries = forProduct({ maxSelections: 3 });
    const twoChoices = [
      { optionPublicId: "modopt_cheese", quantity: 1 },
      { optionPublicId: "modopt_sauce", quantity: 1 },
    ];

    expect(outcome(burger, [])).toMatchObject({ ok: false, field: "selections" });
    expect(outcome(burger, twoChoices)).toMatchObject({ ok: false, field: "selections" });
    expect(outcome(fries, twoChoices)).toMatchObject({ ok: true, totalPriceMinor: 350 });
  });

  it("counts distinct options by default and sums quantities only for explicit total_quantity", () => {
    const threeCheese = [{ optionPublicId: "modopt_cheese", quantity: 3 }];

    // Distinct: one option chosen, so a max of 2 is respected even at quantity 3.
    expect(outcome(forProduct({}), threeCheese)).toMatchObject({ ok: true, totalPriceMinor: 600 });
    expect(outcome(forProduct({ selectionCountMode: null }), threeCheese)).toMatchObject({ ok: true });

    // Total quantity: 3 > 2.
    expect(outcome(forProduct({ selectionCountMode: "total_quantity" }), threeCheese)).toMatchObject({
      ok: false,
      message: "No more than 2 selection(s) are allowed for this modifier group.",
    });
    // And a minimum of 2 can be met by one option chosen twice.
    expect(
      outcome(forProduct({ selectionCountMode: "total_quantity", minSelections: 2 }), [{ optionPublicId: "modopt_cheese", quantity: 2 }]),
    ).toMatchObject({ ok: true, totalPriceMinor: 400 });
    expect(
      outcome(forProduct({ minSelections: 2 }), [{ optionPublicId: "modopt_cheese", quantity: 2 }]),
    ).toMatchObject({ ok: false, message: "At least 2 selection(s) are required for this modifier group." });
  });
});
