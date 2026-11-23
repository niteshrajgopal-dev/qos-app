import { majorToMicrosExact, microsToMajorString } from "@/lib/catalogue/selling-tax-cost";
import { InventoryError } from "@/lib/inventory/errors";

/* QOS-195 exact quantity arithmetic. Factors are stored as integer micros
   (six decimal places) and combined as bigint rationals, so a chain such as
   packet → box → piece or the inverse 1/12 is exact. Rounding happens only
   when a value is displayed, half-up to the unit's decimal places (D5
   assumption). Nothing here uses IEEE floats. */

const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
const TWO = BigInt(2);
export const MICROS_PER_UNIT = BigInt(1_000_000);

export type Rational = { numerator: bigint; denominator: bigint };

function gcd(a: bigint, b: bigint): bigint {
  let x = a < ZERO ? -a : a;
  let y = b < ZERO ? -b : b;
  while (y !== ZERO) {
    [x, y] = [y, x % y];
  }
  return x;
}

function pow10(places: number): bigint {
  let result = ONE;
  for (let index = 0; index < places; index += 1) {
    result *= TEN;
  }
  return result;
}

export function rational(numerator: bigint, denominator: bigint = ONE): Rational {
  if (denominator === ZERO) {
    throw new Error("Rational denominator cannot be zero.");
  }
  const sign = denominator < ZERO ? -ONE : ONE;
  const divisor = gcd(numerator, denominator) || ONE;
  return { numerator: (sign * numerator) / divisor, denominator: (sign * denominator) / divisor };
}

export function fromMicros(micros: bigint): Rational {
  return rational(micros, MICROS_PER_UNIT);
}

export function mul(a: Rational, b: Rational): Rational {
  return rational(a.numerator * b.numerator, a.denominator * b.denominator);
}

export function inverse(value: Rational): Rational {
  if (value.numerator === ZERO) {
    throw new Error("Zero has no inverse.");
  }
  return rational(value.denominator, value.numerator);
}

export function equals(a: Rational, b: Rational): boolean {
  return a.numerator === b.numerator && a.denominator === b.denominator;
}

/** True when the value has a finite decimal expansion with at most `places` digits. */
export function isExactAt(value: Rational, places: number): boolean {
  return (value.numerator * pow10(places)) % value.denominator === ZERO;
}

/**
 * Decimal text rounded half-up (half away from zero) to `places` digits,
 * always showing exactly `places` fraction digits: 1/12 at 3 → "0.083",
 * 0.0835 at 3 → "0.084", 12 at 0 → "12".
 */
export function toDecimalString(value: Rational, places: number): string {
  const negative = value.numerator < ZERO;
  const numerator = negative ? -value.numerator : value.numerator;
  const scaled = numerator * pow10(places);
  let quotient = scaled / value.denominator;
  const remainder = scaled % value.denominator;
  if (remainder * TWO >= value.denominator) {
    quotient += ONE;
  }
  const digits = quotient.toString().padStart(places + 1, "0");
  const integer = digits.slice(0, digits.length - places);
  const fraction = places > 0 ? `.${digits.slice(digits.length - places)}` : "";
  return `${negative && quotient !== ZERO ? "-" : ""}${integer}${fraction}`;
}

/**
 * Exact decimal text when the value terminates within `maxPlaces` digits
 * (trailing zeros trimmed), otherwise null. Used to show a stored factor
 * exactly beside its rounded display.
 */
export function toExactDecimalString(value: Rational, maxPlaces = 12): string | null {
  for (let places = 0; places <= maxPlaces; places += 1) {
    if (isExactAt(value, places)) {
      return toDecimalString(value, places);
    }
  }
  return null;
}

/** Exact text for stored micros: 12_000_000 → "12", 83_333 → "0.083333". */
export function microsToDecimalString(micros: bigint): string {
  return microsToMajorString(micros);
}

export type FactorParseCode = "factor_invalid" | "factor_not_positive" | "factor_too_precise";

/**
 * Parses a conversion factor ("12", "0.083333") into integer micros. A
 * factor must be a plain decimal string greater than zero with at most six
 * decimal places; "0", "-1", "1e3", "1,000" and seven decimals are refused,
 * never rounded.
 */
export function parseFactorMicros(
  value: unknown,
): { status: "ok"; micros: bigint } | { status: "invalid"; code: FactorParseCode } {
  if (typeof value !== "string") {
    return { status: "invalid", code: "factor_invalid" };
  }
  const result = majorToMicrosExact(value);
  if (result.status === "blank") {
    return { status: "invalid", code: "factor_invalid" };
  }
  if (result.status === "invalid") {
    if (result.reason === "negative") {
      return { status: "invalid", code: "factor_not_positive" };
    }
    if (result.reason === "too_precise") {
      return { status: "invalid", code: "factor_too_precise" };
    }
    return { status: "invalid", code: "factor_invalid" };
  }
  if (result.value <= ZERO) {
    return { status: "invalid", code: "factor_not_positive" };
  }
  return { status: "ok", micros: result.value };
}

const QUANTITY = /^(\d+)(?:\.(\d+))?$/;

/**
 * Validates a quantity typed in a unit against the unit's decimal places.
 * Later leaves (receipts, counts, recipe lines) call this before storing a
 * quantity; it does not limit conversion factors. Trailing zeros do not
 * count: "1.250" is accepted at 3 places, "1.2501" is refused.
 */
export function assertQuantityPrecision(unit: { decimalPlaces: number }, text: string, field = "quantity"): void {
  const match = QUANTITY.exec(text.trim());
  if (!match) {
    throw new InventoryError("Enter the quantity as a plain decimal number.", 400, "quantity_invalid", field);
  }
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  if (fraction.length > unit.decimalPlaces) {
    throw new InventoryError(
      `This unit allows at most ${unit.decimalPlaces} decimal places.`,
      400,
      "quantity_too_precise",
      field,
    );
  }
}
