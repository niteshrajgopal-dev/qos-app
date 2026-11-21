import type { XlsxPackage } from "@/lib/workbook/ooxml";
import { WorkbookParseError } from "@/lib/workbook/errors";
import { detectFoodicsMenuLayout, type FoodicsMenuLayout } from "@/lib/workbook/foodics-menu/layout";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import { looksLikeZip } from "@/lib/workbook/zip";
import {
  CURRENT_IMPORT_SHEET,
  tableNameForSheet,
  WORKBOOK_CONTRACT,
  WORKBOOK_LAYOUT,
} from "@/lib/workbook/contract";

/* Three upload profiles. `legacy_flat` is today's seven-column catalogue
   profile (CSV, or the first worksheet of an XLSX) and keeps IMPORT_LIMITS
   unchanged. `qos_extended_v1` is the proposed named-table workbook and is
   recognised only by its QOS_Workbook_Context manifest table, never by the
   file name. `foodics_menu_v1` (QOS-216) is the client's Foodics-style menu
   workbook, recognised by its structural signature before the legacy
   fallback, so it can never be read as a seven-column file. */

export type WorkbookProfile = "legacy_flat" | "qos_extended_v1" | "foodics_menu_v1";

export type XlsxProfileDetection =
  | { profile: "qos_extended_v1" }
  | { profile: "foodics_menu_v1"; layout: FoodicsMenuLayout }
  | { profile: "legacy_flat" };

export type UploadContainer = "csv" | "xlsx";

const OLE_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function extensionOf(fileName: string) {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1]!.toLowerCase() : "";
}

function looksLikeText(bytes: Buffer) {
  const sample = bytes.subarray(0, Math.min(bytes.length, 64 * 1024));
  if (sample.includes(0)) {
    return false;
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample.subarray(0, lastCompleteUtf8Boundary(sample)));
    return true;
  } catch {
    return false;
  }
}

function lastCompleteUtf8Boundary(sample: Buffer) {
  // Do not reject a valid file because the sample cut a multi-byte character.
  const end = sample.length;
  for (let back = 1; back <= 3 && end - back >= 0; back += 1) {
    const byte = sample[end - back]!;
    if ((byte & 0xc0) === 0xc0) {
      return end - back;
    }
    if ((byte & 0x80) === 0) {
      break;
    }
  }
  return end;
}

/**
 * Decides the container from the bytes. The file name is only used to catch
 * a mismatch (an XLSX renamed to .csv, a PDF renamed to .xlsx); it never
 * selects the profile.
 */
export function detectUploadContainer(fileName: string, bytes: Buffer): UploadContainer {
  if (bytes.length === 0) {
    throw new WorkbookParseError("empty_file", "The file is empty.");
  }
  if (bytes.length > WORKBOOK_LIMITS.maxFileBytes) {
    throw new WorkbookParseError(
      "file_too_large",
      `The file exceeds the ${WORKBOOK_LIMITS.maxFileBytes}-byte limit.`,
      { maxBytes: WORKBOOK_LIMITS.maxFileBytes },
    );
  }

  const extension = extensionOf(fileName);
  if (extension !== "csv" && extension !== "xlsx") {
    throw new WorkbookParseError("wrong_type", "Upload a .xlsx workbook or a .csv file.");
  }

  if (looksLikeZip(bytes)) {
    if (extension !== "xlsx") {
      throw new WorkbookParseError("extension_mismatch", "The file content is a workbook but its name ends in .csv.");
    }
    return "xlsx";
  }

  if (bytes.subarray(0, OLE_SIGNATURE.length).equals(OLE_SIGNATURE)) {
    throw new WorkbookParseError("wrong_type", "Older .xls workbooks are not accepted. Save as .xlsx.");
  }

  if (extension === "xlsx" || !looksLikeText(bytes)) {
    throw new WorkbookParseError("wrong_type", "The file is not a readable .xlsx workbook or UTF-8 .csv file.");
  }
  return "csv";
}

const CONTRACT_ENTITY_TABLES = new Set(
  WORKBOOK_CONTRACT.sheets
    .filter((sheet) => sheet.name !== CURRENT_IMPORT_SHEET)
    .map((sheet) => tableNameForSheet(sheet.name)),
);

/**
 * Profile of an XLSX package: the manifest table marks the expanded profile.
 * Entity tables without a manifest are refused rather than guessed, because
 * the context (tenant, brand, namespace, version) would be missing. Then the
 * Foodics menu layout is checked: a full match is that profile, a partial or
 * duplicated layout throws a coded error. Anything else is the legacy flat
 * profile. The layout found here is handed to the reader, not recomputed.
 */
export function detectXlsxProfile(pkg: XlsxPackage): XlsxProfileDetection {
  const tableNames = pkg.sheets.flatMap((sheet) => sheet.tables.map((table) => table.name));
  if (tableNames.includes(WORKBOOK_LAYOUT.manifestTable)) {
    return { profile: "qos_extended_v1" };
  }
  if (tableNames.some((name) => CONTRACT_ENTITY_TABLES.has(name))) {
    throw new WorkbookParseError(
      "manifest_missing",
      `The workbook has QOS tables but no ${WORKBOOK_LAYOUT.manifestTable} table. Start from a QOS template or export.`,
    );
  }
  const layout = detectFoodicsMenuLayout(pkg);
  if (layout) {
    return { profile: "foodics_menu_v1", layout };
  }
  return { profile: "legacy_flat" };
}
