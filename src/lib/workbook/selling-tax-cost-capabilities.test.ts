import { describe, expect, it } from "vitest";

import { contractSheet, isDeferredField } from "@/lib/workbook/contract";
import {
  reviewFoodicsProductTaxCost,
  reviewSellingTaxCostCells,
  SELLING_TAX_COST_CAPABILITIES,
  sellingTaxCostCapability,
} from "@/lib/workbook/selling-tax-cost-capabilities";

const statusOf = (id: Parameters<typeof sellingTaxCostCapability>[0]) => sellingTaxCostCapability(id).status;

describe("selling tax and reference cost capability contract", () => {
  it("classifies stored fields as persistable", () => {
    for (const id of [
      "variant_price_tax_basis",
      "variant_tax_rate_basis_points",
      "variant_cost_policy_manual",
      "variant_cost_policy_recipe_derived",
      "modifier_option_cost_policy_manual",
      "modifier_option_cost_policy_recipe_derived",
    ] as const) {
      expect(statusOf(id), id).toBe("persistable");
    }
  });

  it("keeps ambiguous, unresolved and unconfirmed inputs review-only", () => {
    for (const id of [
      "ambiguous_tax_rate",
      "unresolved_tax_value",
      "unknown_tax_basis_token",
      "unconfirmed_selling_tax_basis",
      "unconfirmed_cost_tax_basis",
      "unresolved_modifier_cost_attribution",
      "foodics_blank_cost_recipe_derived",
    ] as const) {
      expect(statusOf(id), id).toBe("review_only");
    }
  });

  it("never marks deferred operational capabilities as supported", () => {
    const deferred = SELLING_TAX_COST_CAPABILITIES.filter((capability) => capability.status === "deferred").map(
      (capability) => [capability.id, capability.target],
    );
    expect(deferred).toEqual([
      ["recipe_derived_cost_amount", "QOS-199"],
      ["inventory_valuation", "QOS-201 to QOS-204"],
      ["tax_filing", "Out of Phase 2 scope"],
      ["checkout_tax", "Separate checkout decision"],
      ["type_of_tax", "Deferred by QOS-216"],
      ["workbook_apply", "QOS-200"],
    ]);
    const statuses = new Set(SELLING_TAX_COST_CAPABILITIES.map((capability) => capability.status));
    expect([...statuses].sort()).toEqual(["deferred", "persistable", "review_only"]);
    expect(new Set(SELLING_TAX_COST_CAPABILITIES.map((capability) => capability.id)).size).toBe(
      SELLING_TAX_COST_CAPABILITIES.length,
    );
  });

  it("matches the 1.4 contract: tax columns persist, cost columns exist on both sellable sheets", () => {
    const variants = contractSheet("Variants");
    for (const key of ["price_tax_basis", "tax_rate_basis_points"]) {
      const column = variants.columns.find((entry) => entry.key === key)!;
      expect(isDeferredField(column), key).toBe(false);
      expect(column.sinceVersion).toBeUndefined();
    }
    expect(variants.columns.find((entry) => entry.key === "price_tax_basis")!.values).toEqual([
      "inclusive",
      "exclusive",
      "unconfirmed",
    ]);
    for (const sheetName of ["Variants", "Modifier Options"]) {
      const keys = contractSheet(sheetName).columns.map((column) => column.key);
      expect(keys.slice(keys.indexOf("cost_method"), keys.indexOf("expected_revision"))).toEqual([
        "cost_method",
        "reference_cost_amount",
        "cost_currency",
        "cost_unit",
        "cost_tax_basis",
        "cost_effective_date",
        "cost_source",
        "cost_source_reference",
      ]);
    }
    expect(contractSheet("Products").columns.some((column) => column.key.includes("cost") || column.key.includes("tax"))).toBe(
      false,
    );
  });
});

describe("reviewSellingTaxCostCells", () => {
  it("reads persisted tax values and workbook aliases, keeping 0 bps", () => {
    expect(reviewSellingTaxCostCells("Variants", { price_tax_basis: "GROSS", tax_rate_basis_points: "0" })).toEqual({
      tax: { priceTaxBasis: "inclusive", taxRateBasisPoints: 0 },
      diagnostics: [],
    });
    expect(reviewSellingTaxCostCells("Variants", {})).toEqual({ tax: {}, diagnostics: [] });
  });

  it("flags unconfirmed and unknown bases and non-integer rates without defaulting", () => {
    const review = reviewSellingTaxCostCells("Variants", { price_tax_basis: "UNCONFIRMED", tax_rate_basis_points: "5%" });
    expect(review.tax).toEqual({ priceTaxBasis: "unconfirmed" });
    expect(review.diagnostics).toEqual([
      { capability: "unconfirmed_selling_tax_basis", severity: "review", column: "price_tax_basis", reason: "selling_tax_basis_unconfirmed" },
      { capability: "unresolved_tax_value", severity: "error", column: "tax_rate_basis_points", reason: "not_numeric", sourceText: "5%" },
    ]);
    expect(reviewSellingTaxCostCells("Variants", { price_tax_basis: "vat" }).diagnostics[0]).toMatchObject({
      capability: "unknown_tax_basis_token",
      sourceText: "vat",
    });
  });

  it("builds an exact manual policy, known zero included", () => {
    expect(
      reviewSellingTaxCostCells("Modifier Options", {
        cost_method: "manual",
        reference_cost_amount: "0",
        cost_currency: "aed",
        cost_unit: "each",
        cost_tax_basis: "NET",
        cost_effective_date: "2026-11-22",
        cost_source: "Supplier quote",
      }),
    ).toEqual({
      tax: {},
      costPolicy: {
        operation: "set_manual",
        amountMicros: BigInt(0),
        currency: "AED",
        unit: "each",
        taxBasis: "net",
        effectiveFrom: "2026-11-22",
        source: "Supplier quote",
        sourceReference: null,
      },
      diagnostics: [],
    });
  });

  it("never reads blank method as recipe-derived and rejects amounts on recipe-derived", () => {
    expect(reviewSellingTaxCostCells("Variants", { reference_cost_amount: "2" })).toMatchObject({
      diagnostics: [{ column: "cost_method", reason: "cost_fields_without_method", severity: "error" }],
    });
    expect(reviewSellingTaxCostCells("Variants", { reference_cost_amount: "2" }).costPolicy).toBeUndefined();
    const withAmount = reviewSellingTaxCostCells("Modifier Options", { cost_method: "recipe_derived", reference_cost_amount: "2" });
    expect(withAmount.costPolicy).toBeUndefined();
    expect(withAmount.diagnostics).toContainEqual(
      expect.objectContaining({ capability: "modifier_option_cost_policy_recipe_derived", reason: "recipe_derived_has_no_amount" }),
    );
    expect(reviewSellingTaxCostCells("Variants", { cost_method: "recipe_derived", cost_tax_basis: "GROSS" })).toMatchObject({
      costPolicy: { operation: "change_to_recipe_derived", taxBasis: "gross", effectiveFrom: null },
      diagnostics: [],
    });
  });

  it("diagnoses incomplete or over-precise manual costs", () => {
    const base = { cost_method: "manual", cost_currency: "AED", cost_effective_date: "2026-11-22", cost_tax_basis: "NET" };
    expect(reviewSellingTaxCostCells("Variants", { ...base, reference_cost_amount: "1.2345678" }).diagnostics[0]).toMatchObject({
      reason: "too_precise",
    });
    expect(reviewSellingTaxCostCells("Variants", { ...base }).diagnostics[0]).toMatchObject({ reason: "manual_amount_blank" });
    expect(
      reviewSellingTaxCostCells("Variants", { ...base, reference_cost_amount: "1", cost_effective_date: "" }).diagnostics[0],
    ).toMatchObject({ reason: "manual_effective_date_blank" });
    expect(
      reviewSellingTaxCostCells("Variants", { ...base, reference_cost_amount: "1", cost_tax_basis: "UNCONFIRMED" }),
    ).toMatchObject({
      costPolicy: { operation: "set_manual", taxBasis: "unconfirmed" },
      diagnostics: [{ capability: "unconfirmed_cost_tax_basis", severity: "review" }],
    });
  });
});

describe("reviewFoodicsProductTaxCost", () => {
  it("maps 0.05 + Inclusive + a cost onto the default variant", () => {
    expect(reviewFoodicsProductTaxCost({ taxPercent: "0.05", taxTreatment: "Inclusive", productCost: "4.25" })).toEqual({
      target: "default_variant",
      tax: { priceTaxBasis: "inclusive", taxRateBasisPoints: 500 },
      costPolicy: { operation: "set_manual", amountMicros: BigInt(4_250_000) },
      diagnostics: [],
    });
  });

  it("turns a blank Product Cost into recipe-derived pending review", () => {
    expect(reviewFoodicsProductTaxCost({ taxPercent: "16%", taxTreatment: "Exclusive", productCost: "" })).toMatchObject({
      tax: { priceTaxBasis: "exclusive", taxRateBasisPoints: 1600 },
      costPolicy: { operation: "change_to_recipe_derived", pendingReview: true },
      diagnostics: [{ capability: "foodics_blank_cost_recipe_derived", severity: "review" }],
    });
  });

  it("diagnoses an ambiguous bare 5 and a tax-group name instead of guessing a rate", () => {
    const ambiguous = reviewFoodicsProductTaxCost({ taxPercent: "5", taxTreatment: "Inclusive", productCost: "1" });
    expect(ambiguous.tax).toEqual({ priceTaxBasis: "inclusive" });
    expect(ambiguous.diagnostics).toEqual([
      { capability: "ambiguous_tax_rate", severity: "review", column: "tax_percent", reason: "bare_number_above_one", sourceText: "5" },
    ]);
    const named = reviewFoodicsProductTaxCost({ taxPercent: "VAT Group A", taxTreatment: "Exclusive", productCost: "1" });
    expect(named.tax).toEqual({ priceTaxBasis: "exclusive" });
    expect(named.diagnostics[0]).toMatchObject({ capability: "unresolved_tax_value", sourceText: "VAT Group A" });
  });
});
