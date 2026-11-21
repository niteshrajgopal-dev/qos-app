/* Exact decimal handling for the Foodics menu profile (QOS-216). Money and
   percentages are converted with string arithmetic only: no floating point,
   no rounding. Too many fraction digits is an error the operator fixes in the
   source, never a silent change of value. */

export type DecimalText = { sign: "" | "-"; integer: string; fraction: string };

export type DecimalParse =
  | { ok: true; value: DecimalText; digitsNormalized: boolean }
  | { ok: false };

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;

function asciiDigits(text: string) {
  let normalized = false;
  let out = "";
  for (const character of text) {
    const code = character.codePointAt(0)!;
    if (code >= ARABIC_INDIC_ZERO && code <= ARABIC_INDIC_ZERO + 9) {
      out += String(code - ARABIC_INDIC_ZERO);
      normalized = true;
    } else if (code >= EXTENDED_ARABIC_INDIC_ZERO && code <= EXTENDED_ARABIC_INDIC_ZERO + 9) {
      out += String(code - EXTENDED_ARABIC_INDIC_ZERO);
      normalized = true;
    } else if (character === "٫") {
      out += ".";
      normalized = true;
    } else if (character === "٬") {
      out += ",";
      normalized = true;
    } else {
      out += character;
    }
  }
  return { text: out, normalized };
}

/**
 * Accepts `-?\d{1,12}(\.\d{1,6})?` after Arabic-Indic digits become ASCII and
 * exact `,ddd` thousands groups are removed. Anything else is not a number.
 */
export function parseDecimalText(raw: string): DecimalParse {
  const { text, normalized } = asciiDigits(raw.trim());
  let candidate = text;
  if (candidate.includes(",")) {
    if (!/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(candidate)) {
      return { ok: false };
    }
    candidate = candidate.replace(/,/g, "");
  }
  const match = /^(-?)(\d{1,12})(?:\.(\d{1,6}))?$/.exec(candidate);
  if (!match) {
    return { ok: false };
  }
  return {
    ok: true,
    value: { sign: match[1] as "" | "-", integer: match[2]!, fraction: match[3] ?? "" },
    digitsNormalized: normalized,
  };
}

/** Plain ASCII text of a parsed decimal, keeping its fraction digits (`4.20` stays `4.20`). */
export function formatDecimal(value: DecimalText) {
  return `${value.sign}${value.integer}${value.fraction ? `.${value.fraction}` : ""}`;
}

function stripLeadingZeros(digits: string) {
  const stripped = digits.replace(/^0+(?=\d)/, "");
  return stripped === "" ? "0" : stripped;
}

export type MinorUnitsResult =
  | { ok: true; minor: string }
  | { ok: false; code: "price_precision" | "negative_amount" };

/** Major units to integer minor units, exactly. `12.5` with 2 digits is `1250`; `12.505` is refused. */
export function toMinorUnits(value: DecimalText, minorDigits: number): MinorUnitsResult {
  const fraction = value.fraction.replace(/0+$/, "");
  if (fraction.length > minorDigits) {
    return { ok: false, code: "price_precision" };
  }
  const minor = stripLeadingZeros(`${value.integer}${fraction.padEnd(minorDigits, "0")}`);
  if (value.sign === "-" && minor !== "0") {
    return { ok: false, code: "negative_amount" };
  }
  return { ok: true, minor };
}

export type BasisPointsResult =
  | { ok: true; basisPoints: string; digitsNormalized: boolean }
  | { ok: false; code: "percent_precision" | "tax_unresolved" | "negative_amount" };

function isBareFractionAtMostOne(value: DecimalText) {
  const integer = stripLeadingZeros(value.integer);
  if (integer === "0") {
    return /[1-9]/.test(value.fraction);
  }
  return integer === "1";
}

/** Shift a decimal two places right (0.05 → 5) using string arithmetic only. */
function multiplyByOneHundred(value: DecimalText): DecimalText {
  const digits = `${value.integer}${value.fraction}`;
  const newPoint = value.integer.length + 2;
  const padded = digits.padEnd(newPoint, "0");
  return {
    sign: value.sign,
    integer: stripLeadingZeros(padded.slice(0, newPoint)),
    fraction: padded.slice(newPoint),
  };
}

/**
 * `5`, `5%`, `5.0 %` and `0.5%` become `500`, `500`, `500` and `50` basis points.
 * The original Foodics workbook writes tax% examples as 16%/7%/5% in the header
 * but stores values as fractions (`0.05` for 5%). A bare value in (0, 1] with
 * no `%` sign is therefore a fraction (0.05 → 500, 1 → 10000). Bare values
 * greater than 1, and any value that already carries `%`, stay percentages.
 */
export function toBasisPoints(raw: string): BasisPointsResult {
  const trimmed = raw.trim();
  const hadPercent = /[%٪]\s*$/.test(trimmed);
  const withoutPercent = trimmed.replace(/\s*[%٪]$/, "");
  const parsed = parseDecimalText(withoutPercent);
  if (!parsed.ok) {
    return { ok: false, code: "tax_unresolved" };
  }
  const percent =
    !hadPercent && isBareFractionAtMostOne(parsed.value) ? multiplyByOneHundred(parsed.value) : parsed.value;
  const converted = toMinorUnits(percent, 2);
  if (!converted.ok) {
    return { ok: false, code: converted.code === "price_precision" ? "percent_precision" : "negative_amount" };
  }
  return { ok: true, basisPoints: converted.minor, digitsNormalized: parsed.digitsNormalized };
}

const MINOR_DIGITS: Record<string, number> = {
  AED: 2,
  SAR: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  QAR: 2,
  EGP: 2,
  INR: 2,
  KWD: 3,
  BHD: 3,
  OMR: 3,
  JOD: 3,
  JPY: 0,
  KRW: 0,
};

/** Minor-unit digits of an ISO 4217 currency, or null when QOS does not know it. */
export function minorDigitsFor(currency: string): number | null {
  return MINOR_DIGITS[currency.trim().toUpperCase()] ?? null;
}

/** A non-negative whole number such as calories or selection limits, or null. */
export function parseWholeNumber(raw: string): string | null {
  const parsed = parseDecimalText(raw);
  if (!parsed.ok || parsed.value.sign === "-" || /[1-9]/.test(parsed.value.fraction)) {
    return null;
  }
  return stripLeadingZeros(parsed.value.integer);
}
