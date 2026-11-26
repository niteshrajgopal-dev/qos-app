import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { PHASE1_SYNTHETIC_CHECKOUT_PRICING_POLICY } from "@/lib/checkout/pricing-policy";
import {
  compareOnBasis,
  explainModifierCostAdjustment,
  referenceMargin,
  resolveReferenceCost,
  type ReferenceCostPolicyRow,
  toReferenceMarginView,
  validateCostPolicyOperation,
} from "@/lib/catalogue/reference-cost-policies";
import { CatalogueValidationError } from "@/lib/catalogue/validation";

function policy(overrides: Partial<ReferenceCostPolicyRow> = {}): ReferenceCostPolicyRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    tenantId: "00000000-0000-4000-8000-000000000002",
    publicId: "vrc_test",
    method: "manual",
    amountMicros: BigInt(4_000_000),
    currency: "AED",
    unit: "each",
    taxBasis: "net",
    effectiveFrom: "2026-11-01",
    effectiveTo: null,
    source: null,
    sourceReference: null,
    revision: 1,
    provenance: "operator_entered",
    createdAt: new Date("2026-11-01T00:00:00Z"),
    createdBySubject: "staff_1",
    ...overrides,
  };
}

const manualBase = resolveReferenceCost(policy());
const recipeBase = resolveReferenceCost(policy({ method: "recipe_derived", amountMicros: null, currency: null }));
const noPolicy = resolveReferenceCost(null);

describe("resolveReferenceCost", () => {
  it("returns a manual reference with exact micros", () => {
    expect(manualBase).toEqual({
      status: "manual_reference",
      amountMicros: BigInt(4_000_000),
      currency: "AED",
      unit: "each",
      taxBasis: "net",
      effectiveFrom: "2026-11-01",
      policyPublicId: "vrc_test",
      revision: 1,
    });
  });

  it("keeps a known zero manual cost as a manual reference, not unavailable", () => {
    expect(resolveReferenceCost(policy({ amountMicros: BigInt(0) }))).toMatchObject({
      status: "manual_reference",
      amountMicros: BigInt(0),
    });
  });

  it("returns recipe-derived with no amount when no engine result is passed (an option's amount depends on the configuration)", () => {
    expect(recipeBase).toMatchObject({
      status: "recipe_derived_reference",
      amount: "unavailable",
      reason: "computed_per_configuration",
      policyPublicId: "vrc_test",
      revision: 1,
    });
    expect(recipeBase).not.toHaveProperty("amountMicros");
  });

  it("returns unavailable with a reason for missing or unconfirmed data", () => {
    expect(noPolicy).toEqual({ status: "unavailable", reason: "no_policy" });
    expect(resolveReferenceCost(policy({ taxBasis: "unconfirmed" }))).toMatchObject({
      status: "unavailable",
      reason: "unconfirmed_cost_tax_basis",
    });
    expect(resolveReferenceCost(policy({ taxBasis: null }))).toMatchObject({
      status: "unavailable",
      reason: "missing_cost_tax_basis",
    });
    expect(resolveReferenceCost(policy({ currency: null }))).toMatchObject({
      status: "unavailable",
      reason: "missing_currency",
    });
    expect(resolveReferenceCost(policy({ amountMicros: null }))).toMatchObject({
      status: "unavailable",
      reason: "missing_amount",
    });
  });
});

describe("explainModifierCostAdjustment", () => {
  const optionCost = resolveReferenceCost(policy({ publicId: "orc_oat", amountMicros: BigInt(1_500_000) }));

  it("keeps ADD base and option costs separate without summing them", () => {
    const result = explainModifierCostAdjustment({ base: manualBase, option: optionCost, effectType: "ADD" });
    expect(result).toEqual({ status: "separate", effectType: "ADD", base: manualBase, option: optionCost });
    expect(JSON.stringify(result, (_key, value) => (typeof value === "bigint" ? value.toString() : value))).not.toContain(
      "5500000",
    );
  });

  it("reports REMOVE and REPLACE against a manual base as unresolved attribution", () => {
    for (const effectType of ["REMOVE", "REPLACE"] as const) {
      expect(explainModifierCostAdjustment({ base: manualBase, option: optionCost, effectType })).toMatchObject({
        status: "unresolved_attribution",
        effectType,
        reason: "cannot_net_manual_base",
      });
    }
  });

  it("nets REMOVE against a recipe-derived base per configuration and reports a missing base", () => {
    expect(explainModifierCostAdjustment({ base: recipeBase, option: optionCost, effectType: "REMOVE" })).toMatchObject({
      status: "recipe_configuration",
      reason: "computed_per_configuration",
    });
    expect(explainModifierCostAdjustment({ base: noPolicy, option: optionCost, effectType: "REPLACE" })).toMatchObject({
      status: "unavailable",
      reason: "base_cost_unavailable",
    });
  });
});

describe("referenceMargin", () => {
  const exclusivePrice = { amountMinor: 1800, currency: "AED", priceTaxBasis: "exclusive" as const, taxRateBasisPoints: 500 };

  it("compares a net price with a net manual cost exactly in micros", () => {
    const result = referenceMargin(exclusivePrice, manualBase);
    expect(result).toEqual({
      status: "available",
      basis: "net",
      currency: "AED",
      priceMicros: BigInt(18_000_000),
      costMicros: BigInt(4_000_000),
      marginMicros: BigInt(14_000_000),
      rounding: "none",
    });
    expect(toReferenceMarginView(result)).toMatchObject({ marginMicros: "14000000", marginMajor: "14.00" });
  });

  it("normalizes an inclusive price to net with one half-up rounding to micros", () => {
    // 10.00 AED gross at 5%: 10_000_000 × 10_000 / 10_500 = 9_523_809.52… → 9_523_810.
    const result = referenceMargin(
      { amountMinor: 1000, currency: "AED", priceTaxBasis: "inclusive", taxRateBasisPoints: 500 },
      manualBase,
    );
    expect(result).toMatchObject({
      status: "available",
      basis: "net",
      priceMicros: BigInt(9_523_810),
      marginMicros: BigInt(5_523_810),
      rounding: "half_up_micros",
    });

    // 10.50 AED gross at 5% is exactly 10.00 net: no rounding applied.
    expect(
      referenceMargin({ amountMinor: 1050, currency: "AED", priceTaxBasis: "inclusive", taxRateBasisPoints: 500 }, manualBase),
    ).toMatchObject({ priceMicros: BigInt(10_000_000), rounding: "none" });
  });

  it("brings an exclusive price to gross exactly when the cost is gross", () => {
    const grossCost = resolveReferenceCost(policy({ taxBasis: "gross" }));
    expect(referenceMargin(exclusivePrice, grossCost)).toMatchObject({
      status: "available",
      basis: "gross",
      priceMicros: BigInt(18_900_000),
      marginMicros: BigInt(14_900_000),
      rounding: "none",
    });
  });

  it("treats a 0 bps rate as a real 0% rate", () => {
    expect(
      referenceMargin({ amountMinor: 1000, currency: "AED", priceTaxBasis: "inclusive", taxRateBasisPoints: 0 }, manualBase),
    ).toMatchObject({ status: "available", priceMicros: BigInt(10_000_000) });
  });

  it("is unavailable, never zero or 100%, when anything is missing or unconfirmed", () => {
    const cases: Array<[Parameters<typeof referenceMargin>[0], Parameters<typeof referenceMargin>[1], string]> = [
      [{ ...exclusivePrice, priceTaxBasis: null }, manualBase, "missing_selling_tax_basis"],
      [{ ...exclusivePrice, priceTaxBasis: "unconfirmed" }, manualBase, "unconfirmed_selling_tax_basis"],
      [{ ...exclusivePrice, amountMinor: null }, manualBase, "missing_price"],
      [exclusivePrice, noPolicy, "cost_unavailable"],
      [exclusivePrice, recipeBase, "recipe_derived_cost_not_computed"],
      [exclusivePrice, resolveReferenceCost(policy({ taxBasis: "unconfirmed" })), "cost_unavailable"],
      [exclusivePrice, resolveReferenceCost(policy({ currency: "USD" })), "currency_mismatch"],
      [exclusivePrice, resolveReferenceCost(policy({ unit: "kg" })), "cost_unit_not_each"],
      [exclusivePrice, resolveReferenceCost(policy({ unit: null })), "cost_unit_not_each"],
      [
        { amountMinor: 1000, currency: "AED", priceTaxBasis: "inclusive", taxRateBasisPoints: null },
        manualBase,
        "missing_tax_rate",
      ],
    ];
    for (const [price, cost, reason] of cases) {
      expect(referenceMargin(price, cost), reason).toEqual({ status: "unavailable", reason });
    }
  });

  it("never falls back to the Phase 1 synthetic checkout rate", () => {
    expect(PHASE1_SYNTHETIC_CHECKOUT_PRICING_POLICY.vatRateBps).toBe(500);
    expect(
      referenceMargin({ amountMinor: 1000, currency: "AED", priceTaxBasis: "inclusive", taxRateBasisPoints: null }, manualBase),
    ).toEqual({ status: "unavailable", reason: "missing_tax_rate" });

    const source = readFileSync(path.join(process.cwd(), "src/lib/catalogue/reference-cost-policies.ts"), "utf8");
    expect(source).not.toContain("pricing-policy");
    expect(source).not.toContain("PHASE1_SYNTHETIC");
  });
});

describe("validateCostPolicyOperation", () => {
  it("treats an omitted costPolicy as no change", () => {
    expect(validateCostPolicyOperation(undefined)).toBeUndefined();
  });

  it("requires an explicit operation and never reads blank as recipe-derived", () => {
    expect(() => validateCostPolicyOperation(null)).toThrow(CatalogueValidationError);
    expect(() => validateCostPolicyOperation({})).toThrow(/operation/);
    expect(() =>
      validateCostPolicyOperation({ operation: "set_manual", amount: "", currency: "AED", effectiveFrom: "2026-11-22" }),
    ).toThrow(/known zero/);
  });

  it("accepts a known-zero manual amount and exact micros", () => {
    expect(
      validateCostPolicyOperation({ operation: "set_manual", amount: "0", currency: "aed", effectiveFrom: "2026-11-22" }),
    ).toMatchObject({ operation: "set_manual", amountMicros: BigInt(0), currency: "AED" });
    expect(
      validateCostPolicyOperation({
        operation: "set_manual",
        amountMicros: "1234567",
        currency: "AED",
        unit: "each",
        taxBasis: "net",
        effectiveFrom: "2026-11-22",
      }),
    ).toMatchObject({ amountMicros: BigInt(1_234_567), unit: "each", taxBasis: "net" });
  });

  it("rejects incomplete manual policies and amounts on recipe-derived", () => {
    expect(() =>
      validateCostPolicyOperation({ operation: "set_manual", amount: "1.2345678", currency: "AED", effectiveFrom: "2026-11-22" }),
    ).toThrow(/six decimal/);
    expect(() => validateCostPolicyOperation({ operation: "set_manual", amount: "1", effectiveFrom: "2026-11-22" })).toThrow(
      /currency/,
    );
    expect(() => validateCostPolicyOperation({ operation: "set_manual", amount: "1", currency: "AED" })).toThrow(/effectiveFrom/);
    expect(() =>
      validateCostPolicyOperation({ operation: "set_manual", amount: "1", amountMicros: 1, currency: "AED", effectiveFrom: "2026-11-22" }),
    ).toThrow(/exactly one/);
    expect(() => validateCostPolicyOperation({ operation: "change_to_recipe_derived", amount: "1" })).toThrow(/no amount/);
    expect(() =>
      validateCostPolicyOperation({ operation: "set_manual", amount: "1", currency: "AED", effectiveFrom: "2026-11-22", unit: "box" }),
    ).toThrow(/unit/);
  });

  it("accepts explicit change_to_recipe_derived and clear", () => {
    expect(validateCostPolicyOperation({ operation: "change_to_recipe_derived" })).toEqual({
      operation: "change_to_recipe_derived",
      unit: null,
      taxBasis: null,
      effectiveFrom: null,
      source: null,
      sourceReference: null,
    });
    expect(validateCostPolicyOperation({ operation: "clear" })).toEqual({ operation: "clear" });
  });
});

describe("compareOnBasis (shared with the configuration margin)", () => {
  it("matches referenceMargin's normalisation on every basis pair", () => {
    const cases: Array<[boolean, boolean, number | null, number, bigint, string]> = [
      [false, false, 500, 1800, BigInt(18_000_000), "none"],
      [true, true, 500, 1800, BigInt(18_000_000), "none"],
      [true, false, 500, 1000, BigInt(9_523_810), "half_up_micros"],
      [true, false, 500, 1050, BigInt(10_000_000), "none"],
      [false, true, 500, 1800, BigInt(18_900_000), "none"],
      [true, false, 0, 1000, BigInt(10_000_000), "none"],
    ];
    for (const [isGross, costIsGross, rate, amountMinor, priceMicros, rounding] of cases) {
      expect(compareOnBasis({ amountMinor, isGross, taxRateBasisPoints: rate }, costIsGross)).toEqual({ status: "ok", priceMicros, rounding });
      const margin = referenceMargin(
        { amountMinor, currency: "AED", priceTaxBasis: isGross ? "inclusive" : "exclusive", taxRateBasisPoints: rate },
        resolveReferenceCost(policy({ taxBasis: costIsGross ? "gross" : "net" })),
      );
      expect(margin).toMatchObject({ status: "available", priceMicros, rounding });
    }
    expect(compareOnBasis({ amountMinor: 1000, isGross: true, taxRateBasisPoints: null }, false)).toEqual({ status: "missing_tax_rate" });
    expect(compareOnBasis({ amountMinor: 1000, isGross: true, taxRateBasisPoints: null }, true)).toMatchObject({ status: "ok" });
  });
});

describe("recipe-derived reference cost computed by the recipe engine", () => {
  const recipePolicy = policy({ method: "recipe_derived", amountMicros: null, currency: null, unit: null, taxBasis: null });
  const computed = (taxBasis: "net" | "gross" | "unconfirmed" | "mixed") =>
    resolveReferenceCost(recipePolicy, {
      status: "computed",
      amountMicros: BigInt(1_880_000),
      rounding: "none",
      currency: "AED",
      taxBasis,
      recipe: { publicId: "rec_latte", nameEn: "Latte", nameAr: null },
      versionNumber: 1,
    });
  const exclusivePrice = { amountMinor: 1800, currency: "AED", priceTaxBasis: "exclusive" as const, taxRateBasisPoints: 500 };

  it("resolves to the computed amount per sale, each, and gives a margin on a confirmed basis", () => {
    expect(computed("net")).toMatchObject({ status: "recipe_derived_computed", amountMicros: BigInt(1_880_000), unit: "each", versionNumber: 1 });
    expect(referenceMargin(exclusivePrice, computed("net"))).toMatchObject({ status: "available", basis: "net", marginMicros: BigInt(16_120_000) });
    expect(referenceMargin(exclusivePrice, computed("gross"))).toMatchObject({ status: "available", basis: "gross", priceMicros: BigInt(18_900_000) });
  });

  it("never compares an unconfirmed or mixed ingredient basis with the price", () => {
    expect(referenceMargin(exclusivePrice, computed("unconfirmed"))).toEqual({ status: "unavailable", reason: "unconfirmed_cost_tax_basis" });
    expect(referenceMargin(exclusivePrice, computed("mixed"))).toEqual({ status: "unavailable", reason: "mixed_cost_tax_basis" });
  });

  it("carries the engine's specific reason when there is no amount", () => {
    for (const reason of ["recipe_no_link", "recipe_no_version", "recipe_incomplete", "recipe_unresolved"] as const) {
      const resolved = resolveReferenceCost(recipePolicy, { status: "unavailable", reason });
      expect(resolved).toMatchObject({ status: "recipe_derived_reference", amount: "unavailable", reason });
      expect(referenceMargin(exclusivePrice, resolved)).toEqual({ status: "unavailable", reason });
    }
  });

  it("is ignored for a manual policy: a manual amount is never replaced by the recipe", () => {
    expect(resolveReferenceCost(policy(), { status: "unavailable", reason: "recipe_no_link" })).toMatchObject({ status: "manual_reference", amountMicros: BigInt(4_000_000) });
  });
});
