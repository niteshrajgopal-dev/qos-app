import { createHash } from "node:crypto";

import {
  CatalogueImportParseError,
  parseSpreadsheetUpload,
  suggestColumnMapping,
} from "@/lib/catalogue/catalogue-import-parser";
import {
  FIELD_GUIDE_TABLE,
  GUIDANCE_SHEETS,
  isDeferredField,
  isIdentifierColumn,
  ROW_CHECK_COLUMN,
  sheetHeaderRow,
  sheetSupport,
  tableNameForSheet,
  WORKBOOK_CONTRACT,
  WORKBOOK_LAYOUT,
  type WorkbookSheetDefinition,
  type WorkbookSheetSupport,
} from "@/lib/workbook/contract";
import { WorkbookParseError } from "@/lib/workbook/errors";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import { readWorkbookManifest, type WorkbookManifest } from "@/lib/workbook/manifest";
import {
  cellKey,
  columnLetters,
  readXlsxPackage,
  type PackageSheet,
  type SheetTable,
  type XlsxPackage,
} from "@/lib/workbook/ooxml";
import { detectUploadContainer, detectXlsxProfile } from "@/lib/workbook/profiles";

/* Stateless parse of an uploaded workbook (QOS-193). It reads the bytes,
   classifies every sheet and returns the business rows it found. It does not
   validate references or business rules (QOS-194) and it never applies
   anything (QOS-200); every parsed row is a draft candidate only. */

export type WorkbookIssueSeverity = "error" | "warning" | "info";

export type WorkbookIssueCode =
  | "formula_ignored"
  | "cell_error"
  | "identifier_number"
  | "deferred_field"
  | "deferred_sheet"
  | "opening_stock_draft"
  | "rejected_sheet"
  | "current_import_tab"
  | "missing_columns"
  | "unknown_columns"
  | "duplicate_columns"
  | "table_position"
  | "rows_outside_table"
  | "sheet_missing"
  | "unknown_sheet"
  | "unknown_table"
  | "tenant_mismatch"
  | "brand_mismatch"
  | "manifest_unknown_field";

export type WorkbookIssue = {
  severity: WorkbookIssueSeverity;
  code: WorkbookIssueCode;
  sheet?: string;
  row?: number;
  column?: string;
  params?: Record<string, string | number>;
};

export type WorkbookRow = {
  /** Spreadsheet row number, as the person sees it in Excel. */
  row: number;
  values: Record<string, string>;
};

export type WorkbookSheetResult = {
  sheet: string;
  table: string;
  support: WorkbookSheetSupport;
  phase: string;
  present: boolean;
  headerRow: number;
  firstDataRow: number;
  columns: string[];
  rowCount: number;
  rows: WorkbookRow[];
  issues: WorkbookIssue[];
};

export type ExtendedWorkbookParseResult = {
  profile: "qos_extended_v1";
  fileName: string;
  fileFingerprint: string;
  templateVersion: string;
  manifest: WorkbookManifest;
  isExport: boolean;
  guidanceSheets: string[];
  sheets: WorkbookSheetResult[];
  issues: WorkbookIssue[];
  summary: Record<WorkbookSheetSupport, { sheets: number; rows: number }> & {
    errors: number;
    warnings: number;
  };
};

export type LegacyWorkbookParseResult = {
  profile: "legacy_flat";
  container: "csv" | "xlsx";
  fileName: string;
  fileFingerprint: string;
  headers: string[];
  rowCount: number;
  rows: Array<Record<string, string>>;
  suggestedMapping: ReturnType<typeof suggestColumnMapping>;
  warnings: string[];
};

export type WorkbookParseResult = ExtendedWorkbookParseResult | LegacyWorkbookParseResult;

export type WorkbookParseOptions = {
  /** Public id of the tenant the caller is working in; a manifest naming another tenant is flagged. */
  tenantPublicId?: string;
  /** Brand public ids of that tenant; a manifest naming any other brand is flagged. */
  brandPublicIds?: string[];
};

async function parseLegacy(
  fileName: string,
  bytes: Buffer,
  container: "csv" | "xlsx",
): Promise<LegacyWorkbookParseResult> {
  try {
    const parsed = await parseSpreadsheetUpload({ fileName, bytes });
    return {
      profile: "legacy_flat",
      container,
      fileName: parsed.fileName,
      fileFingerprint: parsed.fileFingerprint,
      headers: parsed.headers,
      rowCount: parsed.rows.length,
      rows: parsed.rows,
      suggestedMapping: suggestColumnMapping(parsed.headers),
      warnings: parsed.warnings,
    };
  } catch (error) {
    if (error instanceof CatalogueImportParseError) {
      throw new WorkbookParseError("legacy_parse_failed", error.message, { field: error.field ?? "" });
    }
    if (error instanceof WorkbookParseError) {
      throw error;
    }
    throw new WorkbookParseError("malformed_workbook", "The workbook could not be read as the current catalogue profile.");
  }
}

function findTable(pkg: XlsxPackage, tableName: string) {
  for (const sheet of pkg.sheets) {
    const table = sheet.tables.find((candidate) => candidate.name === tableName);
    if (table) {
      return { sheet, table };
    }
  }
  return null;
}

function headerNames(sheet: PackageSheet, table: SheetTable) {
  const width = table.range.endColumn - table.range.startColumn + 1;
  return Array.from({ length: width }, (_, offset) => {
    const fromTable = table.columnNames[offset]?.trim();
    if (fromTable) {
      return fromTable;
    }
    return sheet.cells.get(cellKey(table.range.startRow, table.range.startColumn + offset))?.text.trim() ?? "";
  });
}

type TextBudget = { used: number };

function chargeText(budget: TextBudget, value: string) {
  budget.used += value.length;
  if (budget.used > WORKBOOK_LIMITS.maxTotalTextLength) {
    throw new WorkbookParseError("too_much_text", "The workbook contains more text than one upload may carry.", {
      max: WORKBOOK_LIMITS.maxTotalTextLength,
    });
  }
}

function emptySheetResult(definition: WorkbookSheetDefinition): WorkbookSheetResult {
  const headerRow = sheetHeaderRow(definition);
  return {
    sheet: definition.name,
    table: tableNameForSheet(definition.name),
    support: sheetSupport(definition.name),
    phase: definition.phase,
    present: false,
    headerRow,
    firstDataRow: headerRow + 1,
    columns: [],
    rowCount: 0,
    rows: [],
    issues: [],
  };
}

function readContractTable(
  pkg: XlsxPackage,
  definition: WorkbookSheetDefinition,
  budget: TextBudget,
): WorkbookSheetResult {
  const result = emptySheetResult(definition);
  const issue = (entry: Omit<WorkbookIssue, "sheet">) => result.issues.push({ sheet: definition.name, ...entry });
  const found = findTable(pkg, result.table);

  if (!found) {
    const sheetExists = pkg.sheets.some((sheet) => sheet.name === definition.name);
    issue({
      severity: sheetExists && result.support === "supported" ? "warning" : "info",
      code: "sheet_missing",
      params: { table: result.table },
    });
    return result;
  }

  const { sheet, table } = found;
  result.present = true;

  if (table.headerRowCount !== 1 || table.range.startRow !== result.headerRow) {
    issue({
      severity: "error",
      code: "table_position",
      params: { expectedRow: result.headerRow, actualRow: table.range.startRow, ref: table.ref },
    });
    return result;
  }

  const width = table.range.endColumn - table.range.startColumn + 1;
  if (width > WORKBOOK_LIMITS.maxColumnsPerTable) {
    throw new WorkbookParseError("too_many_columns", `${result.table} has more than ${WORKBOOK_LIMITS.maxColumnsPerTable} columns.`, {
      table: result.table,
      max: WORKBOOK_LIMITS.maxColumnsPerTable,
    });
  }
  const lastDataRow = table.range.endRow - table.totalsRowCount;
  const capacity = Math.max(0, lastDataRow - table.range.startRow);
  if (capacity > WORKBOOK_LIMITS.maxRowsPerTable) {
    throw new WorkbookParseError("too_many_rows", `${result.table} has more than ${WORKBOOK_LIMITS.maxRowsPerTable} rows.`, {
      table: result.table,
      max: WORKBOOK_LIMITS.maxRowsPerTable,
    });
  }

  const headers = headerNames(sheet, table);
  result.columns = headers;
  const duplicates = headers.filter((header, index) => header && headers.indexOf(header) !== index);
  if (duplicates.length > 0) {
    issue({ severity: "error", code: "duplicate_columns", params: { columns: [...new Set(duplicates)].join(", ") } });
    return result;
  }

  const columnIndex = new Map(headers.map((header, index) => [header, table.range.startColumn + index]));
  const missing = definition.columns.filter((column) => !columnIndex.has(column.key));
  const missingRequired = missing.filter((column) => column.required);
  if (missingRequired.length > 0) {
    issue({
      severity: "error",
      code: "missing_columns",
      params: { columns: missingRequired.map((column) => column.key).join(", ") },
    });
    return result;
  }
  if (missing.length > 0) {
    issue({ severity: "warning", code: "missing_columns", params: { columns: missing.map((column) => column.key).join(", ") } });
  }

  const known = new Set([...definition.columns.map((column) => column.key), ROW_CHECK_COLUMN]);
  const unknown = headers.filter((header) => header && !known.has(header));
  if (unknown.length > 0) {
    issue({ severity: "warning", code: "unknown_columns", params: { columns: unknown.join(", ") } });
  }

  const presentColumns = definition.columns.filter((column) => columnIndex.has(column.key));
  const deferredCounts = new Map<string, number>();

  for (let rowNumber = table.range.startRow + 1; rowNumber <= lastDataRow; rowNumber += 1) {
    const values: Record<string, string> = {};
    let filled = false;

    for (const column of presentColumns) {
      const columnNumber = columnIndex.get(column.key)!;
      const cell = sheet.cells.get(cellKey(rowNumber, columnNumber));
      const reference = `${columnLetters(columnNumber)}${rowNumber}`;
      values[column.key] = "";
      if (!cell) {
        continue;
      }

      if (cell.formula) {
        // Formulas are helpers in the workbook. Their results are never
        // evaluated or trusted as input; the person must type the value.
        filled = true;
        issue({ severity: "error", code: "formula_ignored", row: rowNumber, column: column.key, params: { cell: reference } });
        continue;
      }
      if (cell.kind === "error") {
        filled = true;
        issue({ severity: "error", code: "cell_error", row: rowNumber, column: column.key, params: { cell: reference } });
        continue;
      }

      const text = cell.text.trim();
      if (!text) {
        continue;
      }
      if (text.length > WORKBOOK_LIMITS.maxCellLength) {
        throw new WorkbookParseError(
          "cell_too_long",
          `Cell ${definition.name}!${reference} exceeds the ${WORKBOOK_LIMITS.maxCellLength}-character limit.`,
          { sheet: definition.name, cell: reference, max: WORKBOOK_LIMITS.maxCellLength },
        );
      }
      chargeText(budget, text);
      filled = true;
      values[column.key] = text;

      if (cell.kind === "number" && isIdentifierColumn(column)) {
        issue({ severity: "warning", code: "identifier_number", row: rowNumber, column: column.key, params: { cell: reference } });
      }
      if (result.support === "supported" && isDeferredField(column)) {
        deferredCounts.set(column.key, (deferredCounts.get(column.key) ?? 0) + 1);
      }
    }

    if (filled) {
      result.rows.push({ row: rowNumber, values });
    }
  }

  for (const [column, count] of deferredCounts) {
    issue({ severity: "warning", code: "deferred_field", column, params: { count } });
  }

  // Typing below a table that did not grow leaves rows QOS will not read.
  const businessColumns = presentColumns.map((column) => columnIndex.get(column.key)!);
  let outside = 0;
  for (const key of sheet.cells.keys()) {
    const [row, column] = key.split(":").map(Number) as [number, number];
    if (row > table.range.endRow && businessColumns.includes(column) && sheet.cells.get(key)!.text.trim()) {
      outside += 1;
    }
  }
  if (outside > 0) {
    issue({ severity: "warning", code: "rows_outside_table", params: { cells: outside, lastRow: table.range.endRow } });
  }

  result.rowCount = result.rows.length;
  if (result.rowCount > 0) {
    if (result.support === "deferred") {
      issue({
        severity: "warning",
        code: definition.name === "Opening Stock" ? "opening_stock_draft" : "deferred_sheet",
        params: { count: result.rowCount },
      });
    } else if (result.support === "rejected") {
      issue({ severity: "warning", code: "rejected_sheet", params: { count: result.rowCount } });
    } else if (result.support === "separate_profile") {
      issue({ severity: "warning", code: "current_import_tab", params: { count: result.rowCount } });
    }
  }
  if (result.support === "separate_profile") {
    // The flat tab is uploaded on its own; its rows are counted, not carried.
    result.rows = [];
  }

  return result;
}

function parseExtended(
  fileName: string,
  bytes: Buffer,
  pkg: XlsxPackage,
  options: WorkbookParseOptions,
): ExtendedWorkbookParseResult {
  const manifestResult = readWorkbookManifest(pkg, options);
  const budget: TextBudget = { used: 0 };
  const sheets = WORKBOOK_CONTRACT.sheets.map((definition) => readContractTable(pkg, definition, budget));
  const issues: WorkbookIssue[] = [...manifestResult.issues];

  const contractNames = new Set<string>([...WORKBOOK_CONTRACT.sheets.map((sheet) => sheet.name), ...GUIDANCE_SHEETS]);
  const unknownSheets = pkg.sheets.map((sheet) => sheet.name).filter((name) => !contractNames.has(name));
  if (unknownSheets.length > 0) {
    issues.push({ severity: "warning", code: "unknown_sheet", params: { sheets: unknownSheets.join(", ") } });
  }

  const knownTables = new Set([
    WORKBOOK_LAYOUT.manifestTable,
    FIELD_GUIDE_TABLE,
    ...WORKBOOK_CONTRACT.sheets.map((sheet) => tableNameForSheet(sheet.name)),
  ]);
  const unknownTables = pkg.sheets
    .flatMap((sheet) => sheet.tables.map((table) => table.name))
    .filter((name) => !knownTables.has(name));
  if (unknownTables.length > 0) {
    issues.push({ severity: "warning", code: "unknown_table", params: { tables: unknownTables.join(", ") } });
  }

  const summary: ExtendedWorkbookParseResult["summary"] = {
    supported: { sheets: 0, rows: 0 },
    deferred: { sheets: 0, rows: 0 },
    rejected: { sheets: 0, rows: 0 },
    separate_profile: { sheets: 0, rows: 0 },
    errors: 0,
    warnings: 0,
  };
  for (const sheet of sheets) {
    if (sheet.present) {
      summary[sheet.support].sheets += 1;
    }
    summary[sheet.support].rows += sheet.rowCount;
  }
  for (const entry of [...issues, ...sheets.flatMap((sheet) => sheet.issues)]) {
    if (entry.severity === "error") summary.errors += 1;
    if (entry.severity === "warning") summary.warnings += 1;
  }

  return {
    profile: "qos_extended_v1",
    fileName,
    fileFingerprint: createHash("sha256").update(bytes).digest("hex"),
    templateVersion: manifestResult.manifest.template_version,
    manifest: manifestResult.manifest,
    isExport: Boolean(manifestResult.manifest.export_revision),
    guidanceSheets: GUIDANCE_SHEETS.filter((name) => pkg.sheets.some((sheet) => sheet.name === name)),
    sheets,
    issues,
    summary,
  };
}

/**
 * Parses uploaded bytes into one of the two profiles. Every result is
 * derived from the bytes: the file name only has to agree with the content.
 */
export async function parseWorkbookUpload(
  input: { fileName: string; bytes: Buffer },
  options: WorkbookParseOptions = {},
): Promise<WorkbookParseResult> {
  const container = detectUploadContainer(input.fileName, input.bytes);
  if (container === "csv") {
    return parseLegacy(input.fileName, input.bytes, "csv");
  }

  const pkg = readXlsxPackage(input.bytes, WORKBOOK_LIMITS.ooxml);
  if (detectXlsxProfile(pkg) === "legacy_flat") {
    return parseLegacy(input.fileName, input.bytes, "xlsx");
  }
  return parseExtended(input.fileName, input.bytes, pkg, options);
}
