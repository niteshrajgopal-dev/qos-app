import type { WorkbookSheetSupport } from "@/lib/workbook/contract";
import type { CapabilityClass } from "@/lib/workbook/dictionary";
import type { WorkbookErrorCode } from "@/lib/workbook/errors";
import type { RegionId } from "@/lib/workbook/foodics-menu/layout";
import type { WorkbookIssue, WorkbookIssueCode, WorkbookIssueSeverity } from "@/lib/workbook/reader";
import { staffCopyWith, staffUiCopy, type StaffLocale, type StaffUiCopyKey } from "@/lib/staff/locale";

/* Client-side wording for the workbook parse result. Server responses carry
   stable codes and parameters; every visible sentence comes from
   STAFF_UI_COPY in English or Arabic. */

export const WORKBOOK_ISSUE_COPY: Record<WorkbookIssueCode, StaffUiCopyKey> = {
  formula_ignored: "issueFormulaIgnored",
  cell_error: "issueCellError",
  identifier_number: "issueIdentifierNumber",
  deferred_field: "issueDeferredField",
  deferred_sheet: "issueDeferredSheet",
  opening_stock_draft: "issueOpeningStockDraft",
  rejected_sheet: "issueRejectedSheet",
  current_import_tab: "issueCurrentImportTab",
  missing_columns: "issueMissingColumns",
  unknown_columns: "issueUnknownColumns",
  duplicate_columns: "issueDuplicateColumns",
  table_position: "issueTablePosition",
  rows_outside_table: "issueRowsOutsideTable",
  sheet_missing: "issueSheetMissing",
  unknown_sheet: "issueUnknownSheet",
  unknown_table: "issueUnknownTable",
  tenant_mismatch: "issueTenantMismatch",
  brand_mismatch: "issueBrandMismatch",
  manifest_unknown_field: "issueManifestUnknownField",
  example_rows_skipped: "issueExampleRowsSkipped",
  region_absent: "issueRegionAbsent",
  source_column_unmapped: "issueSourceColumnUnmapped",
  digits_normalized: "issueDigitsNormalized",
  identity_formula: "issueIdentityFormula",
  missing_identity: "issueMissingIdentity",
  invalid_number: "issueInvalidNumber",
  price_precision: "issuePricePrecision",
  negative_amount: "issueNegativeAmount",
  percent_precision: "issuePercentPrecision",
  tax_unresolved: "issueTaxUnresolved",
  currency_required: "issueCurrencyRequired",
  currency_minor_digits_unknown: "issueCurrencyMinorDigitsUnknown",
  image_not_url: "issueImageNotUrl",
  duplicate_identity: "issueDuplicateIdentity",
  ambiguous_identity: "issueAmbiguousIdentity",
  unresolved_reference: "issueUnresolvedReference",
  ambiguous_reference: "issueAmbiguousReference",
  conflicting_values: "issueConflictingValues",
  assignment_rule_conflict: "issueAssignmentRuleConflict",
  unit_kind_unresolved: "issueUnitKindUnresolved",
  yield_unit_unresolved: "issueYieldUnitUnresolved",
  effect_recipe_unresolved: "issueEffectRecipeUnresolved",
};

type ApiErrorCode = WorkbookErrorCode | "file_required" | "brand_not_found" | "no_brand" | "export_too_large" | "brand_required";

export const WORKBOOK_ERROR_COPY: Record<ApiErrorCode, StaffUiCopyKey> = {
  empty_file: "workbookErrorEmptyFile",
  file_too_large: "workbookErrorFileTooLarge",
  wrong_type: "workbookErrorWrongType",
  extension_mismatch: "workbookErrorExtensionMismatch",
  malformed_workbook: "workbookErrorMalformed",
  unsafe_workbook: "workbookErrorUnsafe",
  workbook_too_large: "workbookErrorTooBig",
  too_many_sheets: "workbookErrorTooManySheets",
  too_many_rows: "workbookErrorTooManyRows",
  too_many_columns: "workbookErrorTooManyColumns",
  cell_too_long: "workbookErrorCellTooLong",
  too_much_text: "workbookErrorTooMuchText",
  manifest_missing: "workbookErrorManifestMissing",
  manifest_invalid: "workbookErrorManifestInvalid",
  unknown_profile: "workbookErrorUnknownProfile",
  unsupported_version: "workbookErrorUnsupportedVersion",
  legacy_parse_failed: "workbookErrorLegacyParse",
  source_layout_partial: "workbookErrorSourceLayoutPartial",
  source_layout_ambiguous: "workbookErrorSourceLayoutAmbiguous",
  convert_unsupported_profile: "workbookErrorConvertUnsupported",
  convert_too_large: "workbookErrorConvertTooLarge",
  convert_currency_unresolved: "workbookErrorConvertCurrency",
  file_required: "workbookErrorFileRequired",
  brand_not_found: "workbookErrorBrandNotFound",
  no_brand: "workbookErrorNoBrand",
  export_too_large: "workbookErrorExportTooLarge",
  brand_required: "importBrandRequired",
};

export const WORKBOOK_SUPPORT_COPY: Record<WorkbookSheetSupport, StaffUiCopyKey> = {
  supported: "importSupportSupported",
  deferred: "importSupportDeferred",
  rejected: "importSupportRejected",
  separate_profile: "importSupportSeparate",
};

export const WORKBOOK_REGION_COPY: Record<RegionId, StaffUiCopyKey> = {
  categories: "importRegionCategories",
  products: "importRegionProducts",
  ingredients: "importRegionIngredients",
  product_recipe_lines: "importRegionProductRecipeLines",
  modifiers: "importRegionModifiers",
  modifier_ingredient_lines: "importRegionModifierIngredientLines",
  assignments: "importRegionAssignments",
  prepared_recipe_lines: "importRegionPreparedRecipeLines",
};

export const WORKBOOK_CAPABILITY_COPY: Record<CapabilityClass, StaffUiCopyKey> = {
  recognized: "importCapabilityRecognized",
  validated: "importCapabilityValidated",
  persistable: "importCapabilityPersistable",
  deferred: "importCapabilityDeferred",
};

export const WORKBOOK_SEVERITY_COPY: Record<WorkbookIssueSeverity, StaffUiCopyKey> = {
  error: "importSeverityError",
  warning: "importSeverityWarning",
  info: "importSeverityInfo",
};

/** Excel-style location of an issue, e.g. `Products!D7` or `Products!7:7`. */
export function workbookIssueLocation(issue: WorkbookIssue) {
  const sheet = issue.sheet ?? "";
  const cell = issue.params?.cell;
  if (cell) return `${sheet}!${cell}`;
  if (issue.row) return `${sheet}!${issue.row}:${issue.row}`;
  return sheet;
}

export function describeWorkbookIssue(locale: StaffLocale, issue: WorkbookIssue) {
  return staffCopyWith(locale, WORKBOOK_ISSUE_COPY[issue.code], {
    column: issue.column ?? "",
    ...(issue.params ?? {}),
  });
}

export type WorkbookApiError = {
  code?: string;
  params?: Record<string, string | number>;
  sheet?: string;
  max?: number;
};

/** Localised sentence for a failed workbook request, from its status and code. */
export function describeWorkbookApiError(locale: StaffLocale, status: number, body: WorkbookApiError | null) {
  const code = body?.code as ApiErrorCode | undefined;
  if (code && code in WORKBOOK_ERROR_COPY) {
    const params: Record<string, string | number> = { ...(body?.params ?? {}) };
    if (body?.sheet) params.sheet = body.sheet;
    if (body?.max != null) params.max = body.max;
    if (typeof params.maxBytes === "number") params.maxMb = Math.round(params.maxBytes / (1024 * 1024));
    return staffCopyWith(locale, WORKBOOK_ERROR_COPY[code], params);
  }
  if (status === 401) return staffUiCopy(locale, "workbookErrorSignedOut");
  if (status === 403) return staffUiCopy(locale, "workbookErrorAccess");
  if (status === 404) return staffUiCopy(locale, "workbookErrorNotFound");
  return staffUiCopy(locale, "workbookErrorGeneric");
}

/** File name from a Content-Disposition header, falling back to a safe default. */
export function attachmentFileName(header: string | null, fallback: string) {
  const match = header ? /filename="([^"]+)"/.exec(header) : null;
  return match?.[1] ?? fallback;
}
