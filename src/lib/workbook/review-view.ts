import { staffCopyWith, staffUiCopy, type StaffLocale, type StaffUiCopyKey } from "@/lib/staff/locale";
import { describeWorkbookApiError, WORKBOOK_ISSUE_COPY, type WorkbookApiError } from "@/lib/workbook/import-view";
import type { WorkbookIssueCode } from "@/lib/workbook/reader";
import type { WorkbookReviewErrorCode } from "@/lib/workbook/validation/errors";
import type {
  FieldDecision,
  PlanDecision,
  ReviewClassification,
  ReviewDiagnostic,
  ReviewDiagnosticCode,
  ReviewOperation,
  ReviewReadinessBlocker,
  ReviewRow,
} from "@/lib/workbook/validation/model";

/* Client-side wording for the workbook review (QOS-194). The server answers
   with stable codes and parameters; every visible sentence comes from
   STAFF_UI_COPY in English or Arabic. Nothing here says imported, persisted
   or applied: a review proposes and QOS-217 applies. */

export const REVIEW_CLASSIFICATION_COPY: Record<ReviewClassification, StaffUiCopyKey> = {
  create: "reviewClassCreate",
  update: "reviewClassUpdate",
  unchanged: "reviewClassUnchanged",
  skipped: "reviewClassSkipped",
  conflicting: "reviewClassConflicting",
  invalid: "reviewClassInvalid",
  blocked: "reviewClassBlocked",
  unsupported: "reviewClassUnsupported",
};

export const REVIEW_OPERATION_COPY: Record<ReviewOperation, StaffUiCopyKey> = {
  create: "reviewOpCreate",
  update: "reviewOpUpdate",
  archive: "reviewOpArchive",
  restore: "reviewOpRestore",
  remove_link: "reviewOpRemoveLink",
  reset_to_central: "reviewOpResetToCentral",
};

export const REVIEW_DIAGNOSTIC_COPY: Record<ReviewDiagnosticCode, StaffUiCopyKey> = {
  malformed_minor_units: "reviewDiagMalformedMinorUnits",
  malformed_integer: "reviewDiagMalformedInteger",
  integer_out_of_range: "reviewDiagIntegerOutOfRange",
  value_not_allowed: "reviewDiagValueNotAllowed",
  value_normalized: "reviewDiagValueNormalized",
  required_missing: "reviewDiagRequiredMissing",
  invalid_url: "reviewDiagInvalidUrl",
  currency_mismatch: "reviewDiagCurrencyMismatch",
  malformed_revision: "reviewDiagMalformedRevision",
  clear_field_unknown: "reviewDiagClearFieldUnknown",
  clear_field_not_clearable: "reviewDiagClearFieldNotClearable",
  clear_field_conflicts_with_value: "reviewDiagClearFieldConflicts",
  clear_fields_on_create: "reviewDiagClearFieldsOnCreate",
  action_required: "reviewDiagActionRequired",
  action_unknown: "reviewDiagActionUnknown",
  action_not_allowed_for_sheet: "reviewDiagActionNotAllowed",
  action_unsupported: "reviewDiagActionUnsupported",
  create_with_id: "reviewDiagCreateWithId",
  target_not_found: "reviewDiagTargetNotFound",
  update_requires_id: "reviewDiagUpdateRequiresId",
  update_target_unresolved: "reviewDiagUpdateTargetUnresolved",
  key_already_linked: "reviewDiagKeyAlreadyLinked",
  name_collision: "reviewDiagNameCollision",
  duplicate_name_in_workbook: "reviewDiagDuplicateName",
  duplicate_key: "reviewDiagDuplicateKey",
  stale_revision: "reviewDiagStaleRevision",
  revision_bound_at_review: "reviewDiagRevisionBound",
  resolved_existing: "reviewDiagResolvedExisting",
  unresolved_reference: "reviewDiagUnresolvedReference",
  blocked_by_dependency: "reviewDiagBlockedByDependency",
  branch_not_permitted: "reviewDiagBranchNotPermitted",
  default_variant_conflict: "reviewDiagDefaultVariantConflict",
  default_variant_archive: "reviewDiagDefaultVariantArchive",
  variant_target_required: "reviewDiagVariantTargetRequired",
  too_many_defaults: "reviewDiagTooManyDefaults",
  reset_without_override: "reviewDiagResetWithoutOverride",
  service_validation: "reviewDiagServiceValidation",
  status_not_approval: "reviewDiagStatusNotApproval",
  deferred_value: "reviewDiagDeferredValue",
  export_outdated: "reviewDiagExportOutdated",
  decision_rejected: "reviewDiagDecisionRejected",
};

export const REVIEW_DECISION_COPY: Record<PlanDecision["kind"], StaffUiCopyKey> = {
  match_existing: "reviewDecisionMatchExisting",
  create_new: "reviewDecisionCreateNew",
  use_linked_record: "reviewDecisionUseLinked",
  accept_current_revision: "reviewDecisionAcceptRevision",
  exclude: "reviewDecisionExclude",
  acknowledge_deferred: "reviewAckDeferredShort",
  acknowledge_warnings: "reviewAckWarningsShort",
  acknowledge_partial_apply: "reviewAckPartialShort",
};

export const REVIEW_FIELD_DECISION_COPY: Record<FieldDecision["decision"], StaffUiCopyKey> = {
  validated: "reviewFieldValidated",
  deferred: "reviewFieldDeferred",
  rejected: "reviewFieldRejected",
  mechanics: "reviewFieldMechanics",
};

export const REVIEW_BLOCKER_COPY: Record<ReviewReadinessBlocker, StaffUiCopyKey> = {
  conflicting: "reviewBlockerConflicting",
  invalid: "reviewBlockerInvalid",
  acknowledgements: "reviewBlockerAcknowledgements",
  stale: "reviewBlockerStale",
};

export const REVIEW_ERROR_COPY: Record<WorkbookReviewErrorCode, StaffUiCopyKey> = {
  review_unsupported_profile: "reviewErrorUnsupportedProfile",
  review_context_rejected: "reviewErrorContextRejected",
  idempotency_key_required: "reviewErrorIdempotencyRequired",
  idempotency_key_reused: "reviewErrorIdempotencyReused",
  plan_not_found: "reviewErrorPlanNotFound",
  plan_not_yours: "reviewErrorPlanNotYours",
  plan_hash_mismatch: "reviewErrorPlanHashMismatch",
  decisions_invalid: "reviewErrorDecisionsInvalid",
};

/** Row filters, in the order the panel shows them: rows needing a decision first. */
export const REVIEW_FILTERS = ["needs_decision", "invalid", "blocked", "create", "update", "unchanged", "unsupported", "skipped", "all"] as const;
export type ReviewFilter = (typeof REVIEW_FILTERS)[number];

export const REVIEW_FILTER_COPY: Record<ReviewFilter, StaffUiCopyKey> = {
  needs_decision: "reviewFilterNeedsDecision",
  invalid: "reviewClassInvalid",
  blocked: "reviewClassBlocked",
  create: "reviewClassCreate",
  update: "reviewClassUpdate",
  unchanged: "reviewClassUnchanged",
  unsupported: "reviewClassUnsupported",
  skipped: "reviewClassSkipped",
  all: "reviewFilterAll",
};

export function filterReviewRows(rows: ReviewRow[], filter: ReviewFilter, sheet: string) {
  return rows.filter((row) => {
    if (sheet && row.sheet !== sheet) return false;
    if (filter === "all") return true;
    if (filter === "needs_decision") return row.classification === "conflicting";
    return row.classification === filter;
  });
}

export function reviewFilterCount(rows: ReviewRow[], filter: ReviewFilter, sheet: string) {
  return filterReviewRows(rows, filter, sheet).length;
}

/** Excel-style place of a row: its source range when converted (`Products!D11:V11`), else the canonical row (`Variants!12:12`). */
export function rowLocation(row: Pick<ReviewRow, "sheet" | "row" | "source">) {
  return row.source?.range ?? `${row.sheet}!${row.row}:${row.row}`;
}

/** Place of one diagnostic: its cell when known, else the row. */
export function diagnosticLocation(row: Pick<ReviewRow, "sheet" | "row" | "source">, diagnostic: ReviewDiagnostic) {
  return diagnostic.cell ?? rowLocation(row);
}

/** Id of a row card, so "Go to responsible row" can scroll to it. */
export function reviewRowAnchor(ref: { sheet: string; row: number }) {
  return `review-row-${ref.sheet.replace(/[^A-Za-z0-9]/g, "-")}-${ref.row}`;
}

function isReviewCode(code: string): code is ReviewDiagnosticCode {
  return code in REVIEW_DIAGNOSTIC_COPY;
}

export function describeReviewDiagnostic(locale: StaffLocale, diagnostic: ReviewDiagnostic) {
  const values: Record<string, string | number> = { column: diagnostic.column ?? "", cell: diagnostic.cell ?? "", ...(diagnostic.params ?? {}) };
  if (diagnostic.code === "action_unsupported" && typeof values.reason === "string") {
    values.reason = staffUiCopy(locale, values.reason === "unsupported_sheet" ? "reviewReasonUnsupportedSheet" : "reviewReasonUnsupportedAction");
  }
  if (diagnostic.code === "blocked_by_dependency" && typeof values.reason === "string" && values.reason in REVIEW_CLASSIFICATION_COPY) {
    values.reason = staffUiCopy(locale, REVIEW_CLASSIFICATION_COPY[values.reason as ReviewClassification]);
  }
  if (diagnostic.code === "decision_rejected" && typeof values.kind === "string" && values.kind in REVIEW_DECISION_COPY) {
    values.kind = staffUiCopy(locale, REVIEW_DECISION_COPY[values.kind as PlanDecision["kind"]]);
  }
  if (isReviewCode(diagnostic.code)) {
    return staffCopyWith(locale, REVIEW_DIAGNOSTIC_COPY[diagnostic.code], values);
  }
  const issueKey = WORKBOOK_ISSUE_COPY[diagnostic.code as WorkbookIssueCode];
  return issueKey ? staffCopyWith(locale, issueKey, values) : staffUiCopy(locale, "workbookErrorGeneric");
}

const PRICE_LOCALES: Record<StaffLocale, string> = { en: "en-AE", ar: "ar-AE" };

/** A minor-unit amount as money in the tenant currency (`1250` AED → AED 12.50), Latin digits. */
export function formatMinorUnits(locale: StaffLocale, currency: string, minor: string) {
  if (!/^(0|[1-9][0-9]*)$/.test(minor) || !/^[A-Z]{3}$/.test(currency)) return minor;
  const format = new Intl.NumberFormat(PRICE_LOCALES[locale], { style: "currency", currency, numberingSystem: "latn" });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  const padded = minor.padStart(digits + 1, "0");
  const major = digits > 0 ? `${padded.slice(0, -digits)}.${padded.slice(-digits)}` : padded;
  return format.format(Number(major));
}

const MONEY_COLUMNS = new Set(["amount_minor", "price_minor"]);

/** A before or after value as shown: money columns formatted, everything else verbatim. */
export function formatReviewValue(locale: StaffLocale, currency: string, column: string, value: string | null) {
  if (value === null) return null;
  return MONEY_COLUMNS.has(column) ? formatMinorUnits(locale, currency, value) : value;
}

export type ReviewApiError = WorkbookApiError & { reason?: string; found?: string; expected?: string };

/** Localised sentence for a failed review request, from its status and code. */
export function describeReviewApiError(locale: StaffLocale, status: number, body: ReviewApiError | null) {
  const code = body?.code as WorkbookReviewErrorCode | undefined;
  if (code && code in REVIEW_ERROR_COPY) {
    return staffCopyWith(locale, REVIEW_ERROR_COPY[code], {
      reason: body?.reason ?? "",
      found: body?.found || "—",
      expected: body?.expected ?? "",
    });
  }
  return describeWorkbookApiError(locale, status, body);
}
