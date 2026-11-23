import { describe, expect, it } from "vitest";

import {
  basisPointsAsWholePercent,
  calendarDateInTimeZone,
  convertFoodicsProductCost,
  currencyMinorExponent,
  isCalendarDate,
  majorToMicrosExact,
  majorToMinorExact,
  microsToMajorString,
  parseBasisPointsCell,
  parseCostTaxBasisToken,
  parseMicrosInteger,
  parseSellingTaxBasisToken,
  parseSourceTaxPercent,
  percentInputToBasisPoints,
} from "@/lib/catalogue/selling-tax-cost";

describe("parseSourceTaxPercent (Foodics tax %)", () => {
  it("reads an Excel percentage fraction exactly: 0.05 → 500 bps", () => {
    expect(parseSourceTaxPercent("0.05")).toEqual({ status: "rate", basisPoints: 500 });
    expect(parseSourceTaxPercent("0.16")).toEqual({ status: "rate", basisPoints: 1600 });
    expect(parseSourceTaxPercent("0.07")).toEqual({ status: "rate", basisPoints: 700 });
    expect(parseSourceTaxPercent("0.055")).toEqual({ status: "rate", basisPoints: 550 });
    expect(parseSourceTaxPercent("1")).toEqual({ status: "rate", basisPoints: 10000 });
  });

  it("keeps a known 0% rate distinct from blank", () => {
    expect(parseSourceTaxPercent("0")).toEqual({ status: "rate", basisPoints: 0 });
    expect(parseSourceTaxPercent("0.00")).toEqual({ status: "rate", basisPoints: 0 });
    expect(parseSourceTaxPercent("")).toEqual({ status: "blank" });
    expect(parseSourceTaxPercent("   ")).toEqual({ status: "blank" });
    expect(parseSourceTaxPercent(null)).toEqual({ status: "blank" });
  });

  it("reads explicit percent text: 5% / 16% / 7%", () => {
    expect(parseSourceTaxPercent("5%")).toEqual({ status: "rate", basisPoints: 500 });
    expect(parseSourceTaxPercent("16%")).toEqual({ status: "rate", basisPoints: 1600 });
    expect(parseSourceTaxPercent(" 7 % ")).toEqual({ status: "rate", basisPoints: 700 });
    expect(parseSourceTaxPercent("5.25%")).toEqual({ status: "rate", basisPoints: 525 });
    expect(parseSourceTaxPercent("0%")).toEqual({ status: "rate", basisPoints: 0 });
  });

  it("diagnoses a bare number above one instead of guessing percent or basis points", () => {
    expect(parseSourceTaxPercent("5")).toEqual({ status: "ambiguous", reason: "bare_number_above_one", sourceText: "5" });
    expect(parseSourceTaxPercent("16")).toEqual({ status: "ambiguous", reason: "bare_number_above_one", sourceText: "16" });
    expect(parseSourceTaxPercent("1.5")).toEqual({ status: "ambiguous", reason: "bare_number_above_one", sourceText: "1.5" });
  });

  it("leaves tax-group names and other text unresolved with the source text", () => {
    expect(parseSourceTaxPercent("VAT Standard")).toEqual({
      status: "unresolved",
      reason: "not_numeric",
      sourceText: "VAT Standard",
    });
    expect(parseSourceTaxPercent("five")).toMatchObject({ status: "unresolved" });
  });

  it("rejects negative values and precision finer than one basis point", () => {
    expect(parseSourceTaxPercent("-0.05")).toMatchObject({ status: "invalid", reason: "negative" });
    expect(parseSourceTaxPercent("-5%")).toMatchObject({ status: "invalid", reason: "negative" });
    expect(parseSourceTaxPercent("0.05555")).toMatchObject({ status: "invalid", reason: "too_precise" });
    expect(parseSourceTaxPercent("5.255%")).toMatchObject({ status: "invalid", reason: "too_precise" });
  });
});

describe("parseBasisPointsCell (QOS workbook tax_rate_basis_points)", () => {
  it("reads integer basis points as is, 0 included", () => {
    expect(parseBasisPointsCell("500")).toEqual({ status: "rate", basisPoints: 500 });
    expect(parseBasisPointsCell("0")).toEqual({ status: "rate", basisPoints: 0 });
    expect(parseBasisPointsCell("")).toEqual({ status: "blank" });
  });

  it("rejects fractions, negatives and text", () => {
    expect(parseBasisPointsCell("5.5")).toMatchObject({ status: "invalid", reason: "not_integer" });
    expect(parseBasisPointsCell("-1")).toMatchObject({ status: "invalid", reason: "negative" });
    expect(parseBasisPointsCell("5%")).toMatchObject({ status: "unresolved" });
  });
});

describe("percentInputToBasisPoints (staff UI)", () => {
  it("treats the labelled percent field as percent", () => {
    expect(percentInputToBasisPoints("5")).toEqual({ status: "rate", basisPoints: 500 });
    expect(percentInputToBasisPoints("5.25")).toEqual({ status: "rate", basisPoints: 525 });
    expect(percentInputToBasisPoints("0")).toEqual({ status: "rate", basisPoints: 0 });
    expect(percentInputToBasisPoints("")).toEqual({ status: "blank" });
    expect(percentInputToBasisPoints("5.125")).toMatchObject({ status: "invalid", reason: "too_precise" });
  });

  it("shows a whole percent only when the stored rate is one", () => {
    expect(basisPointsAsWholePercent(500)).toBe("5");
    expect(basisPointsAsWholePercent(0)).toBe("0");
    expect(basisPointsAsWholePercent(525)).toBeNull();
    expect(basisPointsAsWholePercent(null)).toBeNull();
  });
});

describe("tax basis tokens", () => {
  it("accepts QOS values, Foodics Inclusive/Exclusive and workbook GROSS/NET aliases case-insensitively", () => {
    expect(parseSellingTaxBasisToken("inclusive")).toEqual({ status: "ok", basis: "inclusive" });
    expect(parseSellingTaxBasisToken("Inclusive")).toEqual({ status: "ok", basis: "inclusive" });
    expect(parseSellingTaxBasisToken(" EXCLUSIVE ")).toEqual({ status: "ok", basis: "exclusive" });
    expect(parseSellingTaxBasisToken("GROSS")).toEqual({ status: "ok", basis: "inclusive" });
    expect(parseSellingTaxBasisToken("net")).toEqual({ status: "ok", basis: "exclusive" });
    expect(parseSellingTaxBasisToken("UNCONFIRMED")).toEqual({ status: "ok", basis: "unconfirmed" });
    expect(parseSellingTaxBasisToken("")).toEqual({ status: "blank" });
  });

  it("diagnoses unknown tokens instead of defaulting to exclusive", () => {
    expect(parseSellingTaxBasisToken("tax  included")).toEqual({ status: "unknown", sourceText: "tax included" });
    expect(parseSellingTaxBasisToken("VAT")).toEqual({ status: "unknown", sourceText: "VAT" });
  });

  it("reads cost bases NET/GROSS/UNCONFIRMED", () => {
    expect(parseCostTaxBasisToken("NET")).toEqual({ status: "ok", basis: "net" });
    expect(parseCostTaxBasisToken("gross")).toEqual({ status: "ok", basis: "gross" });
    expect(parseCostTaxBasisToken("Unconfirmed")).toEqual({ status: "ok", basis: "unconfirmed" });
    expect(parseCostTaxBasisToken("inclusive")).toEqual({ status: "unknown", sourceText: "inclusive" });
  });
});

describe("majorToMinorExact", () => {
  it("converts AED major units exactly", () => {
    expect(currencyMinorExponent("AED")).toBe(2);
    expect(majorToMinorExact("12.50", "AED")).toEqual({ status: "ok", value: 1250 });
    expect(majorToMinorExact("12.5", "AED")).toEqual({ status: "ok", value: 1250 });
    expect(majorToMinorExact("0.10", "AED")).toEqual({ status: "ok", value: 10 });
    expect(majorToMinorExact("19.99", "AED")).toEqual({ status: "ok", value: 1999 });
    expect(majorToMinorExact("12.500", "AED")).toEqual({ status: "ok", value: 1250 });
  });

  it("rejects precision beyond the currency exponent rather than rounding", () => {
    expect(majorToMinorExact("12.505", "AED")).toMatchObject({ status: "invalid", reason: "too_precise" });
    expect(majorToMinorExact("1.5", "JPY")).toMatchObject({ status: "invalid", reason: "too_precise" });
    expect(majorToMinorExact("1.005", "KWD")).toEqual({ status: "ok", value: 1005 });
  });

  it("keeps blank and zero distinct and rejects bad input", () => {
    expect(majorToMinorExact("0", "AED")).toEqual({ status: "ok", value: 0 });
    expect(majorToMinorExact("", "AED")).toEqual({ status: "blank" });
    expect(majorToMinorExact("-1", "AED")).toMatchObject({ status: "invalid", reason: "negative" });
    expect(majorToMinorExact("1e3", "AED")).toMatchObject({ status: "invalid", reason: "not_a_decimal" });
    expect(majorToMinorExact("1", "XX")).toMatchObject({ status: "invalid", reason: "unknown_currency" });
  });
});

describe("majorToMicrosExact", () => {
  it("converts up to six decimals exactly", () => {
    expect(majorToMicrosExact("1.234567")).toEqual({ status: "ok", value: BigInt(1_234_567) });
    expect(majorToMicrosExact("1")).toEqual({ status: "ok", value: BigInt(1_000_000) });
    expect(majorToMicrosExact("0.01")).toEqual({ status: "ok", value: BigInt(10_000) });
  });

  it("rejects a seventh decimal place", () => {
    expect(majorToMicrosExact("1.2345678")).toMatchObject({ status: "invalid", reason: "too_precise" });
  });

  it("keeps 0 micros distinct from blank", () => {
    expect(majorToMicrosExact("0")).toEqual({ status: "ok", value: BigInt(0) });
    expect(majorToMicrosExact("")).toEqual({ status: "blank" });
  });

  it("formats micros back exactly", () => {
    expect(microsToMajorString(BigInt(1_234_567))).toBe("1.234567");
    expect(microsToMajorString(BigInt(2_500_000))).toBe("2.5");
    expect(microsToMajorString(BigInt(0))).toBe("0");
    expect(microsToMajorString(BigInt(2_500_000), 2)).toBe("2.50");
    expect(microsToMajorString(BigInt(-1_500_000), 2)).toBe("-1.50");
  });

  it("parses JSON integer micros without floats", () => {
    expect(parseMicrosInteger("9007199254740993")).toBe(BigInt("9007199254740993"));
    expect(parseMicrosInteger(0)).toBe(BigInt(0));
    expect(parseMicrosInteger(1.5)).toBeNull();
    expect(parseMicrosInteger("-1")).toBeNull();
  });
});

describe("convertFoodicsProductCost", () => {
  it("maps a numeric cost to a manual amount and keeps known zero", () => {
    expect(convertFoodicsProductCost("4.25")).toEqual({ status: "manual", amountMicros: BigInt(4_250_000) });
    expect(convertFoodicsProductCost("0")).toEqual({ status: "manual", amountMicros: BigInt(0) });
  });

  it("maps a blank cost to recipe-derived pending review", () => {
    expect(convertFoodicsProductCost("")).toEqual({
      status: "recipe_derived_pending_review",
      reason: "foodics_blank_product_cost",
    });
    expect(convertFoodicsProductCost(undefined)).toMatchObject({ status: "recipe_derived_pending_review" });
  });

  it("diagnoses unusable costs", () => {
    expect(convertFoodicsProductCost("abc")).toMatchObject({ status: "invalid", reason: "not_a_decimal" });
    expect(convertFoodicsProductCost("1.2345678")).toMatchObject({ status: "invalid", reason: "too_precise" });
  });
});

describe("dates", () => {
  it("uses the tenant time zone for today", () => {
    const lateUtc = new Date("2026-11-21T22:30:00Z");
    expect(calendarDateInTimeZone(lateUtc, "Asia/Dubai")).toBe("2026-11-22");
    expect(calendarDateInTimeZone(lateUtc, "UTC")).toBe("2026-11-21");
  });

  it("validates calendar dates", () => {
    expect(isCalendarDate("2026-11-22")).toBe(true);
    expect(isCalendarDate("2026-02-30")).toBe(false);
    expect(isCalendarDate("22/11/2026")).toBe(false);
  });
});
