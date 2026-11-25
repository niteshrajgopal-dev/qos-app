import { describe, expect, it } from "vitest";

import { micros } from "@/lib/inventory/test-units";
import { isLiveOn, previousDay, versionPhase } from "@/lib/recipes/dates";
import { assertMicrosPrecision, parseOptionalLabel, parseUnitQuantity } from "@/lib/recipes/shared";

function codeOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code;
  }
  return null;
}

describe("recipe quantity and yield parsing", () => {
  const grams = { decimalPlaces: 0 };
  const litres = { decimalPlaces: 3 };

  it("parses exact positive quantities into micros", () => {
    expect(parseUnitQuantity("250", grams, "quantity", "quantity")).toBe(micros("250"));
    expect(parseUnitQuantity(" 0.125 ", litres, "quantity", "quantity")).toBe(micros("0.125"));
    expect(parseUnitQuantity("1.250", litres, "yieldQuantity", "yield")).toBe(micros("1.25"));
  });

  it("refuses invalid, zero, negative and over-precise values instead of rounding", () => {
    expect(codeOf(() => parseUnitQuantity("abc", grams, "quantity", "quantity"))).toBe("quantity_invalid");
    expect(codeOf(() => parseUnitQuantity(250, grams, "quantity", "quantity"))).toBe("quantity_invalid");
    expect(codeOf(() => parseUnitQuantity("0", grams, "quantity", "quantity"))).toBe("quantity_not_positive");
    expect(codeOf(() => parseUnitQuantity("-2", grams, "quantity", "quantity"))).toBe("quantity_not_positive");
    expect(codeOf(() => parseUnitQuantity("2.5", grams, "quantity", "quantity"))).toBe("quantity_too_precise");
    expect(codeOf(() => parseUnitQuantity("0.0001", litres, "quantity", "quantity"))).toBe("quantity_too_precise");
    expect(codeOf(() => parseUnitQuantity("0.0000001", null, "yieldQuantity", "yield"))).toBe("yield_too_precise");
    expect(codeOf(() => parseUnitQuantity("", null, "yieldQuantity", "yield"))).toBe("yield_invalid");
    expect(codeOf(() => parseUnitQuantity("0", litres, "yieldQuantity", "yield"))).toBe("yield_not_positive");
  });

  it("checks a stored yield against a newly chosen unit", () => {
    expect(codeOf(() => assertMicrosPrecision(micros("2.5"), grams, "yieldQuantity", "yield"))).toBe("yield_too_precise");
    expect(codeOf(() => assertMicrosPrecision(micros("2.5"), litres, "yieldQuantity", "yield"))).toBeNull();
  });

  it("trims labels and step text, treats blank as none and refuses long text", () => {
    expect(parseOptionalLabel("  Steam  ", "labelEn", 120, "label_too_long")).toBe("Steam");
    expect(parseOptionalLabel("   ", "labelEn", 120, "label_too_long")).toBeNull();
    expect(codeOf(() => parseOptionalLabel("x".repeat(121), "labelEn", 120, "label_too_long"))).toBe("label_too_long");
    expect(codeOf(() => parseOptionalLabel("x".repeat(1001), "textEn", 1000, "step_text_too_long"))).toBe("step_text_too_long");
  });
});

describe("recipe business dates", () => {
  it("treats ranges as half-open", () => {
    expect(isLiveOn("2026-11-01", "2026-11-05", "2026-11-01")).toBe(true);
    expect(isLiveOn("2026-11-01", "2026-11-05", "2026-11-04")).toBe(true);
    expect(isLiveOn("2026-11-01", "2026-11-05", "2026-11-05")).toBe(false);
    expect(isLiveOn("2026-11-01", null, "2030-01-01")).toBe(true);
    expect(isLiveOn(null, null, "2026-11-01")).toBe(false);
  });

  it("derives current, scheduled and ended only for approved versions", () => {
    const approved = { status: "approved" as const, effectiveFrom: "2026-11-01", effectiveTo: "2026-12-01" };
    expect(versionPhase(approved, "2026-11-10")).toBe("current");
    expect(versionPhase(approved, "2026-10-31")).toBe("scheduled");
    expect(versionPhase(approved, "2026-12-01")).toBe("ended");
    expect(versionPhase({ status: "draft", effectiveFrom: null, effectiveTo: null }, "2026-11-10")).toBe("draft");
    expect(versionPhase({ status: "discarded", effectiveFrom: null, effectiveTo: null }, "2026-11-10")).toBe("discarded");
  });

  it("names the last covered day of a superseded version", () => {
    expect(previousDay("2026-12-01")).toBe("2026-11-30");
    expect(previousDay("2027-01-01")).toBe("2026-12-31");
  });
});
