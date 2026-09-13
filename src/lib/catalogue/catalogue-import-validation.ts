import type { CatalogueImportColumnMapping } from "@/db/schema";
import { CatalogueValidationError } from "@/lib/catalogue/validation";

export type NormalizedImportRow = {
  sourceRow: number;
  sourceId: string;
  internalName: string;
  displayNameEn: string;
  displayNameAr: string;
  descriptionEn: string | null;
  descriptionAr: string | null;
  variantLabelEn: string;
  variantLabelAr: string;
  amountMinor: number;
  currency: string;
  sku: string | null;
  barcode: string | null;
};

const CONNECTION_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/;

export function validateConnectionKey(connectionKey: string) {
  const trimmed = connectionKey.trim().toLowerCase();
  if (!CONNECTION_KEY_PATTERN.test(trimmed)) {
    throw new CatalogueValidationError(
      "connectionKey must be 2-64 lowercase letters, numbers, dots, dashes or underscores.",
      "connectionKey",
    );
  }

  return trimmed;
}

export function validateColumnMapping(
  mapping: CatalogueImportColumnMapping,
  headers: string[],
) {
  const headerSet = new Set(headers);
  const requiredFields: Array<keyof CatalogueImportColumnMapping> = [
    "sourceId",
    "internalName",
    "displayNameEn",
    "displayNameAr",
    "amountMinor",
    "currency",
  ];

  for (const field of requiredFields) {
    const header = mapping[field]?.trim();
    if (!header) {
      throw new CatalogueValidationError(
        `Column mapping for ${field} is required.`,
        field,
      );
    }

    if (!headerSet.has(header)) {
      throw new CatalogueValidationError(
        `Mapped column "${header}" was not found in the import file.`,
        field,
      );
    }
  }

  for (const [field, header] of Object.entries(mapping)) {
    if (!header?.trim()) {
      continue;
    }

    if (!headerSet.has(header.trim())) {
      throw new CatalogueValidationError(
        `Mapped column "${header}" was not found in the import file.`,
        field,
      );
    }
  }

  return mapping;
}

function readMappedValue(
  row: Record<string, string>,
  mapping: CatalogueImportColumnMapping,
  field: keyof CatalogueImportColumnMapping,
) {
  const header = mapping[field];
  if (!header) {
    return "";
  }

  return row[header]?.trim() ?? "";
}

export function normalizeImportRow(
  row: Record<string, string>,
  mapping: CatalogueImportColumnMapping,
  sourceRow: number,
): NormalizedImportRow {
  const sourceId = readMappedValue(row, mapping, "sourceId");
  if (!sourceId) {
    throw new CatalogueValidationError("sourceId is required.", "sourceId");
  }

  const internalName = readMappedValue(row, mapping, "internalName");
  if (!internalName) {
    throw new CatalogueValidationError(
      "internalName is required.",
      "internalName",
    );
  }

  const displayNameEn = readMappedValue(row, mapping, "displayNameEn");
  const displayNameAr = readMappedValue(row, mapping, "displayNameAr");
  if (!displayNameEn) {
    throw new CatalogueValidationError(
      "displayNameEn is required.",
      "displayNameEn",
    );
  }
  if (!displayNameAr) {
    throw new CatalogueValidationError(
      "displayNameAr is required.",
      "displayNameAr",
    );
  }

  const amountRaw = readMappedValue(row, mapping, "amountMinor");
  const amountMinor = Number.parseInt(amountRaw, 10);
  if (!Number.isInteger(amountMinor) || amountMinor < 0) {
    throw new CatalogueValidationError(
      "amountMinor must be a whole number of minor currency units.",
      "amountMinor",
    );
  }

  const currency = readMappedValue(row, mapping, "currency").toUpperCase() || "AED";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new CatalogueValidationError(
      "currency must be a 3-letter ISO code.",
      "currency",
    );
  }

  return {
    sourceRow,
    sourceId,
    internalName,
    displayNameEn,
    displayNameAr,
    descriptionEn: readMappedValue(row, mapping, "descriptionEn") || null,
    descriptionAr: readMappedValue(row, mapping, "descriptionAr") || null,
    variantLabelEn: readMappedValue(row, mapping, "variantLabelEn"),
    variantLabelAr: readMappedValue(row, mapping, "variantLabelAr"),
    amountMinor,
    currency,
    sku: readMappedValue(row, mapping, "sku") || null,
    barcode: readMappedValue(row, mapping, "barcode") || null,
  };
}
