import type { PlanApplyView, RowApplyOutcome } from "@/lib/workbook/apply/model";
import type { WorkbookSheetSupport } from "@/lib/workbook/contract";
import type { CapabilityClass } from "@/lib/workbook/dictionary";
import type { FoodicsCapability, FoodicsRequiredMapping } from "@/lib/workbook/foodics-menu/reader";
import type { IgnoredSheet } from "@/lib/workbook/foodics-menu/layout";
import type { WorkbookIssue, WorkbookIssueCode, WorkbookRow } from "@/lib/workbook/reader";

/* Shapes of the workbook review (QOS-194). Type-only: the database schema
   imports these for its jsonb columns, the routes return them and the staff
   UI renders them. Nothing here is a catalogue record; a review proposes,
   QOS-217 applies. */

export const REVIEW_CLASSIFICATIONS = [
  "create",
  "update",
  "unchanged",
  "skipped",
  "conflicting",
  "invalid",
  "blocked",
  "unsupported",
] as const;

export type ReviewClassification = (typeof REVIEW_CLASSIFICATIONS)[number];

export const REVIEW_OPERATIONS = ["create", "update", "archive", "restore", "remove_link", "reset_to_central"] as const;

export type ReviewOperation = (typeof REVIEW_OPERATIONS)[number];

export type ReviewSourceProfile = "qos_extended_v1" | "foodics_menu_v1";

export const REVIEW_DIAGNOSTIC_CODES = [
  "malformed_minor_units",
  "malformed_integer",
  "integer_out_of_range",
  "value_not_allowed",
  "value_normalized",
  "required_missing",
  "invalid_url",
  "currency_mismatch",
  "malformed_revision",
  "clear_field_unknown",
  "clear_field_not_clearable",
  "clear_field_conflicts_with_value",
  "clear_fields_on_create",
  "action_required",
  "action_unknown",
  "action_not_allowed_for_sheet",
  "action_unsupported",
  "create_with_id",
  "target_not_found",
  "update_requires_id",
  "update_target_unresolved",
  "key_already_linked",
  "name_collision",
  "duplicate_name_in_workbook",
  "duplicate_key",
  "stale_revision",
  "revision_bound_at_review",
  "resolved_existing",
  "unresolved_reference",
  "blocked_by_dependency",
  "branch_not_permitted",
  "default_variant_conflict",
  "default_variant_archive",
  "variant_target_required",
  "too_many_defaults",
  "reset_without_override",
  "service_validation",
  "status_not_approval",
  "deferred_value",
  "export_outdated",
  "decision_rejected",
  // QOS-200: strict dates and decimals on the Phase 2 sheets, and an existing record (open draft, live link) a row conflicts with.
  "malformed_date",
  "decimal_too_precise",
  "value_not_positive",
  "existing_record_conflict",
  "recipe_draft_created",
] as const;

export type ReviewDiagnosticCode = (typeof REVIEW_DIAGNOSTIC_CODES)[number];

export type ReviewSeverity = "error" | "warning" | "info";

export type RowRef = { sheet: string; row: number; key: string };

export type ReviewDiagnostic = {
  severity: ReviewSeverity;
  /** A review code, or a reader issue carried onto the row it belongs to. */
  code: ReviewDiagnosticCode | WorkbookIssueCode;
  column?: string;
  cell?: string;
  params?: Record<string, string | number>;
  /** The row that must be corrected when this row is blocked by it. */
  responsible?: RowRef;
};

/** Row decisions are addressed by sheet and row; a `key` lets a decision follow its row into an edited upload. */
export type PlanDecision =
  | { kind: "match_existing"; sheet: string; row: number; key?: string; targetPublicId: string }
  | { kind: "create_new"; sheet: string; row: number; key?: string }
  | { kind: "use_linked_record"; sheet: string; row: number; key?: string }
  | { kind: "accept_current_revision"; sheet: string; row: number; key?: string }
  | { kind: "exclude"; sheet: string; row: number; key?: string }
  | { kind: "acknowledge_deferred"; sheet: string; column: string }
  | { kind: "acknowledge_warnings" }
  | { kind: "acknowledge_partial_apply" };

export type RowDecision = Extract<PlanDecision, { row: number }>;
export type PlanAcknowledgement = Exclude<PlanDecision, { row: number }>;

export const ROW_DECISION_KINDS = ["match_existing", "create_new", "use_linked_record", "accept_current_revision", "exclude"] as const;
export const ACKNOWLEDGEMENT_KINDS = ["acknowledge_deferred", "acknowledge_warnings", "acknowledge_partial_apply"] as const;

export type ReviewChange = { column: string; before: string | null; after: string | null; cell?: string };

export type ReviewDeferredField = {
  column: string;
  value: string;
  owner: string;
  cell?: string;
  display?: { sourceText: string; basisPoints?: number; percentDisplay?: string };
};

export type ReviewDependencies = { blockedBy: RowRef[]; blocks: RowRef[] };

export type ReviewLabel = { en: string; ar: string };

export type ReviewCandidate = {
  publicId: string;
  label: ReviewLabel;
  /** Technical detail shown as code, e.g. a variant price `1800 AED`. */
  detail?: string;
  variantCount?: number;
  isDefault?: boolean;
  kind: "name_collision" | "linked" | "variant_target";
};

export type ReviewIdentity = {
  namespace: string;
  keyVerified: boolean;
  targetPublicId: string | null;
  targetRevision: string | null;
  via: "qos_id" | "source_link" | "decision" | "endpoints" | null;
};

export type ReviewProvenance = NonNullable<WorkbookRow["source"]>;

export type ReviewRow = {
  sheet: string;
  row: number;
  key: string;
  requestedAction: string;
  classification: ReviewClassification;
  operation: ReviewOperation | null;
  identity: ReviewIdentity;
  label: ReviewLabel;
  before: Record<string, string> | null;
  after: Record<string, string> | null;
  changes: ReviewChange[];
  deferredFields: ReviewDeferredField[];
  diagnostics: ReviewDiagnostic[];
  dependencies: ReviewDependencies;
  branch?: { publicId: string; name: string };
  candidates?: ReviewCandidate[];
  /** Set when the operator chose to create despite a name collision or link. */
  acknowledgedCollision?: boolean;
  decision: RowDecision | null;
  source?: ReviewProvenance;
  /** Outcome of the latest apply of this row (QOS-217); absent until the plan is applied. */
  apply?: RowApplyOutcome;
};

/** Display-only parts of a review row, stored beside its values. */
export type ReviewRowDetail = Pick<ReviewRow, "identity" | "label" | "branch" | "candidates" | "acknowledgedCollision">;

export type FieldDecision = {
  sheet: string;
  column: string;
  dictionaryClass: CapabilityClass | null;
  decision: "validated" | "deferred" | "rejected" | "mechanics";
  owner: string;
  rowsWithValues: number;
};

export type ReviewCounts = Record<ReviewClassification, number> & {
  rows: number;
  deferredValues: number;
  acknowledgementsPending: number;
};

export type ReviewSheetSummary = {
  sheet: string;
  support: WorkbookSheetSupport;
  present: boolean;
  rowCount: number;
  counts: Record<ReviewClassification, number>;
  issues: WorkbookIssue[];
};

export type RequiredAcknowledgement = {
  kind: PlanAcknowledgement["kind"];
  sheet?: string;
  column?: string;
  rows: number;
};

export type ReviewReadinessBlocker = "conflicting" | "invalid" | "acknowledgements" | "stale";

export type ReviewContext = {
  profile: ReviewSourceProfile;
  sourceProfile: string | null;
  fileName: string;
  fileFingerprint: string;
  sourceFileSha256?: string;
  templateVersion: string;
  dictionaryVersion: string | null;
  tenantPublicId: string;
  brandPublicId: string;
  currency: string;
  sourceNamespace: string;
  keysVerified: boolean;
  isExport: boolean;
  exportRevision?: string;
  branchScope: "all" | string[];
  requiredMappings?: FoodicsRequiredMapping[];
  ignoredSheets?: IgnoredSheet[];
};

/** `applying`, `applied` and `apply_failed` are QOS-217's (migration 0058). */
export type PlanStatus = "review_ready" | "stale" | "applying" | "applied" | "apply_failed";

export type PlanHeader = {
  publicId: string;
  revision: number;
  status: PlanStatus;
  planHash: string;
  snapshotHash: string;
  engineVersion: string;
  createdAt: string;
  reviewedAt: string;
  createdBySubject: string;
};

export type WorkbookReview = {
  context: ReviewContext;
  counts: ReviewCounts;
  sheets: ReviewSheetSummary[];
  fieldDecisions: FieldDecision[];
  parseIssues: WorkbookIssue[];
  /** Plan-level notes, for example an export older than the current records. */
  notices: ReviewDiagnostic[];
  rows: ReviewRow[];
  acknowledgements: { required: RequiredAcknowledgement[]; given: PlanAcknowledgement[] };
  readiness: { reviewComplete: boolean; blockers: ReviewReadinessBlocker[] };
};

export type WorkbookReviewResult = WorkbookReview & {
  plan: PlanHeader;
  stale?: boolean;
  replayed?: boolean;
  /** Apply permissions, preview and history (QOS-217). */
  apply?: PlanApplyView;
};

/** One sheet of the normalised input, from either profile. */
export type ReviewInputSheet = {
  sheet: string;
  support: WorkbookSheetSupport;
  present: boolean;
  columns: string[];
  rows: WorkbookRow[];
  issues: WorkbookIssue[];
};

/** Everything the review needs from an upload; stored with the plan so a re-review never needs the file again. */
export type ReviewInputMeta = Omit<ReviewContext, "branchScope"> & {
  capabilities?: FoodicsCapability[];
  sheets: Array<Omit<ReviewInputSheet, "rows">>;
  parseIssues: WorkbookIssue[];
};

export type ReviewInput = Omit<ReviewInputMeta, "sheets"> & { sheets: ReviewInputSheet[] };

/** Header jsonb `context` column: what a plan shows besides its rows. */
export type StoredPlanContext = {
  context: ReviewContext;
  input: ReviewInputMeta;
  fieldDecisions: FieldDecision[];
  sheets: ReviewSheetSummary[];
  notices: ReviewDiagnostic[];
  acknowledgementsRequired: RequiredAcknowledgement[];
  readiness: WorkbookReview["readiness"];
};
