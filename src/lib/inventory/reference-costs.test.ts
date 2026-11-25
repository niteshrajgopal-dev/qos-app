import { describe, expect, it } from "vitest";

import { parseCostAmount, parseReferenceCostInput } from "@/lib/inventory/reference-costs";

function failure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    const typed = error as { statusCode?: number; code?: string; field?: string };
    return { statusCode: typed.statusCode, code: typed.code, field: typed.field };
  }
  throw new Error("expected the parser to refuse the input");
}

const VALID = { amount: "12.5", taxBasis: "net", source: "manual", expectedRevision: null };

describe("parseCostAmount", () => {
  it("refuses a blank, missing or null amount instead of treating it as zero", () => {
    for (const value of [undefined, null, "", "   "]) {
      expect(failure(() => parseCostAmount(value))).toEqual({ statusCode: 400, code: "amount_required", field: "amount" });
    }
  });

  it("accepts an explicit zero as a known zero", () => {
    expect(parseCostAmount("0")).toBe(BigInt(0));
    expect(parseCostAmount("0.000000")).toBe(BigInt(0));
  });

  it("keeps six decimal places exactly and never rounds to cents", () => {
    expect(parseCostAmount("12.345678")).toBe(BigInt(12_345_678));
    expect(parseCostAmount("0.005")).toBe(BigInt(5_000));
    expect(parseCostAmount(" 60 ")).toBe(BigInt(60_000_000));
  });

  it("refuses more than six decimal places instead of rounding", () => {
    expect(failure(() => parseCostAmount("1.2345678"))).toEqual({ statusCode: 400, code: "amount_too_precise", field: "amount" });
  });

  it("refuses negative amounts and anything that is not a plain decimal", () => {
    expect(failure(() => parseCostAmount("-1"))).toMatchObject({ code: "amount_negative" });
    for (const value of ["1,000", "1e3", "abc", "12.5 AED", 12.5, true]) {
      expect(failure(() => parseCostAmount(value)), String(value)).toMatchObject({ code: "amount_invalid" });
    }
  });
});

describe("parseReferenceCostInput", () => {
  it("parses every field and leaves optional ones null", () => {
    expect(parseReferenceCostInput(VALID)).toEqual({
      amountMicros: BigInt(12_500_000),
      currency: null,
      unitPublicId: null,
      taxBasis: "net",
      source: "manual",
      sourceReference: null,
      effectiveFrom: null,
      expectedRevision: null,
    });
    expect(
      parseReferenceCostInput({
        ...VALID,
        currency: "aed",
        unitPublicId: "unit_kg_1",
        taxBasis: "unconfirmed",
        source: "supplier_quote",
        sourceReference: "  Q-17 ",
        effectiveFrom: "2026-12-01",
        expectedRevision: 3,
      }),
    ).toEqual({
      amountMicros: BigInt(12_500_000),
      currency: "AED",
      unitPublicId: "unit_kg_1",
      taxBasis: "unconfirmed",
      source: "supplier_quote",
      sourceReference: "Q-17",
      effectiveFrom: "2026-12-01",
      expectedRevision: 3,
    });
  });

  it("accepts only the net, gross and unconfirmed bases, lower case", () => {
    for (const taxBasis of ["net", "gross", "unconfirmed"]) {
      expect(parseReferenceCostInput({ ...VALID, taxBasis }).taxBasis).toBe(taxBasis);
    }
    for (const taxBasis of ["NET", "inclusive", "", undefined]) {
      expect(failure(() => parseReferenceCostInput({ ...VALID, taxBasis }))).toMatchObject({ code: "tax_basis_invalid", field: "taxBasis" });
    }
  });

  it("accepts only the manual, supplier quote and invoice sources", () => {
    for (const source of ["manual", "supplier_quote", "invoice"]) {
      expect(parseReferenceCostInput({ ...VALID, source }).source).toBe(source);
    }
    for (const source of ["receipt_derived", "average", undefined]) {
      expect(failure(() => parseReferenceCostInput({ ...VALID, source }))).toMatchObject({ code: "cost_source_invalid", field: "source" });
    }
  });

  it("limits the source reference to 200 characters", () => {
    expect(parseReferenceCostInput({ ...VALID, sourceReference: "x".repeat(200) }).sourceReference).toHaveLength(200);
    expect(failure(() => parseReferenceCostInput({ ...VALID, sourceReference: "x".repeat(201) }))).toEqual({
      statusCode: 400,
      code: "text_too_long",
      field: "sourceReference",
    });
  });

  it("requires expectedRevision: null for an item without a cost, otherwise a positive integer", () => {
    const { expectedRevision, ...withoutRevision } = VALID;
    void expectedRevision;
    expect(failure(() => parseReferenceCostInput(withoutRevision))).toMatchObject({ code: "expected_version_required" });
    for (const value of [0, -1, 1.5, "1"]) {
      expect(failure(() => parseReferenceCostInput({ ...VALID, expectedRevision: value }))).toMatchObject({
        code: "expected_version_required",
        field: "expectedRevision",
      });
    }
    expect(parseReferenceCostInput({ ...VALID, expectedRevision: 2 }).expectedRevision).toBe(2);
  });

  it("checks the amount before anything else, so a blank amount is always amount_required", () => {
    expect(failure(() => parseReferenceCostInput({ amount: "" }))).toMatchObject({ code: "amount_required" });
  });

  it("refuses malformed dates and currencies", () => {
    expect(failure(() => parseReferenceCostInput({ ...VALID, effectiveFrom: "01/12/2026" }))).toMatchObject({ code: "effective_from_invalid" });
    expect(failure(() => parseReferenceCostInput({ ...VALID, currency: "dirham" }))).toMatchObject({ code: "currency_not_supported" });
  });
});
