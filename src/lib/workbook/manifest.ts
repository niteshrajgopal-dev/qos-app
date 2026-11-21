import { WORKBOOK_CONTRACT, WORKBOOK_LAYOUT, WORKBOOK_PROFILE_ID } from "@/lib/workbook/contract";
import { WorkbookParseError } from "@/lib/workbook/errors";
import { cellKey, type XlsxPackage } from "@/lib/workbook/ooxml";
import type { WorkbookIssue, WorkbookParseOptions } from "@/lib/workbook/reader";

/* The QOS_Workbook_Context manifest: field / value / rule rows that carry
   the profile, template version and, on an export, the immutable tenant,
   brand, namespace, revision and generation time. */

export const MANIFEST_FIELDS = WORKBOOK_CONTRACT.context.map((entry) => entry.field);

export type WorkbookManifest = Record<
  | "profile"
  | "template_version"
  | "prepared_on"
  | "tenant_public_id"
  | "brand_public_id"
  | "source_namespace"
  | "export_revision"
  | "exported_at"
  | "pilot_currency"
  | "business_timezone",
  string
>;

/** Template versions this parser understands. `1` covers a cell Excel turned into a number. */
const SUPPORTED_TEMPLATE_VERSIONS = new Set([WORKBOOK_CONTRACT.version, "1"]);

function invalid(message: string): never {
  throw new WorkbookParseError("manifest_invalid", message);
}

export function readWorkbookManifest(
  pkg: XlsxPackage,
  options: WorkbookParseOptions,
): { manifest: WorkbookManifest; issues: WorkbookIssue[] } {
  const tableName = WORKBOOK_LAYOUT.manifestTable;
  let located: { cells: XlsxPackage["sheets"][number]["cells"]; table: XlsxPackage["sheets"][number]["tables"][number] } | null =
    null;
  for (const sheet of pkg.sheets) {
    const table = sheet.tables.find((candidate) => candidate.name === tableName);
    if (table) {
      located = { cells: sheet.cells, table };
      break;
    }
  }
  if (!located) {
    throw new WorkbookParseError("manifest_missing", `The workbook has no ${tableName} table.`);
  }

  const { cells, table } = located;
  const columns = new Map<string, number>();
  for (let column = table.range.startColumn; column <= table.range.endColumn; column += 1) {
    const name =
      table.columnNames[column - table.range.startColumn]?.trim() ||
      cells.get(cellKey(table.range.startRow, column))?.text.trim() ||
      "";
    columns.set(name, column);
  }
  const fieldColumn = columns.get("field");
  const valueColumn = columns.get("value");
  if (fieldColumn === undefined || valueColumn === undefined) {
    invalid(`${tableName} must have field and value columns.`);
  }

  const values = new Map<string, string>();
  const issues: WorkbookIssue[] = [];
  for (let row = table.range.startRow + 1; row <= table.range.endRow - table.totalsRowCount; row += 1) {
    const field = cells.get(cellKey(row, fieldColumn))?.text.trim() ?? "";
    if (!field) {
      continue;
    }
    const valueCell = cells.get(cellKey(row, valueColumn));
    if (valueCell?.formula) {
      invalid(`${tableName} value for ${field} is a formula. Context values must be typed, never calculated.`);
    }
    if (values.has(field)) {
      invalid(`${tableName} lists ${field} more than once.`);
    }
    values.set(field, valueCell?.text.trim() ?? "");
    if (!MANIFEST_FIELDS.includes(field)) {
      issues.push({ severity: "warning", code: "manifest_unknown_field", sheet: tableName, row, params: { field } });
    }
  }

  const profile = values.get("profile") ?? "";
  if (profile !== WORKBOOK_PROFILE_ID) {
    throw new WorkbookParseError(
      "unknown_profile",
      `Workbook profile "${profile || "blank"}" is not supported. Expected ${WORKBOOK_PROFILE_ID}.`,
      { profile, expected: WORKBOOK_PROFILE_ID },
    );
  }

  const templateVersion = values.get("template_version") ?? "";
  if (!SUPPORTED_TEMPLATE_VERSIONS.has(templateVersion)) {
    throw new WorkbookParseError(
      "unsupported_version",
      `Workbook template version "${templateVersion || "blank"}" is not supported. Expected ${WORKBOOK_CONTRACT.version}.`,
      { version: templateVersion, expected: WORKBOOK_CONTRACT.version },
    );
  }

  const manifest = Object.fromEntries(
    MANIFEST_FIELDS.map((field) => [field, values.get(field) ?? ""]),
  ) as WorkbookManifest;
  manifest.template_version = WORKBOOK_CONTRACT.version;

  if (options.tenantPublicId && manifest.tenant_public_id && manifest.tenant_public_id !== options.tenantPublicId) {
    issues.push({
      severity: "error",
      code: "tenant_mismatch",
      sheet: tableName,
      params: { found: manifest.tenant_public_id, expected: options.tenantPublicId },
    });
  }
  if (options.brandPublicIds && manifest.brand_public_id && !options.brandPublicIds.includes(manifest.brand_public_id)) {
    issues.push({ severity: "error", code: "brand_mismatch", sheet: tableName, params: { found: manifest.brand_public_id } });
  }

  return { manifest, issues };
}
