import { isolateText } from "@/lib/staff/branch-copy";
import { staffCopyWith, staffCount, staffUiCopy, type StaffCountKey, type StaffLocale, type StaffUiCopyKey } from "@/lib/staff/locale";
import type {
  AppliedRecord,
  ApplyBlockReason,
  ApplyFailure,
  ApplyFailureCode,
  ApplyImageOutcome,
  ApplyStatus,
  RowApplyState,
} from "@/lib/workbook/apply/model";
import { describeWorkbookApiError, WORKBOOK_ISSUE_COPY, type WorkbookApiError } from "@/lib/workbook/import-view";
import type { WorkbookIssueCode } from "@/lib/workbook/reader";
import type { WorkbookReviewErrorCode } from "@/lib/workbook/validation/errors";
import type {
  FieldDecision,
  PlanDecision,
  ReviewClassification,
  ReviewDiagnostic,
  ReviewDiagnosticCode,
  PlanStatus,
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

export const REVIEW_CLASSIFICATION_SUB_COPY: Record<ReviewClassification, StaffUiCopyKey> = {
  create: "reviewClassCreateSub",
  update: "reviewClassUpdateSub",
  unchanged: "reviewClassUnchangedSub",
  skipped: "reviewClassSkippedSub",
  conflicting: "reviewClassConflictingSub",
  invalid: "reviewClassInvalidSub",
  blocked: "reviewClassBlockedSub",
  unsupported: "reviewClassUnsupportedSub",
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
  malformed_date: "reviewDiagMalformedDate",
  decimal_too_precise: "reviewDiagDecimalTooPrecise",
  value_not_positive: "reviewDiagValueNotPositive",
  existing_record_conflict: "reviewDiagExistingRecordConflict",
  recipe_draft_created: "reviewDiagRecipeDraftCreated",
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
  apply_in_progress: "applyErrorInProgress",
  plan_applied: "applyErrorPlanApplied",
};

/* Display names of the contract sheets. English is the contract name itself;
   unknown sheets (deferred or rejected ones) show their name as is. */
export const REVIEW_SHEET_COPY: Partial<Record<string, StaffUiCopyKey>> = {
  Branches: "reviewSheetBranches",
  Categories: "reviewSheetCategories",
  Products: "reviewSheetProducts",
  "Product Categories": "reviewSheetProductCategories",
  Variants: "reviewSheetVariants",
  "Branch Prices": "reviewSheetBranchPrices",
  "Sales Channels": "reviewSheetSalesChannels",
  "Variant Channel Prices": "reviewSheetVariantChannelPrices",
  "Modifier Groups": "reviewSheetModifierGroups",
  "Modifier Options": "reviewSheetModifierOptions",
  "Modifier Option Channel Prices": "reviewSheetModifierOptionChannelPrices",
  "Product Modifiers": "reviewSheetProductModifiers",
  Menus: "reviewSheetMenus",
  "Menu Branches": "reviewSheetMenuBranches",
  "Menu Sections": "reviewSheetMenuSections",
  "Menu Items": "reviewSheetMenuItems",
  "Source Map": "reviewSheetSourceMap",
  Units: "reviewSheetUnits",
  Suppliers: "reviewSheetSuppliers",
  Warehouses: "reviewSheetWarehouses",
  "Inventory Categories": "reviewSheetInventoryCategories",
  Ingredients: "reviewSheetIngredients",
  Recipes: "reviewSheetRecipes",
  "Recipe Lines": "reviewSheetRecipeLines",
  "Prep Steps": "reviewSheetPrepSteps",
  "Modifier Effects": "reviewSheetModifierEffects",
  "Prep Targets": "reviewSheetPrepTargets",
  "Opening Stock": "reviewSheetOpeningStock",
  "External Mappings": "reviewSheetExternalMappings",
  "Future Combos": "reviewSheetFutureCombos",
  "Combo Components": "reviewSheetComboComponents",
};

export function sheetLabel(locale: StaffLocale, sheet: string) {
  const key = REVIEW_SHEET_COPY[sheet];
  return key ? staffUiCopy(locale, key) : sheet;
}

/* Owners the server sends with field decisions, deferred values and
   unsupported actions, keyed by their literal text (validation/capability.ts,
   validation/actions.ts and the workbook dictionary; those server modules stay
   out of the client bundle). An unknown owner is shown as sent. */
export const REVIEW_OWNER_COPY: Partial<Record<string, StaffUiCopyKey>> = {
  "Checked by this review and applied by the import": "reviewOwnerValidated",
  "Used by the review only": "reviewOwnerMechanics",
  "Menu column extensions: next import increment": "reviewOwnerQos200Apply",
  "Reviewed and applied by the import": "reviewOwnerValidateQos200Apply",
  "Source values kept for a later import increment": "reviewOwnerQos212to215",
  "Kept for a later import increment": "reviewOwnerDomainServices",
  "Phase 3 (combos are rejected in Phase 2)": "reviewOwnerPhase3Combos",
  "Phase 2 workbook apply": "reviewOwnerPhase2Apply",
  "Recipe version numbers are assigned by QOS; the export shows the real number": "reviewOwnerVersionNumbering",
  "Recipe approval: dates are set when a draft is approved in the recipe editor": "reviewOwnerRecipeApproval",
  "Recipe editor: line notes have no field yet; line labels are edited in the recipe editor": "reviewOwnerLineNotes",
  "Recipe editor: the step guide keeps one instruction per language; titles, timings and checkpoints are not stored yet": "reviewOwnerStepGuide",
  "Preparation targets: the prep-target service is not built yet": "reviewOwnerPrepTargetsPending",
  "Provider mappings: the POS connections service is not built yet": "reviewOwnerExternalMappingsPending",
  "Opening stock: posted through its own intake with confirmation, never by this import": "reviewOwnerOpeningStockSeparate",
};

export function describeReviewOwner(locale: StaffLocale, owner: string) {
  const key = REVIEW_OWNER_COPY[owner];
  return key ? staffUiCopy(locale, key) : owner;
}

/** Numeric diagnostic parameters shown as a counted phrase, so the noun agrees with the number. */
const COUNTED_PARAMS: Partial<Record<ReviewDiagnosticCode, Record<string, StaffCountKey>>> = {
  name_collision: { candidates: "reviewSimilarRecords" },
  update_target_unresolved: { candidates: "reviewSimilarRecords" },
  deferred_value: { count: "reviewValues" },
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

function capitalised(text: string) {
  return text ? text[0]!.toUpperCase() + text.slice(1) : text;
}

export function describeReviewDiagnostic(locale: StaffLocale, diagnostic: ReviewDiagnostic) {
  const values: Record<string, string | number> = { column: diagnostic.column ?? "", cell: diagnostic.cell ?? "", ...(diagnostic.params ?? {}) };
  if (diagnostic.code === "action_unsupported" && typeof values.reason === "string") {
    values.reason = staffUiCopy(locale, values.reason === "unsupported_sheet" ? "reviewReasonUnsupportedSheet" : "reviewReasonUnsupportedAction");
  }
  if (diagnostic.code === "action_unsupported" && typeof values.owner === "string") {
    values.owner = describeReviewOwner(locale, values.owner);
  }
  for (const [param, countKey] of Object.entries(COUNTED_PARAMS[diagnostic.code as ReviewDiagnosticCode] ?? {})) {
    if (typeof values[param] === "number") values[param] = staffCount(locale, countKey, values[param]);
  }
  if (diagnostic.code === "blocked_by_dependency" && typeof values.reason === "string" && values.reason in REVIEW_CLASSIFICATION_COPY) {
    values.reason = staffUiCopy(locale, REVIEW_CLASSIFICATION_COPY[values.reason as ReviewClassification]);
  }
  if (diagnostic.code === "decision_rejected" && typeof values.kind === "string" && values.kind in REVIEW_DECISION_COPY) {
    values.kind = staffUiCopy(locale, REVIEW_DECISION_COPY[values.kind as PlanDecision["kind"]]);
  }
  const reasonKey = typeof values.reason === "string" ? PHASE2_REASON_COPY[values.reason] : undefined;
  if (diagnostic.code === "existing_record_conflict") {
    values.reason = reasonKey ? staffUiCopy(locale, reasonKey) : String(values.reason ?? "");
  }
  if (diagnostic.code === "service_validation" && reasonKey) {
    // The rule's own sentence says why; the column is named by the diagnostic location.
    return `${staffCopyWith(locale, "reviewDiagServiceValidation", values)} ${capitalised(staffUiCopy(locale, reasonKey))}.`;
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

/** A minor-unit amount as typed, with its money value beside it (`1800` AED → `1800 (AED 18.00)`); anything else verbatim. */
export function describeMinorUnits(_locale: StaffLocale, currency: string, minor: string) {
  /* The parenthetical always uses the English ISO format (`AED 18.00`).
     Arabic NumberFormat puts د.إ after the amount, and those marks reorder
     `1800 → 1900` once the value sits inside the LTR diff. */
  const money = formatMinorUnits("en", currency, minor);
  return money === minor ? minor : `${minor} (${money})`;
}

/* Minor units are the canonical value of these columns everywhere: the
   review shows them as typed with the money beside them, and the correction
   report keeps expected and found in raw minor units. */
const MONEY_COLUMNS = new Set(["amount_minor", "price_minor"]);

/** A before or after value as shown: money columns in minor units with their money value, everything else verbatim. */
export function formatReviewValue(locale: StaffLocale, currency: string, column: string, value: string | null) {
  if (value === null) return null;
  return MONEY_COLUMNS.has(column) ? describeMinorUnits(locale, currency, value) : value;
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

/* Workbook apply (QOS-217). Every state, failure code and block reason the
   server sends has a key here; the Record types make a missing one a type
   error. An apply saves drafts: nothing here says published or approved. */

export const PLAN_STATUS_COPY: Record<PlanStatus, StaffUiCopyKey> = {
  review_ready: "reviewStatusReady",
  stale: "reviewStatusStale",
  applying: "applyStatusApplying",
  applied: "applyStatusApplied",
  apply_failed: "applyStatusFailed",
};

export const APPLY_BLOCK_REASON_COPY: Record<ApplyBlockReason, StaffUiCopyKey> = {
  not_administrator: "applyBlockNotAdministrator",
  review_incomplete: "applyBlockReviewIncomplete",
  stale: "applyBlockStale",
  applying: "applyBlockApplying",
  applied: "applyBlockApplied",
  apply_failed: "applyBlockApplyFailed",
};

export const APPLY_ROW_STATE_COPY: Record<RowApplyState, StaffUiCopyKey> = {
  pending: "applyRowPending",
  applied: "applyRowApplied",
  already_applied: "applyRowAlreadyApplied",
  failed: "applyRowFailed",
  not_applied: "applyRowNotApplied",
  deferred_only: "applyRowDeferredOnly",
};

export const APPLY_FAILURE_COPY: Record<ApplyFailureCode, StaffUiCopyKey> = {
  conflict: "applyFailConflict",
  service_validation: "applyFailServiceValidation",
  forbidden: "applyFailForbidden",
  target_not_found: "applyFailTargetNotFound",
  unique_violation: "applyFailUniqueViolation",
  stale_revision: "applyFailStaleRevision",
  dependency_unresolved: "applyFailDependencyUnresolved",
  branch_not_permitted: "applyFailBranchNotPermitted",
  brand_mismatch: "applyFailBrandMismatch",
  archived_target: "applyFailArchivedTarget",
  unsupported_field: "applyFailUnsupportedField",
  unexpected: "applyFailUnexpected",
};

/* Phase 2 rule and service reasons (QOS-200), shown on review diagnostics and
   apply failures alike. Service codes that are one family share a sentence. */
export const PHASE2_REASON_COPY: Record<string, StaffUiCopyKey> = {
  code_required: "reviewReasonCodeRequired",
  arabic_name_required: "reviewReasonArabicNameRequired",
  standard_unit_kind_mismatch: "reviewReasonStandardUnitKindMismatch",
  create_inactive: "reviewReasonCreateInactive",
  factor_conflicts_with_standard: "reviewReasonFactorConflictsWithStandard",
  standard_pair_not_overridable: "reviewReasonFactorConflictsWithStandard",
  recipe_unit_required: "reviewReasonRecipeUnitRequired",
  recipe_draft_required: "reviewReasonRecipeDraftRequired",
  draft_exists: "reviewReasonDraftExists",
  version_not_draft: "reviewReasonVersionNotDraft",
  variant_linked_elsewhere: "reviewReasonVariantLinkedElsewhere",
  link_exists: "reviewReasonVariantLinkedElsewhere",
  warehouse_branch_taken: "reviewReasonWarehouseBranchTaken",
  output_item_taken: "reviewReasonOutputItemTaken",
  immutable_field: "reviewReasonImmutableField",
  location_immutable: "reviewReasonLocationImmutable",
  warehouse_code_immutable: "reviewReasonWarehouseCodeImmutable",
  duplicate_line_item: "reviewReasonDuplicateLineItem",
  duplicate_step_number: "reviewReasonDuplicateStepNumber",
  recipe_kind_immutable: "reviewReasonRecipeKindImmutable",
  target_type_mismatch: "reviewReasonTargetTypeMismatch",
  output_item_not_prepared: "reviewReasonOutputItemNotPrepared",
  output_item_not_allowed: "reviewReasonOutputItemNotAllowed",
  effects_sellable_only: "reviewReasonEffectsSellableOnly",
  target_line_not_allowed: "reviewReasonEffectShape",
  target_line_required: "reviewReasonEffectShape",
  effect_item_not_allowed: "reviewReasonEffectShape",
  effect_item_required: "reviewReasonEffectShape",
  quantity_too_precise: "reviewReasonQuantityTooPrecise",
  yield_too_precise: "reviewReasonQuantityTooPrecise",
  unit_in_use: "reviewReasonInUse",
  supplier_in_use: "reviewReasonInUse",
  category_in_use: "reviewReasonInUse",
  item_in_use: "reviewReasonInUse",
  warehouse_in_use: "reviewReasonInUse",
  justification_required: "reviewReasonJustificationRequired",
};

/** Rule reasons that make a failure code more specific. */
export const APPLY_FAILURE_REASON_COPY: Record<string, StaffUiCopyKey> = {
  branch_price_default_variant_only: "applyReasonBranchPriceDefaultVariantOnly",
  status_requires_publication: "applyReasonStatusRequiresPublication",
  menu_requires_branch: "applyReasonMenuRequiresBranch",
  // QOS-200 Phase 2 services; the same sentences as the review reasons.
  ...PHASE2_REASON_COPY,
};

export const APPLY_ATTEMPT_STATUS_COPY: Record<ApplyStatus, StaffUiCopyKey> = {
  applying: "applyAttemptApplying",
  completed: "applyAttemptCompleted",
  failed: "applyAttemptFailed",
  interrupted: "applyAttemptInterrupted",
};

export const APPLY_IMAGE_COPY: Record<ApplyImageOutcome["status"], StaffUiCopyKey> = {
  uploaded: "applyImageUploaded",
  already_present: "applyImageAlreadyPresent",
  failed: "applyImageFailed",
  skipped: "applyImageSkipped",
};

export const APPLY_API_ERROR_CODES = [
  "idempotency_key_required",
  "apply_body_invalid",
  "apply_requires_administrator",
  "tenant_inactive",
  "plan_not_found",
  "plan_hash_mismatch",
  "plan_stale",
  "apply_in_progress",
  "plan_applied",
  "plan_rereview_required",
  "review_incomplete",
  "idempotency_key_reused",
] as const;
export type ApplyApiErrorCode = (typeof APPLY_API_ERROR_CODES)[number];

export const APPLY_ERROR_COPY: Record<ApplyApiErrorCode, StaffUiCopyKey> = {
  idempotency_key_required: "applyErrorKeyRequired",
  apply_body_invalid: "applyErrorBodyInvalid",
  apply_requires_administrator: "applyErrorRequiresAdministrator",
  tenant_inactive: "applyErrorTenantInactive",
  plan_not_found: "reviewErrorPlanNotFound",
  plan_hash_mismatch: "applyErrorHashMismatch",
  plan_stale: "applyErrorPlanStale",
  apply_in_progress: "applyErrorInProgress",
  plan_applied: "applyErrorPlanApplied",
  plan_rereview_required: "applyErrorRereviewRequired",
  review_incomplete: "applyErrorReviewIncomplete",
  idempotency_key_reused: "applyErrorKeyReused",
};

/** Localised sentence for a failed apply request, from its status and code. */
export function describeApplyApiError(locale: StaffLocale, status: number, body: ReviewApiError | null) {
  const code = body?.code;
  if (code && code in APPLY_ERROR_COPY) return staffUiCopy(locale, APPLY_ERROR_COPY[code as ApplyApiErrorCode]);
  return describeReviewApiError(locale, status, body);
}

/** One row's apply failure: the sentence for its code, made specific by its rule reason when known. */
export function describeApplyFailure(locale: StaffLocale, failure: Pick<ApplyFailure, "code" | "reason">) {
  const base = staffUiCopy(locale, APPLY_FAILURE_COPY[failure.code] ?? "applyFailUnexpected");
  const reasonKey = failure.reason ? APPLY_FAILURE_REASON_COPY[failure.reason] : undefined;
  if (!reasonKey) return base;
  const reason = staffUiCopy(locale, reasonKey);
  return PHASE2_REASON_COPY[failure.reason!] ? `${base} ${capitalised(reason)}.` : `${base} ${reason}`;
}

/** Saved states: the row's record exists in the catalogue after the apply. */
export function isSavedApplyState(state: RowApplyState) {
  return state === "applied" || state === "already_applied";
}

export type ApplySheetSummary = { sheet: string; saved: number; notApplied: number; failed: number; deferredValues: number };

/** Saved versus parsed, per sheet, from the rows' latest apply outcome; sheets keep their plan order. */
export function summariseApplyBySheet(rows: ReviewRow[]): ApplySheetSummary[] {
  const bySheet = new Map<string, ApplySheetSummary>();
  for (const row of rows) {
    if (!row.apply) continue;
    const entry = bySheet.get(row.sheet) ?? { sheet: row.sheet, saved: 0, notApplied: 0, failed: 0, deferredValues: 0 };
    if (isSavedApplyState(row.apply.state)) entry.saved += 1;
    else if (row.apply.state === "failed") entry.failed += 1;
    else entry.notApplied += 1;
    entry.deferredValues += row.deferredFields.length;
    bySheet.set(row.sheet, entry);
  }
  return [...bySheet.values()];
}

/** Rows of a plan by sheet and key, so a row can find the record its parent was saved as. */
export function indexReviewRows(rows: ReviewRow[]) {
  return new Map(rows.map((row) => [`${row.sheet}\u0000${row.key}`, row]));
}

const INVENTORY_PATHS: Record<string, string> = {
  Units: "units",
  Suppliers: "suppliers",
  Warehouses: "warehouses",
  "Inventory Categories": "categories",
  Ingredients: "items",
};

const PUBLIC_ID_PREFIX = {
  product: /^prd_/,
  menu: /^men_/,
  section: /^sec_/,
  modifierGroup: /^modgrp_/,
  category: /^cat_/,
} as const;

/** Public id of a parent row: the key itself when it is a QOS id, else what that row was saved as or matched to. */
function parentPublicId(index: Map<string, ReviewRow>, sheet: string, key: string | undefined, prefix: RegExp) {
  if (!key) return null;
  if (prefix.test(key)) return key;
  const parent = index.get(`${sheet}\u0000${key}`);
  if (!parent) return null;
  for (const candidate of [parent.apply?.appliedPublicId, parent.identity.targetPublicId]) {
    if (candidate && prefix.test(candidate)) return candidate;
  }
  return null;
}

function ownPublicId(row: ReviewRow, prefix: RegExp) {
  for (const candidate of [row.apply?.appliedPublicId, row.identity.targetPublicId]) {
    if (candidate && prefix.test(candidate)) return candidate;
  }
  return null;
}

/**
 * Editor for a saved row, using the staff routes under /tenants/{id}/catalogue:
 * products, variants and their links open the product editor; menus and their
 * sections, items and branches the menu editor; modifier groups and options the
 * modifier group editor; categories the category editor. Null when the record
 * is unknown or the row was not saved.
 */
export function applyEditorHref(tenantId: string, row: ReviewRow, index: Map<string, ReviewRow>) {
  if (!row.apply || !isSavedApplyState(row.apply.state)) return null;
  const after = row.after ?? {};
  const base = `/tenants/${tenantId}/catalogue`;
  const product = (id: string | null) => (id ? `${base}/products/${id}/edit` : null);
  const menu = (id: string | null) => (id ? `${base}/menus/${id}/edit` : null);
  const group = (id: string | null) => (id ? `${base}/modifier-groups/${id}/edit` : null);
  switch (row.sheet) {
    case "Products":
      return product(ownPublicId(row, PUBLIC_ID_PREFIX.product));
    case "Variants":
    case "Product Categories":
    case "Product Modifiers":
      return product(parentPublicId(index, "Products", after.product_key, PUBLIC_ID_PREFIX.product));
    case "Branch Prices": {
      const variant = after.variant_key ? index.get(`Variants\u0000${after.variant_key}`) : undefined;
      return product(parentPublicId(index, "Products", variant?.after?.product_key, PUBLIC_ID_PREFIX.product));
    }
    case "Menus":
      return menu(ownPublicId(row, PUBLIC_ID_PREFIX.menu));
    case "Menu Sections":
    case "Menu Branches":
      return menu(parentPublicId(index, "Menus", after.menu_key, PUBLIC_ID_PREFIX.menu));
    case "Menu Items": {
      const section = after.section_key ? index.get(`Menu Sections\u0000${after.section_key}`) : undefined;
      return menu(parentPublicId(index, "Menus", section?.after?.menu_key, PUBLIC_ID_PREFIX.menu));
    }
    case "Modifier Groups":
      return group(ownPublicId(row, PUBLIC_ID_PREFIX.modifierGroup));
    case "Modifier Options":
      return group(parentPublicId(index, "Modifier Groups", after.modifier_group_key, PUBLIC_ID_PREFIX.modifierGroup));
    case "Categories": {
      const id = ownPublicId(row, PUBLIC_ID_PREFIX.category);
      return id ? `${base}/categories/${id}/edit` : `${base}/categories`;
    }
    // QOS-200: inventory records open their inventory editor; recipe rows the saved draft (or version).
    case "Units":
    case "Suppliers":
    case "Warehouses":
    case "Inventory Categories":
    case "Ingredients": {
      const id = row.apply.appliedPublicId;
      return id ? `/tenants/${tenantId}/inventory/${INVENTORY_PATHS[row.sheet]}/${id}${row.sheet === "Units" ? "/edit" : ""}` : null;
    }
    case "Recipes":
    case "Recipe Lines":
    case "Prep Steps":
    case "Modifier Effects": {
      const family = row.apply.result?.parentPublicId;
      const version = row.sheet === "Recipes" ? row.apply.appliedPublicId : row.apply.result?.versionPublicId;
      return family && version ? `${base}/recipes/${family}/versions/${version}` : family ? `${base}/recipes/${family}` : null;
    }
    default:
      return null;
  }
}

const DATE_LOCALES: Record<StaffLocale, string> = { en: "en-AE", ar: "ar-AE" };

/** Date and time of an apply, Latin digits in both languages like the rest of the staff portal. */
export function formatApplyTime(locale: StaffLocale, value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(DATE_LOCALES[locale], { dateStyle: "medium", timeStyle: "short", numberingSystem: "latn" }).format(date);
}

/* QOS-200 Phase 2 import: sub-records a row saved, pending sheets and
   dependency kinds, all as staff copy. */

/** One sub-record a row saved, as a short sentence (draft number, revision and date). */
export function describeAppliedRecord(locale: StaffLocale, record: AppliedRecord) {
  const date = isolateText(record.effectiveFrom ?? "");
  switch (record.kind) {
    case "recipe":
      return staffCopyWith(locale, "applyRecordRecipe", { id: isolateText(record.publicId) });
    case "recipe_version":
      return staffCopyWith(locale, "applyRecordRecipeDraft", { n: record.revision ?? "" });
    case "sellable_link":
      return staffCopyWith(locale, "applyRecordSellableLink", { date });
    case "conversion":
      if (record.note === "standard") return staffUiCopy(locale, "applyRecordConversionStandard");
      if (record.note === "closed") return staffUiCopy(locale, "applyRecordConversionClosed");
      return staffCopyWith(locale, "applyRecordConversion", { n: record.revision ?? "", date });
    case "reference_cost":
      if (record.note === "closed") return staffUiCopy(locale, "applyRecordCostClosed");
      return staffCopyWith(locale, "applyRecordReferenceCost", { n: record.revision ?? "", date });
  }
}


/* Sheets this import reads and keeps but never applies (QOS-200, D6), with the
   plain disposition the server's owner literal stands for. */
export const PENDING_SHEET_OWNER_COPY: Record<string, StaffUiCopyKey> = {
  "Prep Targets": "reviewOwnerPrepTargetsPending",
  "Opening Stock": "reviewOwnerOpeningStockSeparate",
  "External Mappings": "reviewOwnerExternalMappingsPending",
  "Future Combos": "reviewOwnerPhase3Combos",
  "Combo Components": "reviewOwnerPhase3Combos",
};

export type PendingSheet = { sheet: string; rejected: boolean; rowCount: number; owner: StaffUiCopyKey };

/** Deferred and rejected sheets that carried rows, in plan order. */
export function pendingSheets(sheets: Array<{ sheet: string; support: string; rowCount: number }>): PendingSheet[] {
  return sheets
    .filter((entry) => (entry.support === "deferred" || entry.support === "rejected") && entry.rowCount > 0 && PENDING_SHEET_OWNER_COPY[entry.sheet])
    .map((entry) => ({ sheet: entry.sheet, rejected: entry.support === "rejected", rowCount: entry.rowCount, owner: PENDING_SHEET_OWNER_COPY[entry.sheet]! }));
}

const DEPENDENCY_COPY: Record<string, StaffCountKey> = {
  inventory_items: "applyDependencyItems",
  recipe_lines: "recipeLinesDependency",
  recipe_effects: "recipeEffectsDependency",
  sellable_links: "sellableLinksDependency",
  recipe_outputs: "recipeOutputsDependency",
};

/** What still uses a record a row could not archive ("3 items, 1 recipe line"). */
export function describeDependencies(locale: StaffLocale, dependencies: Array<{ kind: string; count: number }>) {
  return dependencies
    .map((dependency) => {
      const key = DEPENDENCY_COPY[dependency.kind];
      return key ? staffCount(locale, key, dependency.count) : staffCount(locale, "applyDependencyRecords", dependency.count);
    })
    .join(locale === "ar" ? "، " : ", ");
}
