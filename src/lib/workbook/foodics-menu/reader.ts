import { createHash } from "node:crypto";

import {
  isDeferredField,
  sheetHeaderRow,
  sheetSupport,
  tableNameForSheet,
  WORKBOOK_CONTRACT,
} from "@/lib/workbook/contract";
import { capabilityFor, type CapabilityClass, SOURCE_MAP_SHEET } from "@/lib/workbook/dictionary";
import { WorkbookParseError } from "@/lib/workbook/errors";
import {
  identityText,
  internalNameFor,
  keyFor,
  looseIdentity,
  normalizeIdentityText,
} from "@/lib/workbook/foodics-menu/keys";
import {
  dataStartRow,
  FOODICS_MENU_PROFILE,
  regionRef,
  regionSpec,
  type FoodicsMenuLayout,
  type IgnoredSheet,
  type MatchedRegion,
  type RegionId,
} from "@/lib/workbook/foodics-menu/layout";
import {
  formatDecimal,
  minorDigitsFor,
  parseDecimalText,
  parseWholeNumber,
  toBasisPoints,
  toMinorUnits,
} from "@/lib/workbook/foodics-menu/numbers";
import { FOODICS_MENU_LIMITS, WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import { cellKey, columnLetters, type PackageSheet, type XlsxPackage } from "@/lib/workbook/ooxml";
import type {
  ExtendedWorkbookParseResult,
  WorkbookIssue,
  WorkbookIssueCode,
  WorkbookIssueSeverity,
  WorkbookParseOptions,
  WorkbookRow,
  WorkbookSheetResult,
} from "@/lib/workbook/reader";

/* Reads the Foodics-style menu workbook (QOS-216) into the QOS v1 canonical
   sheets. Only the documented regions are read, inside explicit bounds; the
   example rows are skipped by position; a row exists only when an identity
   cell holds typed text; formulas are never evaluated and their cached
   values never read. Keys come from source identity text (keys.ts), money
   and percentages are converted exactly (numbers.ts), and every canonical
   row carries its source sheet, row, cells and exact text. Nothing is
   validated against the catalogue (QOS-194) or written (QOS-200). */

/** Every converted row is a first intake (decision D-ACTION). */
export const CONVERTED_ROW_ACTION = "create";
const DRAFT = "draft";

export type FoodicsRequiredMapping =
  | { kind: "currency"; status: "resolved" | "required"; value?: string }
  | { kind: "brand"; status: "resolved" | "required"; value?: string; choices?: Array<{ publicId: string; name: string }> }
  | { kind: "namespace"; status: "resolved" | "required"; value: string }
  | { kind: "channel"; status: "deferred"; label: string; prices: number };

export type FoodicsCapability = { sheet: string; column: string; class: CapabilityClass; owner: string; rows: number };

export type FoodicsLayoutRegion = {
  id: RegionId;
  sheet: string;
  headerRef: string;
  dataStartRow: number;
  scannedRows: number;
  businessRows: number;
  exampleRowsSkipped: number;
  matchedRoles: string[];
  unmappedHeaders: string[];
};

export type FoodicsMenuParseResult = {
  profile: "foodics_menu_v1";
  profileVersion: 1;
  dictionaryVersion: "1.2";
  fileName: string;
  fileFingerprint: string;
  templateVersion: string;
  layout: { regions: FoodicsLayoutRegion[]; ignoredSheets: IgnoredSheet[] };
  context: {
    tenantPublicId: string;
    brandPublicId: string | null;
    currency: string | null;
    sourceNamespace: string;
  };
  requiredMappings: FoodicsRequiredMapping[];
  sheets: WorkbookSheetResult[];
  capabilities: FoodicsCapability[];
  issues: WorkbookIssue[];
  summary: ExtendedWorkbookParseResult["summary"] & {
    recognizedRows: number;
    deferredRows: number;
    deferredValues: number;
  };
};

export function foodicsSourceNamespace(tenantPublicId: string) {
  return `${FOODICS_MENU_PROFILE.id.replace(/_/g, "-")}:${tenantPublicId}`;
}

/* ------------------------------------------------------------------ */
/* Region scan                                                         */
/* ------------------------------------------------------------------ */

type SourceValue = { text: string; ref: string; numeric: boolean };

type SourceRecord = {
  region: RegionId;
  sheet: string;
  row: number;
  range: string;
  values: Map<string, SourceValue>;
  /** Cell reference per role, also for formula or error cells that were withheld. */
  refs: Map<string, string>;
};

type Issues = {
  list: WorkbookIssue[];
  add(
    severity: WorkbookIssueSeverity,
    code: WorkbookIssueCode,
    location: { sheet?: string; row?: number; column?: string },
    params?: Record<string, string | number>,
  ): void;
};

function createIssues(): Issues {
  const list: WorkbookIssue[] = [];
  return {
    list,
    add(severity, code, location, params) {
      list.push({
        severity,
        code,
        ...(location.sheet !== undefined ? { sheet: location.sheet } : {}),
        ...(location.row !== undefined ? { row: location.row } : {}),
        ...(location.column !== undefined ? { column: location.column } : {}),
        ...(params ? { params } : {}),
      });
    },
  };
}

type TextBudget = { used: number };

function isTyped(cell: { kind: string; text: string; formula: boolean } | undefined) {
  return Boolean(cell && !cell.formula && cell.kind !== "error" && cell.text.trim() !== "");
}

function scanRegion(
  sheet: PackageSheet,
  matched: MatchedRegion,
  issues: Issues,
  budget: TextBudget,
): { records: SourceRecord[]; summary: FoodicsLayoutRegion } {
  const spec = regionSpec(matched.id);
  const firstRow = dataStartRow(spec, matched.headerRow);
  const lastRow = firstRow + FOODICS_MENU_LIMITS.maxRowsPerRegion - 1;
  const roleColumns = matched.columns.filter((entry) => entry.role);
  const identityColumns = roleColumns.filter((entry) => spec.identityRoles.includes(entry.role!));
  const identityNumbers = new Set(identityColumns.map((entry) => entry.column));
  const lastColumn = matched.startColumn + matched.width - 1;
  const at = (row: number, column: number) => sheet.cells.get(cellKey(row, column));
  const ref = (row: number, column: number) => `${columnLetters(column)}${row}`;

  // Typed identity text past the bound is refused, never silently cut off.
  // Formula prefill and formatting past the bound do not count.
  let lastTypedRow = 0;
  for (const [key, cell] of sheet.cells) {
    const separator = key.indexOf(":");
    const row = Number(key.slice(0, separator));
    const column = Number(key.slice(separator + 1));
    if (row > lastRow && identityNumbers.has(column) && isTyped(cell)) {
      lastTypedRow = Math.max(lastTypedRow, row);
    }
  }
  if (lastTypedRow > 0) {
    throw new WorkbookParseError(
      "too_many_rows",
      `${sheet.name} has typed ${matched.id} rows past row ${lastRow}; at most ${FOODICS_MENU_LIMITS.maxRowsPerRegion} are read.`,
      { sheet: sheet.name, region: matched.id, lastTypedRow, max: FOODICS_MENU_LIMITS.maxRowsPerRegion },
    );
  }

  // Example rows are skipped by position. Their content is not copied; only
  // how many of them hold typed text is reported, so real data typed there is
  // not lost silently.
  let populatedExamples = 0;
  for (let row = matched.headerRow + 1; row < firstRow; row += 1) {
    for (let column = matched.startColumn; column <= lastColumn; column += 1) {
      if (isTyped(at(row, column))) {
        populatedExamples += 1;
        break;
      }
    }
  }
  issues.add("info", "example_rows_skipped", { sheet: sheet.name }, {
    region: matched.id,
    range: regionRef(matched.startColumn, matched.headerRow + 1, matched.width, firstRow - 1),
    populated: populatedExamples,
  });

  for (const entry of matched.columns) {
    if (entry.header && !entry.role) {
      issues.add("warning", "source_column_unmapped", { sheet: sheet.name, row: matched.headerRow, column: entry.header }, {
        cell: ref(matched.headerRow, entry.column),
        header: entry.header,
      });
    }
  }

  const records: SourceRecord[] = [];
  for (let row = firstRow; row <= lastRow; row += 1) {
    const typedIdentity = identityColumns.some((entry) => isTyped(at(row, entry.column)));
    if (!typedIdentity) {
      const typedOther = matched.columns.find((entry) => isTyped(at(row, entry.column)));
      if (!typedOther) continue;
      const formulaIdentity = identityColumns.find((entry) => at(row, entry.column)?.formula);
      if (formulaIdentity) {
        issues.add("error", "identity_formula", { sheet: sheet.name, row, column: formulaIdentity.header }, {
          cell: ref(row, formulaIdentity.column),
        });
      } else {
        issues.add("warning", "missing_identity", { sheet: sheet.name, row }, {
          cell: ref(row, typedOther.column),
          region: matched.id,
        });
      }
      continue;
    }

    const record: SourceRecord = {
      region: matched.id,
      sheet: sheet.name,
      row,
      range: `${sheet.name}!${regionRef(matched.startColumn, row, matched.width)}`,
      values: new Map(),
      refs: new Map(),
    };
    for (const entry of matched.columns) {
      const cell = at(row, entry.column);
      const cellRef = ref(row, entry.column);
      const field = entry.role ?? (entry.normalized ? `unmapped:${entry.normalized}` : null);
      if (!cell || !field) continue;
      record.refs.set(field, cellRef);
      if (cell.formula) {
        // Never evaluated; the cached value is never read.
        issues.add("error", "formula_ignored", { sheet: sheet.name, row, column: entry.header }, { cell: cellRef });
        continue;
      }
      if (cell.kind === "error") {
        issues.add("error", "cell_error", { sheet: sheet.name, row, column: entry.header }, { cell: cellRef });
        continue;
      }
      const text = cell.text.trim();
      if (!text) continue;
      if (text.length > WORKBOOK_LIMITS.maxCellLength) {
        throw new WorkbookParseError(
          "cell_too_long",
          `Cell ${sheet.name}!${cellRef} exceeds the ${WORKBOOK_LIMITS.maxCellLength}-character limit.`,
          { sheet: sheet.name, cell: cellRef, max: WORKBOOK_LIMITS.maxCellLength },
        );
      }
      budget.used += text.length;
      if (budget.used > WORKBOOK_LIMITS.maxTotalTextLength) {
        throw new WorkbookParseError("too_much_text", "The workbook contains more text than one upload may carry.", {
          max: WORKBOOK_LIMITS.maxTotalTextLength,
        });
      }
      record.values.set(field, { text, ref: cellRef, numeric: cell.kind === "number" });
    }
    records.push(record);
  }

  return {
    records,
    summary: {
      id: matched.id,
      sheet: sheet.name,
      headerRef: regionRef(matched.startColumn, matched.headerRow, matched.width),
      dataStartRow: firstRow,
      scannedRows: FOODICS_MENU_LIMITS.maxRowsPerRegion,
      businessRows: records.length,
      exampleRowsSkipped: firstRow - matched.headerRow - 1,
      matchedRoles: roleColumns.map((entry) => entry.role!),
      unmappedHeaders: matched.columns.filter((entry) => entry.header && !entry.role).map((entry) => entry.header),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Canonical rows                                                      */
/* ------------------------------------------------------------------ */

type CanonicalRow = {
  values: Record<string, string>;
  source: NonNullable<WorkbookRow["source"]>;
};

function contractColumns(sheet: string) {
  return WORKBOOK_CONTRACT.sheets.find((entry) => entry.name === sheet)!.columns.map((column) => column.key);
}

function sourceValues(record: SourceRecord) {
  return Object.fromEntries([...record.values].map(([role, value]) => [role, value.text]));
}

function canonicalRow(
  sheet: string,
  record: SourceRecord,
  values: Record<string, string>,
  cells: Record<string, string | undefined>,
  preserved?: Record<string, string>,
): CanonicalRow {
  const full = Object.fromEntries(contractColumns(sheet).map((column) => [column, values[column] ?? ""]));
  const located = Object.fromEntries(
    Object.entries(cells)
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
      .map(([column, cell]) => [column, `${record.sheet}!${cell}`]),
  );
  // `preserved` maps a Source Map field to the role it comes from; empty source cells are not kept.
  const kept = Object.fromEntries(
    Object.entries(preserved ?? {})
      .map(([field, role]) => [field, record.values.get(role)] as const)
      .filter((entry): entry is readonly [string, SourceValue] => Boolean(entry[1]))
      .map(([field, entry]) => [field, { value: entry.text, cell: `${record.sheet}!${entry.ref}` }]),
  );
  return {
    values: full,
    source: {
      sheet: record.sheet,
      row: record.row,
      range: record.range,
      cells: located,
      values: sourceValues(record),
      ...(Object.keys(kept).length > 0 ? { preserved: kept } : {}),
    },
  };
}

type Lookup = Map<string, Set<string>>;

function addLookup(lookup: Lookup, text: string, identity: string) {
  const normalized = normalizeIdentityText(text);
  if (!normalized) return;
  lookup.set(normalized, new Set([...(lookup.get(normalized) ?? []), identity]));
}

type Resolution = { status: "ok"; identity: string } | { status: "ambiguous" } | { status: "missing"; candidate?: string };

function resolve(lookup: Lookup, text: string): Resolution {
  const normalized = normalizeIdentityText(text);
  const hits = lookup.get(normalized);
  if (hits?.size === 1) return { status: "ok", identity: [...hits][0]! };
  if (hits && hits.size > 1) return { status: "ambiguous" };
  const loose = looseIdentity(normalized);
  const near = [...lookup.keys()].filter((candidate) => loose && looseIdentity(candidate) === loose);
  return near.length === 1 ? { status: "missing", candidate: near[0] } : { status: "missing" };
}

/**
 * Exact duplicates block every copy; near duplicates (case, diacritics,
 * tatweel, hamza, punctuation) are flagged and kept apart. Nothing is merged.
 */
function partitionIdentities<T extends { identity: string; record: SourceRecord; cell?: string; column?: string }>(
  items: T[],
  issues: Issues,
) {
  const byIdentity = new Map<string, T[]>();
  for (const item of items) {
    byIdentity.set(item.identity, [...(byIdentity.get(item.identity) ?? []), item]);
  }
  const kept: T[] = [];
  for (const item of items) {
    const copies = byIdentity.get(item.identity)!;
    if (copies.length > 1) {
      issues.add("error", "duplicate_identity", { sheet: item.record.sheet, row: item.record.row, column: item.column }, {
        ...(item.cell ? { cell: item.cell } : {}),
        value: item.identity,
        rows: copies.map((copy) => copy.record.row).join(", "),
      });
    } else {
      kept.push(item);
    }
  }
  const byLoose = new Map<string, T[]>();
  for (const item of kept) {
    const loose = looseIdentity(item.identity);
    byLoose.set(loose, [...(byLoose.get(loose) ?? []), item]);
  }
  for (const item of kept) {
    const near = byLoose.get(looseIdentity(item.identity))!;
    if (near.length > 1) {
      issues.add("warning", "ambiguous_identity", { sheet: item.record.sheet, row: item.record.row, column: item.column }, {
        ...(item.cell ? { cell: item.cell } : {}),
        value: item.identity,
        rows: near.map((copy) => copy.record.row).join(", "),
      });
    }
  }
  return kept;
}

const TRUE_WORDS = new Set(["true", "yes", "y", "1", "required", "نعم"]);

const QUANTITY_KINDS: Record<string, string> = {
  kg: "MASS",
  g: "MASS",
  mg: "MASS",
  lb: "MASS",
  oz: "MASS",
  l: "VOLUME",
  ml: "VOLUME",
  cl: "VOLUME",
  pc: "COUNT",
  pcs: "COUNT",
  piece: "COUNT",
  each: "COUNT",
  ea: "COUNT",
  unit: "COUNT",
  pack: "PACK",
  box: "PACK",
  case: "PACK",
  carton: "PACK",
  batch: "BATCH",
};

const PROVENANCE_COPIES = new Set(["price", "tax", "option_price", "ingredient_cost"]);

type Money = { minorDigits: number | null; currency: string | null };

/* ------------------------------------------------------------------ */
/* Parse                                                               */
/* ------------------------------------------------------------------ */

export function parseFoodicsMenu(
  fileName: string,
  bytes: Buffer,
  pkg: XlsxPackage,
  layout: FoodicsMenuLayout,
  options: WorkbookParseOptions,
): FoodicsMenuParseResult {
  const issues = createIssues();
  const budget: TextBudget = { used: 0 };
  const sheetByName = new Map(pkg.sheets.map((sheet) => [sheet.name, sheet]));

  const scanned = new Map<RegionId, SourceRecord[]>();
  const regionSummaries: FoodicsLayoutRegion[] = [];
  for (const matched of layout.regions) {
    const { records, summary } = scanRegion(sheetByName.get(matched.sheet)!, matched, issues, budget);
    scanned.set(matched.id, records);
    regionSummaries.push(summary);
  }
  for (const id of layout.absentRegions) {
    issues.add("warning", "region_absent", {}, { region: id });
  }
  const recordsOf = (id: RegionId) => scanned.get(id) ?? [];

  const currency = options.tenantCurrency?.trim().toUpperCase() || null;
  const money: Money = { currency, minorDigits: currency ? minorDigitsFor(currency) : null };
  if (!currency) {
    issues.add("error", "currency_required", {});
  } else if (money.minorDigits === null) {
    issues.add("error", "currency_minor_digits_unknown", {}, { currency });
  }

  const digitsNormalizedIn = new Set<RegionId>();
  const value = (record: SourceRecord, role: string) => record.values.get(role)?.text ?? "";
  const refOf = (record: SourceRecord, role: string) => record.refs.get(role);
  const headerOf = (record: SourceRecord, role: string) =>
    layout.regions.find((entry) => entry.id === record.region)?.columns.find((entry) => entry.role === role)?.header ?? role;
  const at = (record: SourceRecord, role: string) => ({ sheet: record.sheet, row: record.row, column: headerOf(record, role) });

  const decimal = (record: SourceRecord, role: string): string => {
    const text = value(record, role);
    if (!text) return "";
    const parsed = parseDecimalText(text);
    if (!parsed.ok) {
      issues.add("error", "invalid_number", at(record, role), { cell: refOf(record, role)!, value: text });
      return "";
    }
    if (parsed.digitsNormalized) digitsNormalizedIn.add(record.region);
    if (parsed.value.sign === "-") {
      issues.add("error", "negative_amount", at(record, role), { cell: refOf(record, role)!, value: text });
      return "";
    }
    return formatDecimal(parsed.value);
  };

  const minor = (record: SourceRecord, role: string): string => {
    const text = value(record, role);
    if (!text || money.minorDigits === null) return "";
    const parsed = parseDecimalText(text);
    if (!parsed.ok) {
      issues.add("error", "invalid_number", at(record, role), { cell: refOf(record, role)!, value: text });
      return "";
    }
    if (parsed.digitsNormalized) digitsNormalizedIn.add(record.region);
    const converted = toMinorUnits(parsed.value, money.minorDigits);
    if (!converted.ok) {
      issues.add("error", converted.code, at(record, role), { cell: refOf(record, role)!, value: text });
      return "";
    }
    return converted.minor;
  };

  const whole = (record: SourceRecord, role: string): string => {
    const text = value(record, role);
    if (!text) return "";
    const parsed = parseWholeNumber(text);
    if (parsed === null) {
      issues.add("error", "invalid_number", at(record, role), { cell: refOf(record, role)!, value: text });
      return "";
    }
    return parsed;
  };

  const identifier = (record: SourceRecord, role: string): string => {
    const entry = record.values.get(role);
    if (!entry) return "";
    if (entry.numeric) {
      issues.add("warning", "identifier_number", at(record, role), { cell: entry.ref });
    }
    return entry.text;
  };

  const fieldsWithPrefix = (record: SourceRecord, prefix: string) =>
    Object.fromEntries([...record.values.keys()].filter((field) => field.startsWith(prefix)).map((field) => [field, field]));
  // Inclusive/Exclusive from the original "type of tax" column. Still a deferred
  // QOS field (price_tax_basis); this only fills the already-recognised values.
  const taxBasisOf = (record: SourceRecord, tax: string) => {
    const type = value(record, "tax_type").trim().toLowerCase();
    if (type === "inclusive") return "INCLUSIVE";
    if (type === "exclusive") return "EXCLUSIVE";
    return tax ? "UNCONFIRMED" : "";
  };
  const unmappedOf = (record: SourceRecord) => fieldsWithPrefix(record, "unmapped:");
  const channelsOf = (record: SourceRecord) => fieldsWithPrefix(record, "channel_price:");

  const reportUnresolved = (record: SourceRecord, role: string, result: Resolution) => {
    const text = value(record, role);
    if (result.status === "ambiguous") {
      issues.add("error", "ambiguous_reference", at(record, role), { cell: refOf(record, role)!, field: role, value: text });
    } else if (result.status === "missing") {
      issues.add("error", "unresolved_reference", at(record, role), {
        cell: refOf(record, role)!,
        field: role,
        value: text,
        ...(result.candidate ? { candidate: result.candidate } : {}),
      });
    }
  };

  const out = new Map<string, CanonicalRow[]>();
  const emit = (sheet: string, row: CanonicalRow) => out.set(sheet, [...(out.get(sheet) ?? []), row]);

  /* Categories ------------------------------------------------------ */
  const categoryKeys = new Map<string, string>();
  const categoryLookup: Lookup = new Map();
  const categoryItems = recordsOf("categories").map((record) => ({
    record,
    identity: identityText(value(record, "name_en"), value(record, "name_ar")),
    cell: refOf(record, value(record, "name_en") ? "name_en" : "name_ar"),
    column: headerOf(record, value(record, "name_en") ? "name_en" : "name_ar"),
  }));
  for (const item of categoryItems) {
    addLookup(categoryLookup, value(item.record, "name_en"), item.identity);
    addLookup(categoryLookup, value(item.record, "name_ar"), item.identity);
  }
  partitionIdentities(categoryItems, issues).forEach((item, index) => {
    const key = keyFor("cat", item.identity);
    categoryKeys.set(item.identity, key);
    const { record } = item;
    emit(
      "Categories",
      canonicalRow(
        "Categories",
        record,
        {
          category_key: key,
          action: CONVERTED_ROW_ACTION,
          internal_name: internalNameFor(value(record, "name_en"), key),
          display_name_en: value(record, "name_en"),
          display_name_ar: value(record, "name_ar"),
          sort_order: String(index + 1),
          status: DRAFT,
        },
        {
          category_key: item.cell,
          internal_name: refOf(record, "name_en"),
          display_name_en: refOf(record, "name_en"),
          display_name_ar: refOf(record, "name_ar"),
        },
        unmappedOf(record),
      ),
    );
  });

  /* Products, Variants, Product Categories -------------------------- */
  const productKeys = new Map<string, string>();
  const productNames = new Map<string, string>();
  const productLookup: Lookup = new Map();
  const productItems = recordsOf("products").map((record) => ({
    record,
    identity: identityText(value(record, "name_en"), value(record, "name_ar")),
    cell: refOf(record, value(record, "name_en") ? "name_en" : "name_ar"),
    column: headerOf(record, value(record, "name_en") ? "name_en" : "name_ar"),
  }));
  for (const item of productItems) {
    addLookup(productLookup, value(item.record, "name_en"), item.identity);
    addLookup(productLookup, value(item.record, "name_ar"), item.identity);
  }
  for (const item of partitionIdentities(productItems, issues)) {
    const { record } = item;
    const key = keyFor("prd", item.identity);
    productKeys.set(item.identity, key);
    productNames.set(item.identity, value(record, "name_en") || value(record, "name_ar"));

    const sku = identifier(record, "sku");
    const barcode = identifier(record, "barcode");
    const image = value(record, "image");
    const imageIsUrl = /^https:\/\/\S+$/i.test(image);
    if (image && !imageIsUrl) {
      issues.add("warning", "image_not_url", at(record, "image"), { cell: refOf(record, "image")! });
    }
    emit(
      "Products",
      canonicalRow(
        "Products",
        record,
        {
          product_key: key,
          action: CONVERTED_ROW_ACTION,
          internal_name: internalNameFor(value(record, "name_en"), key),
          display_name_en: value(record, "name_en"),
          display_name_ar: value(record, "name_ar"),
          description_en: value(record, "description_en"),
          description_ar: value(record, "description_ar"),
          sku,
          barcode,
          nutrition_calories: whole(record, "calories"),
          image_url: imageIsUrl ? image : "",
          status: DRAFT,
        },
        {
          product_key: item.cell,
          internal_name: refOf(record, "name_en"),
          display_name_en: refOf(record, "name_en"),
          display_name_ar: refOf(record, "name_ar"),
          description_en: refOf(record, "description_en"),
          description_ar: refOf(record, "description_ar"),
          sku: refOf(record, "sku"),
          barcode: refOf(record, "barcode"),
          nutrition_calories: refOf(record, "calories"),
          image_url: imageIsUrl ? refOf(record, "image") : undefined,
        },
        {
          ...channelsOf(record),
          product_cost: "cost",
          selling_method: "selling_method",
          is_stock_product: "is_stock_product",
          source_status: "is_active",
          preparation_time: "preparation_time",
          walking_time: "walking_time",
          high_salt: "high_salt",
          ...(imageIsUrl ? {} : { image: "image" }),
          ...unmappedOf(record),
        },
      ),
    );

    // Exactly one default variant per source product; never more (D-VARIANT).
    const tax = value(record, "tax");
    let taxBasisPoints = "";
    if (tax) {
      const converted = toBasisPoints(tax);
      if (converted.ok) {
        taxBasisPoints = converted.basisPoints;
        if (converted.digitsNormalized) digitsNormalizedIn.add(record.region);
      } else {
        issues.add(converted.code === "tax_unresolved" ? "warning" : "error", converted.code, at(record, "tax"), {
          cell: refOf(record, "tax")!,
          value: tax,
        });
      }
    }
    emit(
      "Variants",
      canonicalRow(
        "Variants",
        record,
        {
          variant_key: `${key}~default`,
          action: CONVERTED_ROW_ACTION,
          product_key: key,
          is_default: "TRUE",
          sort_order: "1",
          sku,
          barcode,
          amount_minor: minor(record, "price"),
          currency: money.currency ?? "",
          status: DRAFT,
          price_tax_basis: taxBasisOf(record, tax),
          tax_rate_basis_points: taxBasisPoints,
        },
        {
          variant_key: item.cell,
          product_key: item.cell,
          sku: refOf(record, "sku"),
          barcode: refOf(record, "barcode"),
          amount_minor: refOf(record, "price"),
          price_tax_basis: refOf(record, "tax_type") ?? (tax ? refOf(record, "tax") : undefined),
          tax_rate_basis_points: taxBasisPoints ? refOf(record, "tax") : undefined,
        },
        { price: "price", tax: "tax", type_of_tax: "tax_type" },
      ),
    );

    const category = value(record, "category");
    if (category) {
      const resolved = resolve(categoryLookup, category);
      const categoryKey = resolved.status === "ok" ? categoryKeys.get(resolved.identity) : undefined;
      if (resolved.status === "ok" && categoryKey) {
        emit(
          "Product Categories",
          canonicalRow(
            "Product Categories",
            record,
            {
              product_category_key: `${key}~${categoryKey}`,
              action: CONVERTED_ROW_ACTION,
              product_key: key,
              category_key: categoryKey,
              sort_order: "1",
            },
            { product_category_key: refOf(record, "category"), product_key: item.cell, category_key: refOf(record, "category") },
          ),
        );
      } else {
        reportUnresolved(record, "category", resolved.status === "ok" ? { status: "ambiguous" } : resolved);
      }
    }
  }

  /* Modifier groups and options ------------------------------------- */
  type Group = { key: string; identity: string; record: SourceRecord; nameAr: string; options: number };
  const groups = new Map<string, Group>();
  const groupLookup: Lookup = new Map();
  const optionLookup: Lookup = new Map();
  const optionKeys = new Map<string, string>();
  const optionItems: Array<{ record: SourceRecord; identity: string; group: Group; optionIdentity: string; cell?: string; column: string }> = [];

  for (const record of recordsOf("modifiers")) {
    const groupIdentity = identityText(value(record, "group_en"), value(record, "group_ar"));
    const optionIdentity = identityText(value(record, "option_en"), value(record, "option_ar"));
    if (!groupIdentity || !optionIdentity) {
      const missingRole = groupIdentity ? "option_en" : "group_en";
      issues.add("warning", "missing_identity", at(record, missingRole), {
        cell: refOf(record, missingRole) ?? refOf(record, groupIdentity ? "group_en" : "option_en")!,
        region: record.region,
      });
      continue;
    }
    let group = groups.get(groupIdentity);
    if (!group) {
      group = { key: keyFor("grp", groupIdentity), identity: groupIdentity, record, nameAr: value(record, "group_ar"), options: 0 };
      groups.set(groupIdentity, group);
      addLookup(groupLookup, value(record, "group_en"), groupIdentity);
      addLookup(groupLookup, value(record, "group_ar"), groupIdentity);
    } else {
      const ar = value(record, "group_ar");
      if (ar && !group.nameAr) {
        group.nameAr = ar;
      } else if (ar && ar !== group.nameAr) {
        issues.add("warning", "conflicting_values", at(record, "group_ar"), { cell: refOf(record, "group_ar")!, field: "group_ar" });
      }
    }
    optionItems.push({
      record,
      identity: `${groupIdentity}\u0000${optionIdentity}`,
      group,
      optionIdentity,
      cell: refOf(record, value(record, "option_en") ? "option_en" : "option_ar"),
      column: headerOf(record, value(record, "option_en") ? "option_en" : "option_ar"),
    });
  }
  for (const item of optionItems) {
    addLookup(optionLookup, value(item.record, "option_en"), item.identity);
    addLookup(optionLookup, value(item.record, "option_ar"), item.identity);
  }

  /* Assignments: product × group, and group-level selection limits --- */
  type Limit = { value: string; record: SourceRecord; role: string };
  const groupLimits = new Map<string, { min: Limit[]; max: Limit[] }>();
  const assignmentItems: Array<{ record: SourceRecord; identity: string; productKey: string; group: Group; cell?: string; column: string }> = [];
  for (const record of recordsOf("assignments")) {
    if (!value(record, "product") || !value(record, "group")) {
      const missingRole = value(record, "product") ? "group" : "product";
      issues.add("warning", "missing_identity", at(record, missingRole), {
        cell: refOf(record, missingRole) ?? refOf(record, missingRole === "group" ? "product" : "group")!,
        region: record.region,
      });
      continue;
    }
    const product = resolve(productLookup, value(record, "product"));
    const group = resolve(groupLookup, value(record, "group"));
    const productKey = product.status === "ok" ? productKeys.get(product.identity) : undefined;
    const groupEntry = group.status === "ok" ? groups.get(group.identity) : undefined;
    if (!productKey) reportUnresolved(record, "product", product.status === "ok" ? { status: "ambiguous" } : product);
    if (!groupEntry) reportUnresolved(record, "group", group);
    if (!productKey || !groupEntry) continue;

    const required = value(record, "required");
    let min = whole(record, "min");
    const max = whole(record, "max");
    if (!min && required && TRUE_WORDS.has(required.toLowerCase())) {
      min = "1";
    }
    const limits = groupLimits.get(groupEntry.identity) ?? { min: [], max: [] };
    if (min) limits.min.push({ value: min, record, role: value(record, "min") ? "min" : "required" });
    if (max) limits.max.push({ value: max, record, role: "max" });
    groupLimits.set(groupEntry.identity, limits);
    assignmentItems.push({
      record,
      identity: `${productKey}\u0000${groupEntry.key}`,
      productKey,
      group: groupEntry,
      cell: refOf(record, "group"),
      column: headerOf(record, "group"),
    });
  }

  const agreedLimit = (entries: Limit[], group: Group) => {
    const distinct = new Set(entries.map((entry) => entry.value));
    if (distinct.size <= 1) return entries[0]?.value ?? "";
    for (const entry of entries) {
      issues.add("error", "assignment_rule_conflict", at(entry.record, entry.role), {
        cell: refOf(entry.record, entry.role)!,
        group: normalizeIdentityText(value(group.record, "group_en") || value(group.record, "group_ar")),
      });
    }
    return "";
  };

  for (const group of groups.values()) {
    const limits = groupLimits.get(group.identity) ?? { min: [], max: [] };
    const { record } = group;
    emit(
      "Modifier Groups",
      canonicalRow(
        "Modifier Groups",
        record,
        {
          modifier_group_key: group.key,
          action: CONVERTED_ROW_ACTION,
          internal_name: internalNameFor(value(record, "group_en"), group.key),
          display_name_en: value(record, "group_en"),
          display_name_ar: group.nameAr,
          min_selections: agreedLimit(limits.min, group),
          max_selections: agreedLimit(limits.max, group),
          status: DRAFT,
        },
        {
          modifier_group_key: refOf(record, value(record, "group_en") ? "group_en" : "group_ar"),
          internal_name: refOf(record, "group_en"),
          display_name_en: refOf(record, "group_en"),
          display_name_ar: refOf(record, "group_ar"),
        },
      ),
    );
  }

  for (const item of partitionIdentities(optionItems, issues)) {
    const { record, group } = item;
    group.options += 1;
    const key = `${group.key}~${keyFor("opt", item.optionIdentity)}`;
    optionKeys.set(item.identity, key);
    emit(
      "Modifier Options",
      canonicalRow(
        "Modifier Options",
        record,
        {
          modifier_option_key: key,
          action: CONVERTED_ROW_ACTION,
          modifier_group_key: group.key,
          display_name_en: value(record, "option_en"),
          display_name_ar: value(record, "option_ar"),
          price_minor: minor(record, "price"),
          currency: money.currency ?? "",
          // Equal to the catalogue_modifier_options defaults (derived, not read).
          is_default: "FALSE",
          allows_quantity: "FALSE",
          max_quantity: "1",
          sort_order: String(group.options),
          status: DRAFT,
        },
        {
          modifier_option_key: item.cell,
          modifier_group_key: refOf(record, value(record, "group_en") ? "group_en" : "group_ar"),
          display_name_en: refOf(record, "option_en"),
          display_name_ar: refOf(record, "option_ar"),
          price_minor: refOf(record, "price"),
        },
        {
          option_price: "price",
          ...channelsOf(record),
          option_cost: "cost",
          option_calories: "calories",
          ...unmappedOf(record),
        },
      ),
    );
  }

  const productModifierCounts = new Map<string, number>();
  for (const item of partitionIdentities(assignmentItems, issues)) {
    const { record } = item;
    const position = (productModifierCounts.get(item.productKey) ?? 0) + 1;
    productModifierCounts.set(item.productKey, position);
    emit(
      "Product Modifiers",
      canonicalRow(
        "Product Modifiers",
        record,
        {
          product_modifier_key: `${item.productKey}~${item.group.key}`,
          action: CONVERTED_ROW_ACTION,
          product_key: item.productKey,
          modifier_group_key: item.group.key,
          sort_order: String(position),
          free_options_count: whole(record, "free_options"),
        },
        {
          product_modifier_key: refOf(record, "product"),
          product_key: refOf(record, "product"),
          modifier_group_key: refOf(record, "group"),
          free_options_count: refOf(record, "free_options"),
        },
        { assignment_required: "required", allow_repeat: "allow_repeat", ...unmappedOf(record) },
      ),
    );
  }

  /* Ingredients, units, inventory categories ------------------------ */
  const ingredientLookup: Lookup = new Map();
  const ingredientItems = recordsOf("ingredients").map((record) => ({
    record,
    identity: identityText(value(record, "name_en"), value(record, "name_ar")),
    cell: refOf(record, value(record, "name_en") ? "name_en" : "name_ar"),
    column: headerOf(record, value(record, "name_en") ? "name_en" : "name_ar"),
  }));
  for (const item of ingredientItems) {
    addLookup(ingredientLookup, value(item.record, "name_en"), item.identity);
    addLookup(ingredientLookup, value(item.record, "name_ar"), item.identity);
  }
  const keptIngredients = partitionIdentities(ingredientItems, issues);
  const ingredientKeys = new Map(keptIngredients.map((item) => [item.identity, keyFor("ing", item.identity)]));
  const ingredientNames = new Map(
    keptIngredients.map((item) => [item.identity, value(item.record, "name_en") || value(item.record, "name_ar")]),
  );

  const preparedIdentities = new Set<string>();
  for (const record of recordsOf("prepared_recipe_lines")) {
    const resolved = resolve(ingredientLookup, value(record, "prepared_item"));
    if (resolved.status === "ok" && ingredientKeys.has(resolved.identity)) preparedIdentities.add(resolved.identity);
  }

  const units = new Map<string, { key: string; record: SourceRecord; role: string; text: string }>();
  const unitKey = (record: SourceRecord, role: string) => {
    const text = value(record, role);
    if (!text) return "";
    const identity = normalizeIdentityText(text);
    if (!units.has(identity)) units.set(identity, { key: keyFor("unit", identity), record, role, text });
    return units.get(identity)!.key;
  };
  const inventoryCategories = new Map<string, { key: string; record: SourceRecord; text: string }>();

  for (const item of keptIngredients) {
    const { record } = item;
    const key = ingredientKeys.get(item.identity)!;
    const cost = decimal(record, "cost");
    const categoryText = value(record, "inventory_category");
    let inventoryCategoryKey = "";
    if (categoryText) {
      const identity = normalizeIdentityText(categoryText);
      if (!inventoryCategories.has(identity)) {
        inventoryCategories.set(identity, { key: keyFor("invcat", identity), record, text: categoryText });
      }
      inventoryCategoryKey = inventoryCategories.get(identity)!.key;
    }
    emit(
      "Ingredients",
      canonicalRow(
        "Ingredients",
        record,
        {
          ingredient_key: key,
          action: CONVERTED_ROW_ACTION,
          name_en: value(record, "name_en"),
          name_ar: value(record, "name_ar"),
          inventory_category_key: inventoryCategoryKey,
          ingredient_type: preparedIdentities.has(item.identity) ? "PREPARED" : "PURCHASED",
          storage_unit_key: unitKey(record, "storage_unit"),
          recipe_unit_key: unitKey(record, "recipe_unit"),
          recipe_units_per_storage_unit: decimal(record, "units_per_storage"),
          reference_cost_per_storage_unit: cost,
          cost_currency: cost ? (money.currency ?? "") : "",
          cost_tax_basis: cost ? "UNCONFIRMED" : "",
          active: "TRUE",
        },
        {
          ingredient_key: item.cell,
          name_en: refOf(record, "name_en"),
          name_ar: refOf(record, "name_ar"),
          inventory_category_key: refOf(record, "inventory_category"),
          storage_unit_key: refOf(record, "storage_unit"),
          recipe_unit_key: refOf(record, "recipe_unit"),
          recipe_units_per_storage_unit: refOf(record, "units_per_storage"),
          reference_cost_per_storage_unit: refOf(record, "cost"),
        },
        { ingredient_cost: "cost", ...unmappedOf(record) },
      ),
    );
  }

  for (const unit of units.values()) {
    const kind = QUANTITY_KINDS[unit.text.toLowerCase()] ?? "";
    if (!kind) {
      issues.add("warning", "unit_kind_unresolved", at(unit.record, unit.role), {
        cell: refOf(unit.record, unit.role)!,
        value: unit.text,
      });
    }
    emit(
      "Units",
      canonicalRow(
        "Units",
        unit.record,
        { unit_key: unit.key, action: CONVERTED_ROW_ACTION, name: unit.text, quantity_kind: kind, decimal_places: "3", active: "TRUE" },
        { unit_key: refOf(unit.record, unit.role), name: refOf(unit.record, unit.role) },
      ),
    );
  }
  for (const category of inventoryCategories.values()) {
    emit(
      "Inventory Categories",
      canonicalRow(
        "Inventory Categories",
        category.record,
        { inventory_category_key: category.key, action: CONVERTED_ROW_ACTION, name_en: category.text, active: "TRUE" },
        {
          inventory_category_key: refOf(category.record, "inventory_category"),
          name_en: refOf(category.record, "inventory_category"),
        },
      ),
    );
  }

  /* Recipes and recipe lines ---------------------------------------- */
  type Recipe = { versionKey: string; recipeKey: string; record: SourceRecord; lines: number; values: Record<string, string>; cells: Record<string, string | undefined> };
  const recipes = new Map<string, Recipe>();
  const lineRows: CanonicalRow[] = [];

  const resolveIngredient = (record: SourceRecord) => {
    const resolved = resolve(ingredientLookup, value(record, "ingredient"));
    const key = resolved.status === "ok" ? ingredientKeys.get(resolved.identity) : undefined;
    if (!key) reportUnresolved(record, "ingredient", resolved.status === "ok" ? { status: "ambiguous" } : resolved);
    return key;
  };

  const addLine = (recipe: Recipe, record: SourceRecord, ingredientKey: string) => {
    recipe.lines += 1;
    lineRows.push(
      canonicalRow(
        "Recipe Lines",
        record,
        {
          recipe_line_key: `${recipe.versionKey}~${recipe.lines}`,
          action: CONVERTED_ROW_ACTION,
          recipe_version_key: recipe.versionKey,
          ingredient_key: ingredientKey,
          quantity_recipe_units: decimal(record, "quantity"),
          sort_order: String(recipe.lines),
        },
        {
          recipe_version_key: recipe.cells.recipe_version_key,
          ingredient_key: refOf(record, "ingredient"),
          quantity_recipe_units: refOf(record, "quantity"),
        },
      ),
    );
  };

  for (const record of recordsOf("product_recipe_lines")) {
    const product = resolve(productLookup, value(record, "product"));
    const productKey = product.status === "ok" ? productKeys.get(product.identity) : undefined;
    if (!productKey) reportUnresolved(record, "product", product.status === "ok" ? { status: "ambiguous" } : product);
    const ingredientKey = resolveIngredient(record);
    if (!productKey || !ingredientKey || product.status !== "ok") continue;
    const recipeKey = keyFor("rcp", `product:${product.identity}`);
    let recipe = recipes.get(recipeKey);
    if (!recipe) {
      recipe = {
        recipeKey,
        versionKey: `${recipeKey}~v1`,
        record,
        lines: 0,
        values: {
          target_type: "SOLD_VARIANT",
          variant_key: `${productKey}~default`,
          name: productNames.get(product.identity) ?? "",
        },
        cells: { recipe_version_key: refOf(record, "product"), variant_key: refOf(record, "product") },
      };
      recipes.set(recipeKey, recipe);
    }
    addLine(recipe, record, ingredientKey);
  }

  for (const record of recordsOf("prepared_recipe_lines")) {
    const prepared = resolve(ingredientLookup, value(record, "prepared_item"));
    const preparedKey = prepared.status === "ok" ? ingredientKeys.get(prepared.identity) : undefined;
    if (!preparedKey) reportUnresolved(record, "prepared_item", prepared.status === "ok" ? { status: "ambiguous" } : prepared);
    const ingredientKey = resolveIngredient(record);
    if (!preparedKey || !ingredientKey || prepared.status !== "ok") continue;
    const recipeKey = keyFor("rcp", `prepared:${prepared.identity}`);
    let recipe = recipes.get(recipeKey);
    if (!recipe) {
      recipe = {
        recipeKey,
        versionKey: `${recipeKey}~v1`,
        record,
        lines: 0,
        values: {
          target_type: "PREPARED_ITEM",
          prepared_ingredient_key: preparedKey,
          name: ingredientNames.get(prepared.identity) ?? "",
        },
        cells: { recipe_version_key: refOf(record, "prepared_item"), prepared_ingredient_key: refOf(record, "prepared_item") },
      };
      recipes.set(recipeKey, recipe);
    }
    addLine(recipe, record, ingredientKey);
  }

  for (const recipe of recipes.values()) {
    // The source has no yield unit; it is never invented. Prepared recipes
    // are definitions only: no prep target, opening stock or posting.
    issues.add("warning", "yield_unit_unresolved", { sheet: recipe.record.sheet, row: recipe.record.row }, {
      cell: recipe.cells.recipe_version_key!,
      recipe: recipe.values.name ?? "",
    });
    emit(
      "Recipes",
      canonicalRow(
        "Recipes",
        recipe.record,
        {
          recipe_version_key: recipe.versionKey,
          action: CONVERTED_ROW_ACTION,
          recipe_key: recipe.recipeKey,
          version_number: "1",
          yield_quantity: "1",
          ...recipe.values,
        },
        { ...recipe.cells, recipe_key: recipe.cells.recipe_version_key, name: recipe.cells.recipe_version_key },
      ),
    );
  }
  for (const line of lineRows) emit("Recipe Lines", line);

  /* Modifier effects ------------------------------------------------- */
  const resolveOption = (record: SourceRecord): string | undefined => {
    const text = value(record, "option");
    let resolved = resolve(optionLookup, text);
    // `Group / Option` or `Group > Option` names the group explicitly.
    const qualified = resolved.status === "ok" ? null : /^(.+?)\s*[/>]\s*(.+)$/.exec(text);
    if (qualified) {
      const group = resolve(groupLookup, qualified[1]!);
      if (group.status === "ok") {
        const inGroup = [...(optionLookup.get(normalizeIdentityText(qualified[2]!)) ?? [])].filter((identity) =>
          identity.startsWith(`${group.identity}\u0000`),
        );
        if (inGroup.length === 1) resolved = { status: "ok", identity: inGroup[0]! };
      }
    }
    const key = resolved.status === "ok" ? optionKeys.get(resolved.identity) : undefined;
    if (!key) reportUnresolved(record, "option", resolved.status === "ok" ? { status: "ambiguous" } : resolved);
    return key;
  };

  const effectItems: Array<{ record: SourceRecord; identity: string; optionKey: string; ingredientKey: string; ingredientIdentity: string; cell?: string; column: string }> = [];
  for (const record of recordsOf("modifier_ingredient_lines")) {
    const optionKey = resolveOption(record);
    const ingredient = resolve(ingredientLookup, value(record, "ingredient"));
    const ingredientKey = ingredient.status === "ok" ? ingredientKeys.get(ingredient.identity) : undefined;
    if (!ingredientKey) reportUnresolved(record, "ingredient", ingredient.status === "ok" ? { status: "ambiguous" } : ingredient);
    if (!optionKey || !ingredientKey || ingredient.status !== "ok") continue;
    effectItems.push({
      record,
      identity: `${optionKey}\u0000${ingredient.identity}`,
      optionKey,
      ingredientKey,
      ingredientIdentity: ingredient.identity,
      cell: refOf(record, "ingredient"),
      column: headerOf(record, "ingredient"),
    });
  }
  for (const item of partitionIdentities(effectItems, issues)) {
    const { record } = item;
    // Effects belong to options in the source, not to recipe versions; the
    // recipe version is left for review (QOS-194/199) instead of guessed.
    issues.add("warning", "effect_recipe_unresolved", at(record, "option"), { cell: refOf(record, "option")! });
    emit(
      "Modifier Effects",
      canonicalRow(
        "Modifier Effects",
        record,
        {
          effect_key: `${item.optionKey}~${keyFor("eff", item.ingredientIdentity)}`,
          action: CONVERTED_ROW_ACTION,
          modifier_option_key: item.optionKey,
          effect_type: "ADD",
          ingredient_key: item.ingredientKey,
          quantity_per_sold_unit: decimal(record, "quantity"),
        },
        {
          effect_key: refOf(record, "option"),
          modifier_option_key: refOf(record, "option"),
          ingredient_key: refOf(record, "ingredient"),
          quantity_per_sold_unit: refOf(record, "quantity"),
        },
      ),
    );
  }

  for (const region of digitsNormalizedIn) {
    issues.add("info", "digits_normalized", {}, { region });
  }

  /* Result ---------------------------------------------------------- */
  const regionsBySheet: Partial<Record<string, RegionId[]>> = {
    Categories: ["categories"],
    Products: ["products"],
    "Product Categories": ["products"],
    Variants: ["products"],
    "Modifier Groups": ["modifiers"],
    "Modifier Options": ["modifiers"],
    "Product Modifiers": ["assignments"],
    Units: ["ingredients"],
    "Inventory Categories": ["ingredients"],
    Ingredients: ["ingredients"],
    Recipes: ["product_recipe_lines", "prepared_recipe_lines"],
    "Recipe Lines": ["product_recipe_lines", "prepared_recipe_lines"],
    "Modifier Effects": ["modifier_ingredient_lines"],
  };

  const sheets: WorkbookSheetResult[] = WORKBOOK_CONTRACT.sheets.map((definition) => {
    const rows = out.get(definition.name) ?? [];
    const support = sheetSupport(definition.name);
    const headerRow = sheetHeaderRow(definition);
    const sheetIssues: WorkbookIssue[] = [];
    if (rows.length > 0 && support === "deferred") {
      sheetIssues.push({ severity: "warning", code: "deferred_sheet", sheet: definition.name, params: { count: rows.length } });
    }
    if (support === "supported") {
      for (const column of definition.columns.filter(isDeferredField)) {
        const count = rows.filter((row) => row.values[column.key]).length;
        if (count > 0) {
          sheetIssues.push({ severity: "warning", code: "deferred_field", sheet: definition.name, column: column.key, params: { count } });
        }
      }
    }
    return {
      sheet: definition.name,
      table: tableNameForSheet(definition.name),
      support,
      phase: definition.phase,
      present: (regionsBySheet[definition.name] ?? []).some((id) => scanned.has(id)),
      headerRow,
      firstDataRow: headerRow + 1,
      columns: rows.length > 0 ? definition.columns.map((column) => column.key) : [],
      rowCount: rows.length,
      rows: rows.map((row, index) => ({ row: headerRow + 1 + index, values: row.values, source: row.source })),
      issues: sheetIssues,
    };
  });

  const capabilityCounts = new Map<string, FoodicsCapability>();
  const countCapability = (sheet: string, column: string) => {
    const id = `${sheet}\u0000${column}`;
    const existing = capabilityCounts.get(id);
    if (existing) {
      existing.rows += 1;
      return;
    }
    const entry = capabilityFor(sheet, column);
    capabilityCounts.set(id, {
      sheet,
      column,
      class: entry?.class ?? "deferred",
      owner: entry?.owner ?? "",
      rows: 1,
    });
  };
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const [column, cellValue] of Object.entries(row.values)) {
        if (cellValue) countCapability(sheet.sheet, column);
      }
      for (const field of Object.keys(row.source?.preserved ?? {})) {
        countCapability(SOURCE_MAP_SHEET, field);
      }
    }
  }
  const capabilities = [...capabilityCounts.values()];

  const channelCounts = new Map<string, number>();
  for (const sheet of sheets) {
    for (const row of sheet.rows) {
      for (const field of Object.keys(row.source?.preserved ?? {})) {
        if (field.startsWith("channel_price:")) {
          const label = field.slice("channel_price:".length);
          channelCounts.set(label, (channelCounts.get(label) ?? 0) + 1);
        }
      }
    }
  }
  if (channelCounts.size > FOODICS_MENU_LIMITS.maxChannelLabels) {
    throw new WorkbookParseError("too_many_columns", `The workbook has more than ${FOODICS_MENU_LIMITS.maxChannelLabels} channel price columns.`, {
      max: FOODICS_MENU_LIMITS.maxChannelLabels,
    });
  }

  const tenantPublicId = options.tenantPublicId ?? "";
  const brandChoices = options.brandChoices ?? [];
  const brandPublicId = options.brandPublicId ?? (brandChoices.length === 1 ? brandChoices[0]!.publicId : null);
  const sourceNamespace = tenantPublicId ? foodicsSourceNamespace(tenantPublicId) : "";
  const requiredMappings: FoodicsRequiredMapping[] = [
    currency ? { kind: "currency", status: "resolved", value: currency } : { kind: "currency", status: "required" },
    brandPublicId
      ? { kind: "brand", status: "resolved", value: brandPublicId }
      : { kind: "brand", status: "required", ...(brandChoices.length > 0 ? { choices: brandChoices } : {}) },
    { kind: "namespace", status: sourceNamespace ? "resolved" : "required", value: sourceNamespace },
    ...[...channelCounts].map(([label, prices]) => ({ kind: "channel" as const, status: "deferred" as const, label, prices })),
  ];

  const summary: FoodicsMenuParseResult["summary"] = {
    supported: { sheets: 0, rows: 0 },
    deferred: { sheets: 0, rows: 0 },
    rejected: { sheets: 0, rows: 0 },
    separate_profile: { sheets: 0, rows: 0 },
    errors: 0,
    warnings: 0,
    recognizedRows: 0,
    deferredRows: 0,
    deferredValues: 0,
  };
  for (const sheet of sheets) {
    if (sheet.rowCount > 0) summary[sheet.support].sheets += 1;
    summary[sheet.support].rows += sheet.rowCount;
  }
  summary.recognizedRows = summary.supported.rows;
  summary.deferredRows = summary.deferred.rows;
  // Values QOS cannot import yet: deferred columns on supported sheets and
  // Source Map values with no QOS column. Exact-text copies kept beside an
  // imported integer (price, option price, ingredient cost) and the tax text
  // behind the already counted tax columns are provenance, not extra values.
  summary.deferredValues = capabilities
    .filter(
      (entry) =>
        entry.class === "deferred" &&
        sheetSupport(entry.sheet) !== "deferred" &&
        !(entry.sheet === SOURCE_MAP_SHEET && PROVENANCE_COPIES.has(entry.column)),
    )
    .reduce((total, entry) => total + entry.rows, 0);
  for (const entry of [...issues.list, ...sheets.flatMap((sheet) => sheet.issues)]) {
    if (entry.severity === "error") summary.errors += 1;
    if (entry.severity === "warning") summary.warnings += 1;
  }

  return {
    profile: "foodics_menu_v1",
    profileVersion: FOODICS_MENU_PROFILE.version,
    dictionaryVersion: FOODICS_MENU_PROFILE.dictionaryVersion,
    fileName,
    fileFingerprint: createHash("sha256").update(bytes).digest("hex"),
    templateVersion: WORKBOOK_CONTRACT.version,
    layout: { regions: regionSummaries, ignoredSheets: layout.ignoredSheets },
    context: { tenantPublicId, brandPublicId, currency, sourceNamespace },
    requiredMappings,
    sheets,
    capabilities,
    issues: issues.list,
    summary,
  };
}
