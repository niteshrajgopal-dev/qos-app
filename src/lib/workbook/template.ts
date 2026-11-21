import ExcelJS from "exceljs";

import {
  FIELD_GUIDE_SHEET,
  FIELD_GUIDE_TABLE,
  IMPORT_RULES_SHEET,
  sheetHeaderRow,
  sheetSupport,
  START_HERE_SHEET,
  tableColumnKeys,
  tableNameForSheet,
  WORKBOOK_CONTRACT,
  WORKBOOK_LAYOUT,
  type WorkbookColumnDefinition,
  type WorkbookSheetDefinition,
  type WorkbookSheetSupport,
} from "@/lib/workbook/contract";
import type { WorkbookManifest } from "@/lib/workbook/manifest";

/* Builds the 31-sheet QOS workbook from the contract with exceljs: Start
   Here (with the QOS_Workbook_Context manifest), the 28 contract sheets with
   their QOS_* tables at the documented header row, then Field Guide and
   Import Rules. The same builder writes the blank template (no records, no
   tenant context) and the current-record export. It writes no formulas:
   the pack's row_check and count formulas are spreadsheet helpers, and QOS
   never relies on them, so row_check is left for QOS review to fill. */

export const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type WorkbookRecords = Partial<Record<string, Array<Record<string, string>>>>;

const TEXT_TYPES = new Set(["text", "reference", "description", "url", "date"]);

const STATUS_TEXT: Record<WorkbookSheetSupport, string> = {
  supported: "Read by QOS for review. Validation and apply are separate steps.",
  deferred: "Collected only. QOS cannot import this sheet yet.",
  rejected: "Phase 3 proposal. QOS rejects these rows in Phase 2.",
  separate_profile: "Current flat profile. Save this tab alone as CSV to upload it.",
};

const START_HERE_NOTES: Array<[string, string]> = [
  ["Purpose", "Collect menu, modifier and branch master data for QOS, using the current QOS model and clearly marked planned extensions."],
  ["Current profile", "Today's catalogue upload uses the seven Current Import columns. Save that tab alone as CSV, or use the separate CSV sample."],
  ["Expanded workbook", "QOS recognises this workbook by its QOS_Workbook_Context table. Uploading it shows what QOS read; nothing is applied from it yet."],
  ["Start with real data", "Input tables are blank. Download a current-record export from QOS to keep IDs and revision tokens; never invent them."],
  ["Workbook context", "Leave the context values as QOS wrote them. Tenant, brand, namespace, revision and export time are filled only by a QOS export."],
  ["Keys and IDs", "*_key columns link rows inside the workbook. qos_*_id columns identify existing QOS records. Keep identifiers, SKUs and barcodes as text."],
  ["Formulas", "QOS never evaluates formulas or trusts their results. Type values directly; a formula in an input column is reported, not read."],
  ["Data safeguards", "Blank is different from zero. A missing row never deletes anything. Publication, translation approval and stock posting stay separate actions."],
];

function sheetIntro(sheet: WorkbookSheetDefinition) {
  return `${sheet.phase}. ${sheet.support}.`;
}

function requiredLabel(column: WorkbookColumnDefinition) {
  if (column.required) return "Create";
  if (column.readonly) return "Export only";
  return "Optional";
}

function allowedValues(column: WorkbookColumnDefinition) {
  if (column.values?.length) return column.values.join(", ");
  if (column.ref) return `${column.ref.sheet}.${column.ref.key}`;
  return "";
}

function setTitle(worksheet: ExcelJS.Worksheet, title: string, lines: string[]) {
  worksheet.getCell("A2").value = title;
  worksheet.getCell("A2").font = { bold: true, size: 16 };
  lines.forEach((line, index) => {
    worksheet.getCell(`A${3 + index}`).value = line;
  });
}

function addTable(
  worksheet: ExcelJS.Worksheet,
  name: string,
  ref: string,
  columns: string[],
  rows: Array<Array<string | null>>,
) {
  worksheet.addTable({
    name,
    displayName: name,
    ref,
    headerRow: true,
    totalsRow: false,
    style: { theme: "TableStyleLight1", showRowStripes: true },
    columns: columns.map((column) => ({ name: column, filterButton: true })),
    rows,
  });
}

function buildStartHere(workbook: ExcelJS.Workbook, manifest: WorkbookManifest) {
  const worksheet = workbook.addWorksheet(START_HERE_SHEET, {
    views: [{ state: "frozen", ySplit: 17, showGridLines: false }],
  });
  worksheet.columns = [{ width: 26 }, { width: 14 }, { width: 70 }, { width: 46 }];
  setTitle(worksheet, "QOS Menu and Operations Template", [
    `Version ${WORKBOOK_CONTRACT.version}. Contract dated ${WORKBOOK_CONTRACT.asOf}.`,
  ]);

  START_HERE_NOTES.forEach(([label, text], index) => {
    const row = 5 + index;
    worksheet.getCell(`A${row}`).value = label;
    worksheet.getCell(`A${row}`).font = { bold: true };
    worksheet.getCell(`C${row}`).value = text;
    worksheet.getCell(`C${row}`).alignment = { wrapText: true, vertical: "top" };
  });

  const indexHeader = worksheet.getRow(17);
  indexHeader.values = ["Worksheet", "Phase", "Purpose", "QOS import status"];
  indexHeader.font = { bold: true };
  WORKBOOK_CONTRACT.sheets.forEach((sheet, index) => {
    worksheet.getRow(18 + index).values = [sheet.name, sheet.phase, sheet.short, STATUS_TEXT[sheetSupport(sheet.name)]];
  });

  const contextTitleRow = 18 + WORKBOOK_CONTRACT.sheets.length + 1;
  worksheet.getCell(`A${contextTitleRow}`).value = "Workbook context — QOS export / preview metadata";
  worksheet.getCell(`A${contextTitleRow}`).font = { bold: true };
  const contextHeaderRow = contextTitleRow + 1;
  for (let row = contextHeaderRow + 1; row <= contextHeaderRow + WORKBOOK_CONTRACT.context.length; row += 1) {
    worksheet.getCell(`B${row}`).numFmt = "@";
  }
  addTable(
    worksheet,
    WORKBOOK_LAYOUT.manifestTable,
    `A${contextHeaderRow}`,
    ["field", "value", "rule"],
    WORKBOOK_CONTRACT.context.map((entry) => [
      entry.field,
      manifest[entry.field as keyof WorkbookManifest] || null,
      entry.rule,
    ]),
  );
}

function buildContractSheet(
  workbook: ExcelJS.Workbook,
  sheet: WorkbookSheetDefinition,
  records: Array<Record<string, string>>,
) {
  const headerRow = sheetHeaderRow(sheet);
  const keys = tableColumnKeys(sheet);
  const worksheet = workbook.addWorksheet(sheet.name, {
    views: [
      {
        state: "frozen",
        xSplit: 2,
        ySplit: headerRow,
        showGridLines: false,
      },
    ],
  });

  worksheet.columns = keys.map((key) => {
    const column = sheet.columns.find((candidate) => candidate.key === key);
    return { key, width: column?.width ?? 24 };
  });

  if (!sheet.raw) {
    setTitle(worksheet, sheet.name, [
      sheetIntro(sheet),
      sheet.description,
      "Required columns, export-only IDs and allowed values are listed in the Field Guide. row_check is left for QOS review.",
    ]);
  }

  const dataRows = Math.max(sheet.capacity, records.length);
  const firstDataRow = headerRow + 1;
  const lastDataRow = headerRow + dataRows;

  // Text format keeps identifiers, SKUs, barcodes and keys exactly as typed.
  keys.forEach((key, index) => {
    const column = sheet.columns.find((candidate) => candidate.key === key);
    if (!column) return;
    const columnNumber = index + 1;
    for (let row = firstDataRow; row <= lastDataRow; row += 1) {
      const cell = worksheet.getCell(row, columnNumber);
      if (TEXT_TYPES.has(column.type)) {
        cell.numFmt = "@";
      }
      if (column.values?.length) {
        cell.dataValidation = {
          type: "list",
          allowBlank: true,
          formulae: [`"${column.values.join(",")}"`],
        };
      }
    }
  });

  const rows = Array.from({ length: dataRows }, (_, index) => {
    const record = records[index];
    // Blank cells stay empty rather than holding an empty string.
    return keys.map((key) => record?.[key] || null);
  });
  addTable(worksheet, tableNameForSheet(sheet.name), `A${headerRow}`, keys, rows);
  worksheet.getRow(headerRow).font = { bold: true };
}

function buildFieldGuide(workbook: ExcelJS.Workbook) {
  const worksheet = workbook.addWorksheet(FIELD_GUIDE_SHEET, {
    views: [{ state: "frozen", xSplit: 2, ySplit: 6, showGridLines: false }],
  });
  worksheet.columns = [
    { width: 22 },
    { width: 28 },
    { width: 70 },
    { width: 14 },
    { width: 12 },
    { width: 14 },
    { width: 30 },
    { width: 44 },
    { width: 36 },
  ];
  setTitle(worksheet, FIELD_GUIDE_SHEET, [
    "Existing model fields and proposed workbook fields are distinguished by domain phase and import support.",
  ]);
  addTable(
    worksheet,
    FIELD_GUIDE_TABLE,
    "A6",
    ["Worksheet", "Column", "Meaning", "Type", "Required", "Domain phase", "Current import", "QOS mapping", "Allowed values / reference"],
    WORKBOOK_CONTRACT.sheets.flatMap((sheet) =>
      sheet.columns.map((column) => [
        sheet.name,
        column.key,
        column.description,
        column.type,
        requiredLabel(column),
        column.phase,
        column.importSupport,
        column.mapping,
        allowedValues(column),
      ]),
    ),
  );
}

function buildImportRules(workbook: ExcelJS.Workbook) {
  const worksheet = workbook.addWorksheet(IMPORT_RULES_SHEET, { views: [{ showGridLines: false }] });
  worksheet.columns = [{ width: 32 }, { width: 110 }];
  setTitle(worksheet, IMPORT_RULES_SHEET, ["Read before collecting or importing data."]);
  worksheet.getRow(6).values = ["Rule", "Behavior"];
  worksheet.getRow(6).font = { bold: true };
  WORKBOOK_CONTRACT.rules.forEach(([title, behavior], index) => {
    const row = worksheet.getRow(7 + index);
    row.values = [title, behavior];
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  });
}

/**
 * Writes the workbook. `manifest` carries the context values; `records`
 * fills entity tables by sheet name (an export). Everything is written as
 * text, so leading zeros and long identifiers survive.
 */
export async function buildQosWorkbook(input: {
  manifest: WorkbookManifest;
  records?: WorkbookRecords;
}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "QOS";
  // Fixed metadata dates keep the package free of an invented generation time.
  const fixedDate = new Date(`${WORKBOOK_CONTRACT.asOf}T00:00:00Z`);
  workbook.created = fixedDate;
  workbook.modified = fixedDate;

  buildStartHere(workbook, input.manifest);
  for (const sheet of WORKBOOK_CONTRACT.sheets) {
    buildContractSheet(workbook, sheet, input.records?.[sheet.name] ?? []);
  }
  buildFieldGuide(workbook);
  buildImportRules(workbook);

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Context of the blank template: exactly the contract defaults, nothing tenant-specific. */
export function blankTemplateManifest(): WorkbookManifest {
  return Object.fromEntries(
    WORKBOOK_CONTRACT.context.map((entry) => [entry.field, entry.value]),
  ) as WorkbookManifest;
}

export function buildBlankWorkbookTemplate() {
  return buildQosWorkbook({ manifest: blankTemplateManifest() });
}

export const BLANK_TEMPLATE_FILE_NAME = `qos-menu-and-operations-template-v${WORKBOOK_CONTRACT.version}.xlsx`;
