import { describe, expect, it } from "vitest";

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
