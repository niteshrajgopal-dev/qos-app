import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ReferenceCostEditor,
  ReferenceMarginLine,
  SellableTaxCostSummary,
  SellingTaxEditor,
} from "@/app/tenants/[tenantId]/catalogue/products/sellable-tax-cost-fields";
import type { SellableReferenceCostView } from "@/lib/catalogue/reference-cost-policies";

const noPolicy: SellableReferenceCostView = { policy: null, resolution: { status: "unavailable", reason: "no_policy" } };

const manualZero: SellableReferenceCostView = {
  policy: {
    publicId: "vrc_1",
    method: "manual",
    amountMicros: "0",
    amountMajor: "0",
    currency: "AED",
    unit: "each",
    taxBasis: "net",
    effectiveFrom: "2026-11-01",
    source: null,
    sourceReference: null,
    revision: 2,
    provenance: "operator_entered",
  },
  resolution: {
    status: "manual_reference",
    amountMicros: "0",
    currency: "AED",
    unit: "each",
    taxBasis: "net",
    effectiveFrom: "2026-11-01",
    policyPublicId: "vrc_1",
    revision: 2,
  },
};

const recipe: SellableReferenceCostView = {
  policy: { ...manualZero.policy!, method: "recipe_derived", amountMicros: null, amountMajor: null, currency: null },
  resolution: {
    status: "recipe_derived_reference",
    amount: "unavailable",
    reason: "recipe_engine_not_available",
    unit: "each",
    taxBasis: "net",
    effectiveFrom: "2026-11-01",
    policyPublicId: "vrc_1",
    revision: 2,
  },
};

const noop = () => undefined;

function inputValues(html: string) {
  return [...html.matchAll(/<input[^>]*value="([^"]*)"/g)].map((match) => match[1]);
}

describe("SellingTaxEditor", () => {
  it("never pre-fills a rate or basis when nothing is recorded", () => {
    const html = renderToStaticMarkup(
      createElement(SellingTaxEditor, {
        locale: "en",
        value: { priceTaxBasis: null, taxRateBasisPoints: null, taxProvenance: null },
        disabled: false,
        onSave: noop,
      }),
    );
    expect(inputValues(html)).toEqual([""]);
    expect(html).toContain('<option value="" selected="">Not recorded</option>');
    expect(html).not.toContain("500");
    expect(html).not.toMatch(/value="5"/);
  });

  it("shows a whole percent as percent and any other rate as exact basis points", () => {
    const whole = renderToStaticMarkup(
      createElement(SellingTaxEditor, {
        locale: "en",
        value: { priceTaxBasis: "inclusive", taxRateBasisPoints: 500, taxProvenance: "operator_entered" },
        disabled: false,
        onSave: noop,
      }),
    );
    expect(inputValues(whole)).toEqual(["5"]);
    expect(whole).toContain('<option value="percent" selected="">Percent</option>');
    expect(whole).toContain("Staff entry");

    const fractional = renderToStaticMarkup(
      createElement(SellingTaxEditor, {
        locale: "en",
        value: { priceTaxBasis: "exclusive", taxRateBasisPoints: 525, taxProvenance: null },
        disabled: false,
        onSave: noop,
      }),
    );
    expect(inputValues(fractional)).toEqual(["525"]);
    expect(fractional).toContain('<option value="basis_points" selected="">Basis points</option>');

    const zero = renderToStaticMarkup(
      createElement(SellingTaxEditor, {
        locale: "en",
        value: { priceTaxBasis: "exclusive", taxRateBasisPoints: 0, taxProvenance: null },
        disabled: false,
        onSave: noop,
      }),
    );
    expect(inputValues(zero)).toEqual(["0"]);
  });

  it("renders Arabic labels", () => {
    const html = renderToStaticMarkup(
      createElement(SellingTaxEditor, {
        locale: "ar",
        value: { priceTaxBasis: "unconfirmed", taxRateBasisPoints: null, taxProvenance: null },
        disabled: true,
        onSave: noop,
      }),
    );
    expect(html).toContain("أساس ضريبة السعر");
    expect(html).toContain("نسبة الضريبة");
    expect(html).not.toContain("Price tax basis");
  });
});

describe("ReferenceCostEditor", () => {
  it("shows no cost, not a zero cost, when there is no policy", () => {
    const html = renderToStaticMarkup(
      createElement(ReferenceCostEditor, { locale: "en", referenceCost: noPolicy, disabled: false, onApply: noop }),
    );
    expect(html).toContain("No cost policy");
    expect(inputValues(html)).toEqual(["", "", "", "", ""]);
    expect(html).not.toContain("Clear cost policy");
  });

  it("keeps a known zero manual cost visible as 0 with its revision", () => {
    const html = renderToStaticMarkup(
      createElement(ReferenceCostEditor, { locale: "en", referenceCost: manualZero, disabled: false, onApply: noop }),
    );
    expect(html).toContain("Manual cost: 0 AED");
    expect(html).toContain("Revision 2, effective from 2026-11-01");
    expect(inputValues(html)[0]).toBe("0");
    expect(html).toContain("Clear cost policy");
  });

  it("explains that recipe-derived is a policy, not an amount", () => {
    const html = renderToStaticMarkup(
      createElement(ReferenceCostEditor, { locale: "ar", referenceCost: recipe, disabled: false, onApply: noop }),
    );
    expect(html).toContain("مشتقة من الوصفة");
    expect(html).toContain("سياسة وليست مبلغًا");
    expect(inputValues(html)[0]).toBe("");
  });
});

describe("ReferenceMarginLine and summary", () => {
  it("shows an unavailable reason, never 0 or 100%", () => {
    const html = renderToStaticMarkup(
      createElement(ReferenceMarginLine, {
        locale: "en",
        margin: { status: "unavailable", reason: "recipe_derived_cost_not_computed" },
      }),
    );
    expect(html).toContain("Unavailable: recipe-derived cost not computed yet");
    expect(html).not.toMatch(/\b0\.00\b|100%/);
  });

  it("shows an exact available margin with its basis", () => {
    const html = renderToStaticMarkup(
      createElement(ReferenceMarginLine, {
        locale: "en",
        margin: {
          status: "available",
          basis: "net",
          currency: "AED",
          priceMicros: "9523810",
          costMicros: "4000000",
          marginMicros: "5523810",
          marginMajor: "5.52381",
          rounding: "half_up_micros",
        },
      }),
    );
    expect(html).toContain("5.52381 AED, net of tax");
    expect(html).toContain("rounded half up");
  });

  it("summarises the default variant read-only in Arabic", () => {
    const html = renderToStaticMarkup(
      createElement(SellableTaxCostSummary, {
        locale: "ar",
        tax: { priceTaxBasis: "inclusive", taxRateBasisPoints: 500, taxProvenance: "imported" },
        referenceCost: noPolicy,
        referenceMargin: { status: "unavailable", reason: "cost_unavailable" },
      }),
    );
    expect(html).toContain("السعر شامل الضريبة");
    expect(html).toContain("5%");
    expect(html).toContain("غير متاح");
    expect(html).not.toContain("<input");
  });
});
