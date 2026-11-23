import { describe, expect, it } from "vitest";

import { InventoryError } from "@/lib/inventory/errors";
import {
  assertQuantityPrecision,
  equals,
  fromMicros,
  inverse,
  isExactAt,
  mul,
  parseFactorMicros,
  rational,
  toDecimalString,
  toExactDecimalString,
} from "@/lib/inventory/quantity-math";

const big = (value: number | string) => BigInt(value);

describe("exact rationals", () => {
  it("multiplies and inverts without losing precision", () => {
    const twelve = fromMicros(big(12_000_000));
    const third = fromMicros(big(333_333));
    expect(mul(twelve, inverse(twelve))).toEqual(rational(big(1)));
    expect(inverse(twelve)).toEqual({ numerator: big(1), denominator: big(12) });
    // 0.333333 × 3 is 0.999999, not 1: the stored factor is used as written.
    expect(mul(third, rational(big(3)))).toEqual({ numerator: big(999_999), denominator: big(1_000_000) });
    expect(equals(mul(fromMicros(big(1_000_000_000)), fromMicros(big(1_000))), rational(big(1)))).toBe(true);
  });

  it("normalises sign and common factors", () => {
    expect(rational(big(10), big(-4))).toEqual({ numerator: big(-5), denominator: big(2) });
    expect(() => rational(big(1), big(0))).toThrow();
    expect(() => inverse(rational(big(0)))).toThrow();
  });
});

describe("half-up display rounding", () => {
  it("rounds 1/12 to 0.083 and 0.0835 to 0.084 at 3 places", () => {
    expect(toDecimalString(rational(big(1), big(12)), 3)).toBe("0.083");
    expect(toDecimalString(rational(big(835), big(10_000)), 3)).toBe("0.084");
    expect(toDecimalString(rational(big(8345), big(100_000)), 3)).toBe("0.083");
  });

  it("pads to the requested places and rounds whole units at 0 places", () => {
    expect(toDecimalString(rational(big(12)), 0)).toBe("12");
    expect(toDecimalString(rational(big(3), big(100)), 3)).toBe("0.030");
    expect(toDecimalString(rational(big(5), big(2)), 0)).toBe("3");
    expect(toDecimalString(rational(big(1), big(12)), 6)).toBe("0.083333");
    expect(toDecimalString(rational(big(2), big(3)), 6)).toBe("0.666667");
  });

  it("knows when a value is exact at a precision", () => {
    expect(isExactAt(rational(big(1), big(8)), 3)).toBe(true);
    expect(isExactAt(rational(big(1), big(8)), 2)).toBe(false);
    expect(toExactDecimalString(rational(big(1), big(8)))).toBe("0.125");
    expect(toExactDecimalString(rational(big(1), big(12)))).toBeNull();
    expect(toExactDecimalString(rational(big(1000)))).toBe("1000");
  });
});

describe("factor parsing", () => {
  it("accepts positive decimals with up to six places as exact micros", () => {
    expect(parseFactorMicros("12")).toEqual({ status: "ok", micros: big(12_000_000) });
    expect(parseFactorMicros("0.083333")).toEqual({ status: "ok", micros: big(83_333) });
    expect(parseFactorMicros(" 1.5000000 ")).toEqual({ status: "ok", micros: big(1_500_000) });
    expect(parseFactorMicros("0.000001")).toEqual({ status: "ok", micros: big(1) });
  });

  it("rejects zero, negative, exponent, grouped, seven-decimal and non-string factors", () => {
    expect(parseFactorMicros("0")).toEqual({ status: "invalid", code: "factor_not_positive" });
    expect(parseFactorMicros("0.000000")).toEqual({ status: "invalid", code: "factor_not_positive" });
    expect(parseFactorMicros("-1")).toEqual({ status: "invalid", code: "factor_not_positive" });
    expect(parseFactorMicros("1e3")).toEqual({ status: "invalid", code: "factor_invalid" });
    expect(parseFactorMicros("1,000")).toEqual({ status: "invalid", code: "factor_invalid" });
    expect(parseFactorMicros("0.0000001")).toEqual({ status: "invalid", code: "factor_too_precise" });
    expect(parseFactorMicros("")).toEqual({ status: "invalid", code: "factor_invalid" });
    expect(parseFactorMicros(12)).toEqual({ status: "invalid", code: "factor_invalid" });
    expect(parseFactorMicros("99999999999999")).toEqual({ status: "invalid", code: "factor_invalid" });
  });
});

describe("assertQuantityPrecision", () => {
  const kg = { decimalPlaces: 3 };
  it("accepts quantities within the unit's places, ignoring trailing zeros", () => {
    expect(() => assertQuantityPrecision(kg, "1.250")).not.toThrow();
    expect(() => assertQuantityPrecision(kg, "1.2500")).not.toThrow();
    expect(() => assertQuantityPrecision({ decimalPlaces: 0 }, "12")).not.toThrow();
  });

  it("rejects extra places and non-decimal text with typed errors", () => {
    expect(() => assertQuantityPrecision(kg, "1.2501")).toThrow(
      expect.objectContaining({ code: "quantity_too_precise", statusCode: 400 }),
    );
    expect(() => assertQuantityPrecision({ decimalPlaces: 0 }, "1.5")).toThrow(InventoryError);
    expect(() => assertQuantityPrecision(kg, "1e3")).toThrow(expect.objectContaining({ code: "quantity_invalid" }));
  });
});
