import { normalizeImportImageUrl } from "@/lib/catalogue/catalogue-import-validation";
import { isCalendarDate, majorToMicrosExact, microsToMajorString } from "@/lib/catalogue/selling-tax-cost";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import type { WorkbookColumnDefinition, WorkbookSheetDefinition } from "@/lib/workbook/contract";
import { parseDecimalText } from "@/lib/workbook/foodics-menu/numbers";
import type { ReviewDiagnostic } from "@/lib/workbook/validation/model";

/* Strict cell parsers (QOS-194, plan section 2.4). Every value is the trimmed
   cell text. Nothing is coerced, truncated or rounded: a value either parses
   exactly or the row gets a diagnostic naming the cell. */

export type CellResult<T> = { ok: true; value: T; notes?: ReviewDiagnostic[] } | { ok: false; diagnostic: ReviewDiagnostic };

const MINOR_UNITS = /^(0|[1-9][0-9]{0,15})$/;
const INTEGER = /^-?(0|[1-9][0-9]*)$/;
const REVISION = /^rv1\.[A-Za-z0-9_-]{22}$/;

function fail(code: ReviewDiagnostic["code"], column: string, params: Record<string, string | number> = {}): CellResult<never> {
  return { ok: false, diagnostic: { severity: "error", code, column, params } };
}

/** Whole minor units only: `1250` is AED 12.50. `12.50`, `1,250`, `1e3`, `+5`, `-5` and Arabic-Indic digits are refused. */
export function parseMinorUnits(text: string, column: string): CellResult<number> {
  if (!MINOR_UNITS.test(text)) {
    return fail("malformed_minor_units", column, { value: text });
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    return fail("malformed_minor_units", column, { value: text });
  }
  return { ok: true, value };
}

export function parseInteger(text: string, column: string, bounds: { min?: number; max?: number } = {}): CellResult<number> {
  if (!INTEGER.test(text)) {
    return fail("malformed_integer", column, { value: text });
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value)) {
    return fail("malformed_integer", column, { value: text });
  }
  if ((bounds.min !== undefined && value < bounds.min) || (bounds.max !== undefined && value > bounds.max)) {
    return fail("integer_out_of_range", column, {
      value: text,
      ...(bounds.min !== undefined ? { min: bounds.min } : {}),
      ...(bounds.max !== undefined ? { max: bounds.max } : {}),
    });
  }
  return { ok: true, value };
}

/** One of the contract values, compared case-insensitively and returned in the contract spelling. */
export function parseEnum(text: string, column: string, allowed: readonly string[]): CellResult<string> {
  const match = allowed.find((candidate) => candidate.toLowerCase() === text.toLowerCase());
  if (!match) {
    return fail("value_not_allowed", column, { value: text, allowed: allowed.join(", ") });
  }
  if (match !== text) {
    return {
      ok: true,
      value: match,
      notes: [{ severity: "info", code: "value_normalized", column, params: { value: text, normalized: match } }],
    };
  }
  return { ok: true, value: match };
}

/** `TRUE` / `FALSE`, strict, case normalised with a note. */
export function parseBoolean(text: string, column: string): CellResult<boolean> {
  const parsed = parseEnum(text, column, ["TRUE", "FALSE"]);
  return parsed.ok ? { ok: true, value: parsed.value === "TRUE", notes: parsed.notes } : parsed;
}

export function parseReference(text: string, column: string, required: boolean): CellResult<string | null> {
  if (!text) {
    return required ? fail("required_missing", column) : { ok: true, value: null };
  }
  return { ok: true, value: text };
}

/** https image URL with the importer's rules (no private hosts, bounded length). */
export function parseUrl(text: string, column: string): CellResult<string> {
  try {
    return { ok: true, value: normalizeImportImageUrl(text) ?? "" };
  } catch (error) {
    if (error instanceof CatalogueValidationError) {
      return fail("invalid_url", column, { value: text, reason: error.message });
    }
    throw error;
  }
}

/** Decimal syntax on deferred sheets: warnings only, since those rows are never applied here. */
export function parseDecimalSyntax(text: string, column: string, rules: { positive?: boolean; min?: number } = {}): CellResult<string> {
  const parsed = parseDecimalText(text);
  if (!parsed.ok) {
    return { ok: false, diagnostic: { severity: "warning", code: "invalid_number", column, params: { value: text } } };
  }
  if (parsed.value.sign === "-" && (rules.positive || (rules.min !== undefined && rules.min >= 0))) {
    return { ok: false, diagnostic: { severity: "warning", code: "negative_amount", column, params: { value: text } } };
  }
  return { ok: true, value: text };
}

/**
 * An exact decimal on a supported sheet (QOS-200): at most six decimal places,
 * returned in canonical form ("1.50" → "1.5") so it compares with the export.
 * Malformed, negative, too precise and (for positive columns) zero values are
 * errors, never rounded.
 */
export function parseExactDecimal(text: string, column: string, rules: { positive?: boolean } = {}): CellResult<string> {
  const parsed = majorToMicrosExact(text);
  if (parsed.status === "blank") return { ok: true, value: "" };
  if (parsed.status === "invalid") {
    if (parsed.reason === "negative") return fail("negative_amount", column, { value: text });
    if (parsed.reason === "too_precise") return fail("decimal_too_precise", column, { value: text, places: 6 });
    return fail("invalid_number", column, { value: text });
  }
  if (rules.positive && parsed.value === BigInt(0)) return fail("value_not_positive", column, { value: text });
  const canonical = microsToMajorString(parsed.value);
  return canonical === text
    ? { ok: true, value: canonical }
    : { ok: true, value: canonical, notes: [{ severity: "info", code: "value_normalized", column, params: { value: text, normalized: canonical } }] };
}

/** A calendar date as YYYY-MM-DD (QOS-200). */
export function parseIsoDate(text: string, column: string): CellResult<string> {
  return isCalendarDate(text) ? { ok: true, value: text } : fail("malformed_date", column, { value: text });
}

export function parseRevision(text: string, column: string): CellResult<string | null> {
  if (!text) return { ok: true, value: null };
  return REVISION.test(text) ? { ok: true, value: text } : fail("malformed_revision", column, { value: text });
}

const MECHANICS = new Set(["action", "expected_revision", "clear_fields", "row_check"]);

/** Columns a row may clear: optional, not the key, a reference, mechanics or read-only. */
export function isClearable(column: WorkbookColumnDefinition) {
  return !column.required && !column.isKey && column.type !== "reference" && !column.readonly && !MECHANICS.has(column.key);
}

/**
 * Comma-separated column keys of the same sheet. Each must be clearable and
 * must not also carry a value in the row; clearing is refused on create.
 */
export function parseClearFields(
  text: string,
  sheet: WorkbookSheetDefinition,
  values: Record<string, string>,
  action: string,
): { columns: string[]; diagnostics: ReviewDiagnostic[] } {
  const diagnostics: ReviewDiagnostic[] = [];
  if (!text) return { columns: [], diagnostics };
  if (action === "create") {
    diagnostics.push({ severity: "error", code: "clear_fields_on_create", column: "clear_fields", params: { value: text } });
    return { columns: [], diagnostics };
  }
  const columns: string[] = [];
  for (const name of text.split(",").map((part) => part.trim()).filter(Boolean)) {
    const column = sheet.columns.find((candidate) => candidate.key === name);
    if (!column) {
      diagnostics.push({ severity: "error", code: "clear_field_unknown", column: "clear_fields", params: { field: name } });
      continue;
    }
    if (!isClearable(column)) {
      diagnostics.push({ severity: "error", code: "clear_field_not_clearable", column: "clear_fields", params: { field: name } });
      continue;
    }
    if ((values[name] ?? "").trim()) {
      diagnostics.push({ severity: "error", code: "clear_field_conflicts_with_value", column: "clear_fields", params: { field: name } });
      continue;
    }
    if (!columns.includes(name)) columns.push(name);
  }
  return { columns, diagnostics };
}
