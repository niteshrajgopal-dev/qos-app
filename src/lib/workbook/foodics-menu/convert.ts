import type ExcelJS from "exceljs";

import { WORKBOOK_CONTRACT, WORKBOOK_PROFILE_ID } from "@/lib/workbook/contract";
import {
  capabilityFor,
  SOURCE_MAP_SHEET,
  SOURCE_MAP_TABLE,
  WORKBOOK_DICTIONARY,
} from "@/lib/workbook/dictionary";
import { WorkbookParseError } from "@/lib/workbook/errors";
import { FOODICS_MENU_PROFILE } from "@/lib/workbook/foodics-menu/layout";
import type { FoodicsMenuParseResult } from "@/lib/workbook/foodics-menu/reader";
import { FOODICS_MENU_LIMITS, WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import type { WorkbookManifest } from "@/lib/workbook/manifest";
import type { WorkbookIssue, WorkbookParseResult } from "@/lib/workbook/reader";
import { buildQosWorkbook, type WorkbookRecords } from "@/lib/workbook/template";

/* Converts a parsed Foodics menu workbook into the canonical QOS workbook
   (QOS-216, decision D-CONVERT). It is the parse result written out by the
   existing template builder: no second importer, nothing stored. The
   workbook is not an export (no revision, no export time), carries the
   source profile in dictionary 1.1 context fields, and appends a Source Map
   sheet with the provenance of every row, the preserved source values and the
   conversion notes. QOS never reads the Source Map as business rows. */

export const SOURCE_MAP_COLUMNS = [
  "target_sheet",
  "target_key",
  "kind",
  "source_sheet",
  "source_ref",
  "field",
  "value_text",
  "capability",
] as const;

type SourceMapRow = Record<(typeof SOURCE_MAP_COLUMNS)[number], string>;

/** Workbook-level conditions that make converted money meaningless. */
const CURRENCY_BLOCKERS = new Set<WorkbookIssue["code"]>(["currency_required", "currency_minor_digits_unknown"]);

/** Refuses anything but a Foodics menu result, so a QOS or flat file is never "converted". */
export function assertConvertible(result: WorkbookParseResult): asserts result is FoodicsMenuParseResult {
  if (result.profile !== "foodics_menu_v1") {
    throw new WorkbookParseError(
      "convert_unsupported_profile",
      result.profile === "qos_extended_v1"
        ? "This file is already a QOS workbook."
        : "This file uses the current catalogue profile; upload it as a current catalogue file.",
      { profile: result.profile },
    );
  }
  if (result.issues.some((issue) => CURRENCY_BLOCKERS.has(issue.code))) {
    throw new WorkbookParseError(
      "convert_currency_unresolved",
      "Prices cannot be converted without a known business currency.",
    );
  }
}

function issueLocation(issue: WorkbookIssue) {
  const cell = issue.params?.cell;
  if (issue.sheet && cell) return `${issue.sheet}!${cell}`;
  if (issue.sheet && issue.row) return `${issue.sheet}!${issue.row}:${issue.row}`;
  return issue.sheet ?? "";
}

export function sourceMapRows(result: FoodicsMenuParseResult): SourceMapRow[] {
  const rows: SourceMapRow[] = [];
  for (const sheet of result.sheets) {
    const keyColumn = WORKBOOK_CONTRACT.sheets.find((entry) => entry.name === sheet.sheet)!.columns[0]!.key;
    for (const row of sheet.rows) {
      if (!row.source) continue;
      const targetKey = row.values[keyColumn] ?? "";
      rows.push({
        target_sheet: sheet.sheet,
        target_key: targetKey,
        kind: "row",
        source_sheet: row.source.sheet,
        source_ref: row.source.range,
        field: "",
        value_text: "",
        capability: sheet.support === "supported" ? "recognized" : "deferred",
      });
      for (const [field, preserved] of Object.entries(row.source.preserved ?? {})) {
        rows.push({
          target_sheet: sheet.sheet,
          target_key: targetKey,
          kind: "value",
          source_sheet: row.source.sheet,
          source_ref: preserved.cell,
          field,
          value_text: preserved.value,
          capability: capabilityFor(SOURCE_MAP_SHEET, field)?.class ?? "deferred",
        });
      }
    }
  }
  for (const issue of [...result.issues, ...result.sheets.flatMap((sheet) => sheet.issues)]) {
    rows.push({
      target_sheet: "",
      target_key: "",
      kind: "issue",
      source_sheet: issue.sheet ?? "",
      source_ref: issueLocation(issue),
      field: `${issue.severity}:${issue.code}`,
      value_text: JSON.stringify({ ...(issue.column ? { column: issue.column } : {}), ...(issue.params ?? {}) }),
      capability: "",
    });
  }
  return rows;
}

function buildSourceMapSheet(workbook: ExcelJS.Workbook, rows: SourceMapRow[]) {
  const worksheet = workbook.addWorksheet(SOURCE_MAP_SHEET, {
    views: [{ state: "frozen", ySplit: 6, showGridLines: false }],
  });
  worksheet.columns = [{ width: 22 }, { width: 44 }, { width: 10 }, { width: 22 }, { width: 24 }, { width: 30 }, { width: 40 }, { width: 14 }];
  worksheet.getCell("A2").value = SOURCE_MAP_SHEET;
  worksheet.getCell("A2").font = { bold: true, size: 16 };
  worksheet.getCell("A3").value =
    "Where each row and value came from in the source workbook, and the notes from conversion. QOS never reads this sheet as business rows.";
  for (let row = 7; row < 7 + rows.length; row += 1) {
    for (let column = 1; column <= SOURCE_MAP_COLUMNS.length; column += 1) {
      worksheet.getCell(row, column).numFmt = "@";
    }
  }
  worksheet.addTable({
    name: SOURCE_MAP_TABLE,
    displayName: SOURCE_MAP_TABLE,
    ref: "A6",
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleLight1", showRowStripes: true },
    columns: SOURCE_MAP_COLUMNS.map((name) => ({ name, filterButton: true })),
    rows: rows.length > 0 ? rows.map((row) => SOURCE_MAP_COLUMNS.map((column) => row[column] || null)) : [SOURCE_MAP_COLUMNS.map(() => null)],
  });
  worksheet.getRow(6).font = { bold: true };
}

export function convertedFileName(result: FoodicsMenuParseResult) {
  const tenant = result.context.tenantPublicId.replace(/[^A-Za-z0-9_-]/g, "") || "tenant";
  return `qos-converted-foodics-menu-v1-${tenant}-${result.fileFingerprint.slice(0, 8)}.xlsx`;
}

/**
 * Writes the canonical QOS workbook for a Foodics menu parse result. Brand
 * and currency must be resolved; rows past the canonical read-back ceiling
 * are refused rather than cut off.
 */
export async function buildConvertedWorkbook(result: FoodicsMenuParseResult, context: { businessTimezone: string }) {
  for (const sheet of result.sheets) {
    if (sheet.rowCount > WORKBOOK_LIMITS.maxRowsPerTable) {
      throw new WorkbookParseError("convert_too_large", `${sheet.sheet} would have more than ${WORKBOOK_LIMITS.maxRowsPerTable} rows.`, {
        sheet: sheet.sheet,
        max: WORKBOOK_LIMITS.maxRowsPerTable,
      });
    }
  }
  const mapRows = sourceMapRows(result);
  if (mapRows.length > FOODICS_MENU_LIMITS.maxSourceMapRows) {
    throw new WorkbookParseError("convert_too_large", `${SOURCE_MAP_SHEET} would have more than ${FOODICS_MENU_LIMITS.maxSourceMapRows} rows.`, {
      sheet: SOURCE_MAP_SHEET,
      max: FOODICS_MENU_LIMITS.maxSourceMapRows,
    });
  }

  const defaults = Object.fromEntries(WORKBOOK_CONTRACT.context.map((entry) => [entry.field, entry.value]));
  const manifest: WorkbookManifest = {
    profile: WORKBOOK_PROFILE_ID,
    template_version: WORKBOOK_CONTRACT.version,
    prepared_on: defaults.prepared_on ?? "",
    tenant_public_id: result.context.tenantPublicId,
    brand_public_id: result.context.brandPublicId ?? "",
    source_namespace: result.context.sourceNamespace,
    export_revision: "",
    exported_at: "",
    pilot_currency: result.context.currency ?? "",
    business_timezone: context.businessTimezone,
  };
  const extraValues: Record<string, string> = {
    source_profile: FOODICS_MENU_PROFILE.id,
    source_profile_version: String(FOODICS_MENU_PROFILE.version),
    dictionary_version: FOODICS_MENU_PROFILE.dictionaryVersion,
    source_file_sha256: result.fileFingerprint,
  };
  const records: WorkbookRecords = Object.fromEntries(
    result.sheets.filter((sheet) => sheet.rowCount > 0).map((sheet) => [sheet.sheet, sheet.rows.map((row) => row.values)]),
  );

  return buildQosWorkbook({
    manifest,
    records,
    extraContext: WORKBOOK_DICTIONARY.extraContextFields.map((entry) => ({
      field: entry.field,
      value: extraValues[entry.field] ?? "",
      rule: entry.rule,
    })),
    extraSheets: (workbook) => buildSourceMapSheet(workbook, mapRows),
  });
}
