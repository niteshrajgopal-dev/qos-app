import { describe, expect, it } from "vitest";

import {
  formatDecimal,
  minorDigitsFor,
  parseDecimalText,
  parseWholeNumber,
  toBasisPoints,
  toMinorUnits,
} from "@/lib/workbook/foodics-menu/numbers";

function minor(text: string, digits: number) {
  const parsed = parseDecimalText(text);
  if (!parsed.ok) return "invalid";
  const converted = toMinorUnits(parsed.value, digits);
  return converted.ok ? converted.minor : converted.code;
}

describe("exact decimal parsing", () => {
  it.each([
    ["12.50", { sign: "", integer: "12", fraction: "50" }],
    ["12", { sign: "", integer: "12", fraction: "" }],
    [" 0.5 ", { sign: "", integer: "0", fraction: "5" }],
    ["-3.25", { sign: "-", integer: "3", fraction: "25" }],
    ["1,250.75", { sign: "", integer: "1250", fraction: "75" }],
    ["12,345,678", { sign: "", integer: "12345678", fraction: "" }],
  ])("reads %s", (text, value) => {
    expect(parseDecimalText(text)).toEqual({ ok: true, value, digitsNormalized: false });
  });

  it("reads Arabic-Indic and extended Arabic-Indic digits and the Arabic decimal separator, and says so", () => {
    expect(parseDecimalText("١٢٫٥٠")).toEqual({ ok: true, value: { sign: "", integer: "12", fraction: "50" }, digitsNormalized: true });
    expect(parseDecimalText("۱۸")).toEqual({ ok: true, value: { sign: "", integer: "18", fraction: "" }, digitsNormalized: true });
  });

  it.each(["", "abc", "12.5.0", "1,25", "12,50", "1.2e3", "0x10", "12 AED", "1234567890123", "1.1234567", "--1", "+5"])(
    "refuses %j",
    (text) => {
      expect(parseDecimalText(text)).toEqual({ ok: false });
    },
  );

  it("keeps the fraction digits it was given", () => {
    const parsed = parseDecimalText("4.20");
    expect(parsed.ok && formatDecimal(parsed.value)).toBe("4.20");
  });
});

describe("major units to minor units", () => {
  it.each([
    ["12.50", 2, "1250"],
    ["12.5", 2, "1250"],
    ["12", 2, "1200"],
    ["0.05", 2, "5"],
    ["0", 2, "0"],
    ["12.500", 2, "1250"],
    ["1.234", 3, "1234"],
    ["1.5", 3, "1500"],
    ["500", 0, "500"],
    ["99999999999.99", 2, "9999999999999"],
  ])("%s with %i digits is %s", (text, digits, expected) => {
    expect(minor(text, digits)).toBe(expected);
  });

  it("never rounds: too many fraction digits and negative prices are errors", () => {
    expect(minor("12.505", 2)).toBe("price_precision");
    expect(minor("1.2345", 3)).toBe("price_precision");
    expect(minor("12.5", 0)).toBe("price_precision");
    expect(minor("-1.00", 2)).toBe("negative_amount");
    expect(minor("-0", 2)).toBe("0");
  });

  it("knows the minor digits of common currencies and nothing else", () => {
    expect(minorDigitsFor("AED")).toBe(2);
    expect(minorDigitsFor("sar")).toBe(2);
    expect(minorDigitsFor("KWD")).toBe(3);
    expect(minorDigitsFor("JPY")).toBe(0);
    expect(minorDigitsFor("XYZ")).toBeNull();
  });
});

describe("percent to basis points", () => {
  it.each([
    ["5", "500"],
    ["5%", "500"],
    ["5.0 %", "500"],
    ["0.5%", "50"],
    ["12.25%", "1225"],
    ["٥٪", "500"],
  ])("%s is %s basis points", (text, expected) => {
    const result = toBasisPoints(text);
    expect(result.ok && result.basisPoints).toBe(expected);
  });

  it("refuses finer than 0.01% and keeps text it cannot read as unresolved", () => {
    expect(toBasisPoints("5.125%")).toEqual({ ok: false, code: "percent_precision" });
    expect(toBasisPoints("VAT")).toEqual({ ok: false, code: "tax_unresolved" });
    expect(toBasisPoints("Standard")).toEqual({ ok: false, code: "tax_unresolved" });
    expect(toBasisPoints("-5%")).toEqual({ ok: false, code: "negative_amount" });
  });
});

describe("whole numbers", () => {
  it("accepts non-negative integers only", () => {
    expect(parseWholeNumber("320")).toBe("320");
    expect(parseWholeNumber("007")).toBe("7");
    expect(parseWholeNumber("2.0")).toBe("2");
    expect(parseWholeNumber("2.5")).toBeNull();
    expect(parseWholeNumber("-1")).toBeNull();
    expect(parseWholeNumber("many")).toBeNull();
  });
});
