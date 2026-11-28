import type { ReviewOperation, RowRef } from "@/lib/workbook/validation/model";

/* Shapes of a workbook apply (QOS-217). Type-only: the database schema
   imports these for its jsonb columns, the routes return them and the staff
   UI renders them. An apply writes drafts through the catalogue services;
   nothing here publishes, approves a translation or posts stock. */

/** One `POST …/apply` execution. */
export const APPLY_STATUSES = ["applying", "completed", "failed", "interrupted"] as const;
export type ApplyStatus = (typeof APPLY_STATUSES)[number];

/** Where one plan row stands after the latest attempt. */
export const ROW_APPLY_STATES = ["pending", "applied", "already_applied", "failed", "not_applied", "deferred_only"] as const;
export type RowApplyState = (typeof ROW_APPLY_STATES)[number];

/** Stable per-row failure codes; the staff UI translates them. */
export const APPLY_FAILURE_CODES = [
  "conflict",
  "service_validation",
  "forbidden",
  "target_not_found",
  "unique_violation",
  "stale_revision",
  "dependency_unresolved",
  "branch_not_permitted",
  "brand_mismatch",
  "archived_target",
  "unsupported_field",
  /** A dependency refusal: other records still use this one (QOS-200 follow-up). */
  "in_use",
  "unexpected",
] as const;
export type ApplyFailureCode = (typeof APPLY_FAILURE_CODES)[number];

export type ApplyFailure = {
  code: ApplyFailureCode;
  /** English, for logs and API clients; never internal detail. */
  message: string;
  field?: string;
  /** Rule reason when the code alone is not specific (for example `branch_price_default_variant_only`). */
  reason?: string;
  /** The row whose failure this row depends on. */
  responsible?: RowRef;
  /** Records that block the change (inventory dependency refusals) or a structured explanation such as a recipe cycle path. */
  details?: { dependencies?: Array<{ kind: string; count: number }>; path?: unknown };
};

export type ApplyImageOutcome = { status: "uploaded" | "already_present" | "failed" | "skipped"; reason?: string };

export type TypedLinkEntity =
  | "category"
  | "product"
  | "variant"
  | "modifier_group"
  | "modifier_option"
  | "menu"
  | "menu_section"
  // QOS-200 Phase 2 entities (migration 0065).
  | "unit"
  | "supplier"
  | "warehouse"
  | "inventory_category"
  | "inventory_item"
  | "recipe"
  | "recipe_version"
  | "recipe_line"
  | "prep_step"
  | "modifier_effect";

/** A sub-record a Phase 2 row saved besides its own record (QOS-200), shown in the row's history. */
export type AppliedRecord = {
  kind: "recipe" | "recipe_version" | "sellable_link" | "conversion" | "reference_cost";
  publicId: string;
  /** Version number of a recipe version, revision of a conversion or cost. */
  revision?: number;
  /** For a conversion: "standard" when nothing is stored because the units are standard. For a cost: "closed" when it was ended. */
  note?: "standard" | "closed";
  created: boolean;
  /** Business date a conversion or cost starts (or, closed, ends). */
  effectiveFrom?: string;
};

export type AppliedLink = { namespace: string; entityType: TypedLinkEntity; sourceKey: string; targetPublicId: string };

export type RowApplyResult = {
  operation: ReviewOperation | null;
  /** Columns sent to a catalogue service. */
  fieldsApplied: string[];
  /** Values read and kept with the plan but not saved (QOS-212–215 and later handlers). */
  deferred: Array<{ column: string; owner: string }>;
  /** Typed links written for the row: on save, or (QOS-200 follow-up) for a Match existing decision on an unchanged row. */
  links?: AppliedLink[];
  image?: ApplyImageOutcome;
  /** The recipe family of a recipe version, line, step or effect row (QOS-200). */
  parentPublicId?: string;
  /** The recipe version a line, step or effect was saved to (QOS-200). */
  versionPublicId?: string;
  /** Sub-records the row saved besides its own (QOS-200). */
  records?: AppliedRecord[];
  /** Why a row was not applied: its review classification. */
  reason?: string;
};

export type RowApplyOutcome = {
  state: RowApplyState;
  appliedPublicId: string | null;
  appliedAt: string | null;
  applyPublicId: string | null;
  error: ApplyFailure | null;
  result: RowApplyResult | null;
};

export type ApplyCounts = {
  applied: number;
  alreadyApplied: number;
  failed: number;
  notApplied: number;
  deferredValues: number;
};

export type ApplySummary = {
  /** Public ids saved per sheet. */
  affected?: Record<string, string[]>;
  failures?: Array<{ sheet: string; row: number; key: string; code: ApplyFailureCode }>;
};

export type ApplyAttempt = {
  publicId: string;
  status: ApplyStatus;
  /** For API clients only; staff screens show `actorDisplayName`. */
  actorSubject: string;
  /** The actor's name in this business, or null when they are not (or no longer) a member here (QOS-200 follow-up). */
  actorDisplayName: string | null;
  actorRole: "administrator" | "user";
  planRevision: number;
  planHash: string;
  startedAt: string;
  finishedAt: string | null;
  counts: ApplyCounts;
  summary: ApplySummary;
};

/** One past apply of the tenant, for the import page's history (QOS-200 follow-up). Never carries a raw subject. */
export type ApplyHistoryEntry = {
  publicId: string;
  status: ApplyStatus;
  planPublicId: string;
  fileName: string;
  sourceProfile: string;
  templateVersion: string | null;
  planRevision: number;
  actorDisplayName: string | null;
  actorRole: "administrator" | "user";
  startedAt: string;
  finishedAt: string | null;
  counts: ApplyCounts;
};

export type ApplyBlockReason =
  | "not_administrator"
  | "review_incomplete"
  | "stale"
  | "applying"
  | "applied"
  | "apply_failed";

export type ApplyPermissions = { canApply: boolean; reason?: ApplyBlockReason };

/** What an apply of the plan as it stands would do. */
export type ApplyPreview = { create: number; update: number; notApplied: number; deferredValues: number };

export type PlanApplyView = {
  permissions: ApplyPermissions;
  preview: ApplyPreview;
  attempts: ApplyAttempt[];
};
