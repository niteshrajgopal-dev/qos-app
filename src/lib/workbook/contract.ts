import contractJson from "@/lib/workbook/qos-workbook-contract.v1.json";

/* The QOS workbook data contract. v1.0 (16 November 2026) was committed
   verbatim from the Phase 2 pack (SHA-256 d36471c7…8520c). v1.1 (21 November
   2026, QOS-212) adds four Product Modifiers assignment policy columns,
   marked `since: "1.1"`; v1.2 (QOS-213) adds the three sales-channel sheets,
   each marked `sinceVersion: "1.2"`; v1.3 (QOS-214) adds eight selling-attribute
   and nutrition columns on Products, Variants and Modifier Options, marked
   `sinceVersion: "1.3"`; v1.4 (QOS-215) persists the Variants tax columns and
   adds reference-cost columns to Variants and Modifier Options, marked
   `sinceVersion: "1.4"`. It is the source of truth for sheet
   names, table names, header and data rows, columns and the manifest.
   Nothing here is inferred from a file name. */

export type WorkbookColumnDefinition = {
  key: string;
  label: string;
  type: string;
  required: boolean;
  description: string;
  mapping: string;
  phase: string;
  importSupport: string;
  isKey?: boolean;
  readonly?: boolean;
  values?: string[];
  ref?: { sheet: string; key: string };
  required_when?: string;
  min?: number;
  max?: number;
  positive?: boolean;
  width?: number;
  /** Contract version that introduced the column; absent means 1.0. */
  since?: string;
  /** Contract version that introduced the column (v1.3 selling-attribute and v1.4 cost columns). */
  sinceVersion?: string;
};

export type WorkbookSheetDefinition = {
  name: string;
  description: string;
  short: string;
  phase: string;
  support: string;
  capacity: number;
  columns: WorkbookColumnDefinition[];
  raw?: boolean;
  /** Contract version that introduced the sheet; older files are not expected to carry it. */
  sinceVersion?: string;
};

export type WorkbookContextField = {
  field: string;
  value: string;
  rule: string;
};

export type WorkbookContract = {
  version: string;
  asOf: string;
  repositorySnapshot: string;
  layout: {
    extendedHeaderRow: number;
    extendedFirstDataRow: number;
    currentProfileHeaderRow: number;
    currentProfileFirstDataRow: number;
    tablePrefix: string;
    computedColumns: string[];
    manifestTable: string;
  };
  context: WorkbookContextField[];
  sheets: WorkbookSheetDefinition[];
  rules: Array<[string, string]>;
  sources: Array<{ label: string; url: string }>;
  profileCoverage: Record<string, unknown>;
};

export const WORKBOOK_CONTRACT = contractJson as unknown as WorkbookContract;

export const WORKBOOK_PROFILE_ID = "qos-extended-v1-proposed";
export const WORKBOOK_TEMPLATE_VERSION = WORKBOOK_CONTRACT.version;

/** Template versions QOS reads. Older files lack the columns and sheets added since. */
export const SUPPORTED_TEMPLATE_VERSIONS = ["1.0", "1.1", "1.2", "1.3", "1.4"] as const;

function versionParts(version: string) {
  return version.split(".").map((part) => Number.parseInt(part, 10) || 0);
}

function compareVersions(a: string, b: string) {
  const [aMajor = 0, aMinor = 0] = versionParts(a);
  const [bMajor = 0, bMinor = 0] = versionParts(b);
  return aMajor - bMajor || aMinor - bMinor;
}

/** Whether a workbook of `templateVersion` is expected to carry this column. */
export function columnExpectedInVersion(column: WorkbookColumnDefinition, templateVersion: string) {
  return compareVersions(column.since ?? column.sinceVersion ?? "1.0", templateVersion) <= 0;
}

/** Whether a workbook of `templateVersion` is expected to carry this sheet. */
export function sheetExpectedInVersion(sheet: WorkbookSheetDefinition, templateVersion: string) {
  return compareVersions(sheet.sinceVersion ?? "1.0", templateVersion) <= 0;
}
export const WORKBOOK_LAYOUT = WORKBOOK_CONTRACT.layout;

export const ROW_CHECK_COLUMN = "row_check";

/* The workbook wraps the contract sheets (28 in the 1.0 pack, 31 from 1.2)
   in three guidance sheets. They carry instructions only and are never read as business rows. */
export const START_HERE_SHEET = "Start Here";
export const FIELD_GUIDE_SHEET = "Field Guide";
export const IMPORT_RULES_SHEET = "Import Rules";
export const GUIDANCE_SHEETS = [START_HERE_SHEET, FIELD_GUIDE_SHEET, IMPORT_RULES_SHEET] as const;
export const FIELD_GUIDE_TABLE = "QOS_Field_Guide";
export const CURRENT_IMPORT_SHEET = "Current Import";

export const WORKBOOK_SHEET_ORDER = [
  START_HERE_SHEET,
  ...WORKBOOK_CONTRACT.sheets.map((sheet) => sheet.name),
  FIELD_GUIDE_SHEET,
  IMPORT_RULES_SHEET,
];

/**
 * How QOS treats a contract sheet today. `supported` sheets map to existing
 * catalogue records and are parsed for review (validation is QOS-194, apply
 * is QOS-200). `deferred` sheets need Phase 2 services that do not exist yet.
 * `rejected` sheets are Phase 3 proposals. `separate_profile` is the flat
 * Current Import tab, which is uploaded on its own as the current profile.
 */
export type WorkbookSheetSupport = "supported" | "deferred" | "rejected" | "separate_profile";

const DEFERRED_SHEETS = new Set([
  "Units",
  "Suppliers",
  "Warehouses",
  "Inventory Categories",
  "Ingredients",
  "Recipes",
  "Recipe Lines",
  "Prep Steps",
  "Modifier Effects",
  "Prep Targets",
  "Opening Stock",
  "External Mappings",
]);

const REJECTED_SHEETS = new Set(["Future Combos", "Combo Components"]);

export const SUPPORTED_ENTITY_SHEETS = [
  "Branches",
  "Categories",
  "Products",
  "Product Categories",
  "Variants",
  "Branch Prices",
  "Sales Channels",
  "Variant Channel Prices",
  "Modifier Groups",
  "Modifier Options",
  "Modifier Option Channel Prices",
  "Product Modifiers",
  "Menus",
  "Menu Branches",
  "Menu Sections",
  "Menu Items",
] as const;

export type SupportedEntitySheet = (typeof SUPPORTED_ENTITY_SHEETS)[number];

export function sheetSupport(sheetName: string): WorkbookSheetSupport {
  if (sheetName === CURRENT_IMPORT_SHEET) {
    return "separate_profile";
  }
  if (REJECTED_SHEETS.has(sheetName)) {
    return "rejected";
  }
  if (DEFERRED_SHEETS.has(sheetName)) {
    return "deferred";
  }
  return "supported";
}

export function tableNameForSheet(sheetName: string) {
  return `${WORKBOOK_LAYOUT.tablePrefix}${sheetName.replace(/ /g, "_")}`;
}

export function contractSheet(sheetName: string): WorkbookSheetDefinition {
  const sheet = WORKBOOK_CONTRACT.sheets.find((candidate) => candidate.name === sheetName);
  if (!sheet) {
    throw new Error(`Sheet ${sheetName} is not in the workbook contract.`);
  }
  return sheet;
}

export function sheetHeaderRow(sheet: WorkbookSheetDefinition) {
  return sheet.raw ? WORKBOOK_LAYOUT.currentProfileHeaderRow : WORKBOOK_LAYOUT.extendedHeaderRow;
}

/** Columns a table carries: the contract columns, then `row_check` on entity sheets. */
export function tableColumnKeys(sheet: WorkbookSheetDefinition) {
  const keys = sheet.columns.map((column) => column.key);
  return sheet.raw ? keys : [...keys, ...WORKBOOK_LAYOUT.computedColumns];
}

const WORKBOOK_MECHANICS_COLUMNS = new Set(["action", "expected_revision", "clear_fields"]);

/**
 * A column on a supported sheet whose value QOS has nowhere to store yet
 * (for example `price_tax_basis` or `free_options_count`). Populated cells are
 * reported as deferred, never as imported.
 */
export function isDeferredField(column: WorkbookColumnDefinition) {
  return (
    column.mapping.startsWith("Proposed") &&
    !column.isKey &&
    !WORKBOOK_MECHANICS_COLUMNS.has(column.key)
  );
}

/** Identifier-like columns whose text must survive exactly (leading zeros, long digits). */
export function isIdentifierColumn(column: WorkbookColumnDefinition) {
  return (
    Boolean(column.isKey) ||
    column.type === "reference" ||
    column.key.startsWith("qos_") ||
    column.key === "sku" ||
    column.key === "barcode" ||
    column.key === "expected_revision" ||
    column.key === "external_id" ||
    column.key === "external_parent_id"
  );
}
