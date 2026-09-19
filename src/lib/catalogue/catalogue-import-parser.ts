import { createHash } from "node:crypto";

import { readFirstWorksheetMatrix } from "@/lib/catalogue/catalogue-import-xlsx";

export class CatalogueImportParseError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "CatalogueImportParseError";
    this.field = field;
  }
}

export const IMPORT_LIMITS = {
  maxFileBytes: 2 * 1024 * 1024,
  maxRows: 500,
  maxCellLength: 2000,
  maxColumns: 32,
} as const;

export type ParsedSpreadsheet = {
  fileName: string;
  fileFingerprint: string;
  headers: string[];
  rows: Array<Record<string, string>>;
  warnings: string[];
};

const FORMULA_PREFIX_PATTERN = /^[=+\-@]/;

export function sanitizeSpreadsheetCell(value: string) {
  const trimmed = value.trim();
  if (FORMULA_PREFIX_PATTERN.test(trimmed)) {
    return `'${trimmed}`;
  }

  return trimmed;
}

function parseCsv(content: string) {
  const rows: string[][] = [];
  let current = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    const next = content[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && char === ",") {
      row.push(sanitizeSpreadsheetCell(current));
      current = "";
      continue;
    }

    if (!inQuotes && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(sanitizeSpreadsheetCell(current));
      if (row.some((cell) => cell.length > 0)) {
        rows.push(row);
      }
      row = [];
      current = "";
      continue;
    }

    current += char;
  }

  row.push(sanitizeSpreadsheetCell(current));
  if (row.some((cell) => cell.length > 0)) {
    rows.push(row);
  }

  return rows;
}

function assertCellLimits(rows: string[][]) {
  for (const [rowIndex, cells] of rows.entries()) {
    if (cells.length > IMPORT_LIMITS.maxColumns) {
      throw new CatalogueImportParseError(
        `Row ${rowIndex + 1} exceeds the ${IMPORT_LIMITS.maxColumns}-column limit.`,
        "columns",
      );
    }

    for (const [columnIndex, cell] of cells.entries()) {
      if (cell.length > IMPORT_LIMITS.maxCellLength) {
        throw new CatalogueImportParseError(
          `Cell at row ${rowIndex + 1}, column ${columnIndex + 1} exceeds the ${IMPORT_LIMITS.maxCellLength}-character limit.`,
          "cellLength",
        );
      }
    }
  }
}

function rowsToRecords(headers: string[], bodyRows: string[][]) {
  return bodyRows.map((cells) =>
    Object.fromEntries(
      headers.map((header, index) => [header, cells[index] ?? ""]),
    ),
  );
}

export async function parseSpreadsheetUpload(input: {
  fileName: string;
  bytes: Buffer;
}): Promise<ParsedSpreadsheet> {
  if (input.bytes.byteLength > IMPORT_LIMITS.maxFileBytes) {
    throw new CatalogueImportParseError(
      `Import file exceeds the ${IMPORT_LIMITS.maxFileBytes}-byte limit.`,
      "fileSize",
    );
  }

  const lowerName = input.fileName.toLowerCase();
  const warnings: string[] = [];
  let matrix: string[][];

  if (lowerName.endsWith(".csv")) {
    const content = input.bytes.toString("utf8");
    matrix = parseCsv(content);
  } else if (lowerName.endsWith(".xlsx")) {
    const workbook = await readFirstWorksheetMatrix(input.bytes);

    if (workbook.sheetCount === 0) {
      throw new CatalogueImportParseError("Workbook contains no sheets.", "file");
    }

    if (workbook.sheetCount > 1) {
      warnings.push("Only the first worksheet was imported.");
    }

    matrix = workbook.rows.map((row) =>
      row.map((cell) => sanitizeSpreadsheetCell(cell)),
    );
  } else {
    throw new CatalogueImportParseError(
      "Import file must be .csv or .xlsx.",
      "fileName",
    );
  }

  if (matrix.length === 0) {
    throw new CatalogueImportParseError("Import file is empty.", "file");
  }

  assertCellLimits(matrix);

  const headers = matrix[0]!.map((header, index) => header || `column_${index + 1}`);
  const bodyRows = matrix.slice(1);

  if (bodyRows.length > IMPORT_LIMITS.maxRows) {
    throw new CatalogueImportParseError(
      `Import file exceeds the ${IMPORT_LIMITS.maxRows}-row limit.`,
      "rows",
    );
  }

  const duplicateHeaders = headers.filter(
    (header, index) => headers.indexOf(header) !== index,
  );
  if (duplicateHeaders.length > 0) {
    throw new CatalogueImportParseError(
      "Import file contains duplicate column headers.",
      "headers",
    );
  }

  return {
    fileName: input.fileName,
    fileFingerprint: createHash("sha256").update(input.bytes).digest("hex"),
    headers,
    rows: rowsToRecords(headers, bodyRows),
    warnings,
  };
}

export function suggestColumnMapping(headers: string[]) {
  const normalized = Object.fromEntries(
    headers.map((header) => [
      header.trim().toLowerCase().replace(/[\s-]+/g, "_"),
      header,
    ]),
  );

  const pick = (...candidates: string[]) => {
    for (const candidate of candidates) {
      const match = normalized[candidate];
      if (match) {
        return match;
      }
    }

    return "";
  };

  return {
    sourceId: pick("source_id", "sourceid", "external_id", "id"),
    internalName: pick("internal_name", "internalname", "product_code", "sku_code"),
    displayNameEn: pick("display_name_en", "name_en", "product_name_en", "title_en"),
    displayNameAr: pick("display_name_ar", "name_ar", "product_name_ar", "title_ar"),
    descriptionEn: pick("description_en", "desc_en"),
    descriptionAr: pick("description_ar", "desc_ar"),
    variantLabelEn: pick("variant_label_en", "variant_en"),
    variantLabelAr: pick("variant_label_ar", "variant_ar"),
    amountMinor: pick("amount_minor", "price_minor", "price_aed_minor", "price"),
    currency: pick("currency", "price_currency"),
    sku: pick("sku", "product_sku"),
    barcode: pick("barcode", "ean"),
    imageUrl: pick("image_url", "imageurl", "image"),
  };
}
