/* QOS-215 exact conversion helpers for selling-price tax and reference cost.

   Every conversion here is decimal-string or bigint arithmetic. Nothing goes
   through IEEE floats (`parseFloat`, `Number`, `Math.round`), so 0.05 is
   exactly 500 basis points and 1.234567 AED is exactly 1_234_567 micros.
   Blank (unknown) and zero (known zero) always stay distinct, and nothing
   here falls back to the Phase 1 synthetic checkout policy. */

export type SellingPriceTaxBasis = "inclusive" | "exclusive" | "unconfirmed";
export type ReferenceCostTaxBasis = "net" | "gross" | "unconfirmed";
export type ReferenceCostUnit = "each" | "kg" | "g";
export type ReferenceCostMethod = "manual" | "recipe_derived";

export const SELLING_PRICE_TAX_BASES: readonly SellingPriceTaxBasis[] = [
  "inclusive",
  "exclusive",
  "unconfirmed",
];
export const REFERENCE_COST_TAX_BASES: readonly ReferenceCostTaxBasis[] = [
  "net",
  "gross",
  "unconfirmed",
];
export const REFERENCE_COST_UNITS: readonly ReferenceCostUnit[] = ["each", "kg", "g"];

/** 1 major currency unit = 1_000_000 micros (1 fil = 10_000 micros). */
export const MICROS_PER_MAJOR = BigInt(1_000_000);
export const MICROS_DECIMALS = 6;
export const BASIS_POINTS_PER_WHOLE = BigInt(10_000);

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

type Decimal = { integer: string; fraction: string };

function readDecimal(text: string): Decimal | null {
  const match = DECIMAL.exec(text);
  if (!match) {
    return null;
  }
  return { integer: match[1]!, fraction: match[2] ?? "" };
}

/** Scales a non-negative decimal by 10^places exactly, or returns null when that needs rounding. */
function scaleExact(decimal: Decimal, places: number): bigint | null {
  const fraction = decimal.fraction.replace(/0+$/, "");
  if (fraction.length > places) {
    return null;
  }
  return BigInt(decimal.integer + fraction.padEnd(places, "0"));
}

function normalizeSpaces(raw: string) {
  return raw.trim().replace(/\s+/g, " ");
}

// ---------------------------------------------------------------------------
// Money

export type ExactAmountResult<T> =
  | { status: "ok"; value: T }
  | { status: "blank" }
  | {
      status: "invalid";
      reason: "not_a_decimal" | "negative" | "too_precise" | "unknown_currency" | "too_large";
      sourceText: string;
    };

/** Minor-unit exponent from ISO 4217 data in the runtime (AED = 2, JPY = 0, KWD = 3). */
export function currencyMinorExponent(currency: string): number | null {
  const code = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) {
    return null;
  }
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: code }).resolvedOptions()
      .maximumFractionDigits ?? null;
  } catch {
    return null;
  }
}

function invalid(reason: Extract<ExactAmountResult<never>, { status: "invalid" }>["reason"], sourceText: string) {
  return { status: "invalid" as const, reason, sourceText };
}

/**
 * Parses a major-unit decimal string ("12.50") into integer minor units
 * (1250) for the currency. More decimals than the currency carries is
 * rejected, never rounded.
 */
export function majorToMinorExact(text: string, currency: string): ExactAmountResult<number> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { status: "blank" };
  }
  if (trimmed.startsWith("-")) {
    return invalid("negative", trimmed);
  }
  const exponent = currencyMinorExponent(currency);
  if (exponent == null) {
    return invalid("unknown_currency", trimmed);
  }
  const decimal = readDecimal(trimmed);
  if (!decimal) {
    return invalid("not_a_decimal", trimmed);
  }
  const minor = scaleExact(decimal, exponent);
  if (minor == null) {
    return invalid("too_precise", trimmed);
  }
  if (minor > BigInt(2_147_483_647)) {
    return invalid("too_large", trimmed);
  }
  return { status: "ok", value: Number(minor) };
}

/** Integer minor units back to a major-unit string with the currency's exponent ("12.50"). */
export function minorToMajorString(amountMinor: number, currency: string): string {
  const exponent = currencyMinorExponent(currency) ?? 2;
  return formatScaled(BigInt(amountMinor), exponent, exponent);
}

/**
 * Parses a major-unit decimal string into integer micros. Up to six
 * decimal places are exact; a seventh is rejected.
 */
export function majorToMicrosExact(text: string): ExactAmountResult<bigint> {
  const trimmed = text.trim();
  if (!trimmed) {
    return { status: "blank" };
  }
  if (trimmed.startsWith("-")) {
    return invalid("negative", trimmed);
  }
  const decimal = readDecimal(trimmed);
  if (!decimal) {
    return invalid("not_a_decimal", trimmed);
  }
  const micros = scaleExact(decimal, MICROS_DECIMALS);
  if (micros == null) {
    return invalid("too_precise", trimmed);
  }
  if (micros > BigInt("9223372036854775807")) {
    return invalid("too_large", trimmed);
  }
  return { status: "ok", value: micros };
}

function formatScaled(value: bigint, places: number, minFractionDigits: number) {
  const negative = value < BigInt(0);
  const digits = (negative ? -value : value).toString().padStart(places + 1, "0");
  const integer = digits.slice(0, digits.length - places);
  let fraction = places > 0 ? digits.slice(digits.length - places) : "";
  while (fraction.length > minFractionDigits && fraction.endsWith("0")) {
    fraction = fraction.slice(0, -1);
  }
  return `${negative ? "-" : ""}${integer}${fraction ? `.${fraction}` : ""}`;
}

/** Exact major-unit text for micros, trimmed of trailing zeros: 1234567 micros → "1.234567", 0 → "0". */
export function microsToMajorString(micros: bigint, minFractionDigits = 0): string {
  return formatScaled(micros, MICROS_DECIMALS, minFractionDigits);
}

/** Parses an integer-micros value sent over JSON (string of digits or a safe integer). */
export function parseMicrosInteger(value: unknown): bigint | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }
  if (typeof value === "string" && /^\d{1,19}$/.test(value.trim())) {
    const parsed = BigInt(value.trim());
    return parsed <= BigInt("9223372036854775807") ? parsed : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Tax basis tokens

export type TaxBasisTokenResult =
  | { status: "ok"; basis: SellingPriceTaxBasis }
  | { status: "blank" }
  | { status: "unknown"; sourceText: string };

const SELLING_BASIS_ALIASES: Record<string, SellingPriceTaxBasis> = {
  inclusive: "inclusive",
  exclusive: "exclusive",
  unconfirmed: "unconfirmed",
  // QOS workbook 1.0 planning values.
  gross: "inclusive",
  net: "exclusive",
};

/**
 * Reads a selling-price tax basis: inclusive / exclusive / unconfirmed,
 * Foodics Inclusive / Exclusive and workbook GROSS / NET / UNCONFIRMED, in
 * any case with any spacing. Anything else is diagnosed, never defaulted.
 */
export function parseSellingTaxBasisToken(raw: string | null | undefined): TaxBasisTokenResult {
  const text = normalizeSpaces(raw ?? "");
  if (!text) {
    return { status: "blank" };
  }
  const basis = SELLING_BASIS_ALIASES[text.toLowerCase()];
  return basis ? { status: "ok", basis } : { status: "unknown", sourceText: text };
}

export type CostTaxBasisTokenResult =
  | { status: "ok"; basis: ReferenceCostTaxBasis }
  | { status: "blank" }
  | { status: "unknown"; sourceText: string };

/** Reads a reference-cost tax basis: NET / GROSS / UNCONFIRMED in any case. */
export function parseCostTaxBasisToken(raw: string | null | undefined): CostTaxBasisTokenResult {
  const text = normalizeSpaces(raw ?? "");
  if (!text) {
    return { status: "blank" };
  }
  const lowered = text.toLowerCase();
  return (REFERENCE_COST_TAX_BASES as readonly string[]).includes(lowered)
    ? { status: "ok", basis: lowered as ReferenceCostTaxBasis }
    : { status: "unknown", sourceText: text };
}

/** Workbook spelling for a stored selling basis (lowercase, as the 1.4 contract lists). */
export function sellingTaxBasisWorkbookValue(basis: SellingPriceTaxBasis | null): string {
  return basis ?? "";
}

/** Workbook spelling for a stored cost basis (uppercase, as the contract lists). */
export function costTaxBasisWorkbookValue(basis: ReferenceCostTaxBasis | null): string {
  return basis ? basis.toUpperCase() : "";
}

// ---------------------------------------------------------------------------
// Tax rates

export type TaxRateResult =
  | { status: "rate"; basisPoints: number }
  | { status: "blank" }
  | { status: "ambiguous"; reason: "bare_number_above_one"; sourceText: string }
  | { status: "unresolved"; reason: "not_numeric"; sourceText: string }
  | { status: "invalid"; reason: "negative" | "too_precise" | "not_integer" | "too_large"; sourceText: string };

const MAX_BASIS_POINTS = BigInt(1_000_000);

function rateFromScaled(scaled: bigint | null, sourceText: string): TaxRateResult {
  if (scaled == null) {
    return { status: "invalid", reason: "too_precise", sourceText };
  }
  if (scaled > MAX_BASIS_POINTS) {
    return { status: "invalid", reason: "too_large", sourceText };
  }
  return { status: "rate", basisPoints: Number(scaled) };
}

/**
 * Converts a Foodics-style tax percentage cell.
 *
 * - A number in [0, 1] is an Excel percentage fraction: 0.05 → 500 bps,
 *   0 → 0 bps (a known zero rate).
 * - Explicit percent text: "5%" → 500 bps, "16 %" → 1600 bps.
 * - A bare number above 1 without "%" ("5", "16") is ambiguous: it could be
 *   a percent or basis points. It is diagnosed, never guessed.
 * - Text such as a tax-group name is unresolved and keeps its source text.
 */
export function parseSourceTaxPercent(raw: string | null | undefined): TaxRateResult {
  const text = normalizeSpaces(raw ?? "");
  if (!text) {
    return { status: "blank" };
  }

  const percent = /^(-?)(\d+(?:\.\d+)?) ?%$/.exec(text);
  if (percent) {
    if (percent[1]) {
      return { status: "invalid", reason: "negative", sourceText: text };
    }
    // n% = n × 100 basis points.
    return rateFromScaled(scaleExact(readDecimal(percent[2]!)!, 2), text);
  }

  if (/^-\d+(?:\.\d+)?$/.test(text)) {
    return { status: "invalid", reason: "negative", sourceText: text };
  }

  const decimal = readDecimal(text);
  if (!decimal) {
    return { status: "unresolved", reason: "not_numeric", sourceText: text };
  }

  // Compare to 1 exactly on the decimal string.
  const integerPart = BigInt(decimal.integer);
  const hasFraction = /[1-9]/.test(decimal.fraction);
  if (integerPart > BigInt(1) || (integerPart === BigInt(1) && hasFraction)) {
    return { status: "ambiguous", reason: "bare_number_above_one", sourceText: text };
  }

  // Fraction of one whole: value × 10_000 basis points.
  return rateFromScaled(scaleExact(decimal, 4), text);
}

/** A QOS workbook `tax_rate_basis_points` cell: already an integer number of basis points. */
export function parseBasisPointsCell(raw: string | null | undefined): TaxRateResult {
  const text = normalizeSpaces(raw ?? "");
  if (!text) {
    return { status: "blank" };
  }
  if (/^-\d/.test(text)) {
    return { status: "invalid", reason: "negative", sourceText: text };
  }
  const decimal = readDecimal(text);
  if (!decimal) {
    return { status: "unresolved", reason: "not_numeric", sourceText: text };
  }
  if (/[1-9]/.test(decimal.fraction)) {
    return { status: "invalid", reason: "not_integer", sourceText: text };
  }
  const value = BigInt(decimal.integer);
  if (value > MAX_BASIS_POINTS) {
    return { status: "invalid", reason: "too_large", sourceText: text };
  }
  return { status: "rate", basisPoints: Number(value) };
}

/**
 * Staff UI percent input ("5", "5.25") to basis points. The field is
 * labelled as a percent, so a bare number is a percent here; at most two
 * decimals are exact.
 */
export function percentInputToBasisPoints(text: string): TaxRateResult {
  const trimmed = text.trim().replace(/ ?%$/, "");
  if (!trimmed) {
    return { status: "blank" };
  }
  return parseSourceTaxPercent(`${trimmed}%`);
}

/** Whole-percent display for stored basis points (500 → "5"), or null when it is not a whole percent. */
export function basisPointsAsWholePercent(basisPoints: number | null): string | null {
  if (basisPoints == null || basisPoints % 100 !== 0) {
    return null;
  }
  return String(basisPoints / 100);
}

// ---------------------------------------------------------------------------
// Foodics Product Cost

export type FoodicsProductCostResult =
  | {
      status: "manual";
      amountMicros: bigint;
    }
  | {
      /** Blank Product Cost means "derive from ingredients" in the Foodics template; review before applying. */
      status: "recipe_derived_pending_review";
      reason: "foodics_blank_product_cost";
    }
  | { status: "invalid"; reason: "not_a_decimal" | "negative" | "too_precise" | "too_large"; sourceText: string };

/**
 * Converts a Foodics `Product Cost` (or modifier option cost) cell. Only
 * this helper maps a blank cost to the recipe-derived method; generic API
 * updates never read blank as recipe-derived. The result is meant for the
 * product's default variant (product-level source cost maps onto it).
 */
export function convertFoodicsProductCost(raw: string | null | undefined): FoodicsProductCostResult {
  const result = majorToMicrosExact(raw ?? "");
  if (result.status === "blank") {
    return { status: "recipe_derived_pending_review", reason: "foodics_blank_product_cost" };
  }
  if (result.status === "invalid") {
    return {
      status: "invalid",
      reason: result.reason === "unknown_currency" ? "not_a_decimal" : result.reason,
      sourceText: result.sourceText,
    };
  }
  return { status: "manual", amountMicros: result.value };
}

// ---------------------------------------------------------------------------
// Dates

/** Calendar date (YYYY-MM-DD) in the given IANA time zone. */
export function calendarDateInTimeZone(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
