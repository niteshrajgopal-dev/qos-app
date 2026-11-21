import type { SelectionCountMode } from "@/lib/catalogue/modifier-assignment-policy";
import type { ProductModifierGroupAssignmentView } from "@/lib/catalogue/modifiers";
import {
  staffCopyWith,
  staffUiCopy,
  type StaffLocale,
  type StaffUiCopyKey,
} from "@/lib/staff/locale";

/* Client-side wording and request bodies for the product modifier policy
   editor (QOS-212). The server resolves the effective policy; this module
   only describes it and turns the form into a PATCH body. */

export type AssignmentPolicyView = Pick<
  ProductModifierGroupAssignmentView,
  | "assignmentVersion"
  | "groupMinSelections"
  | "groupMaxSelections"
  | "overrides"
  | "effectivePolicy"
  | "options"
>;

export type RepeatChoice = "inherit" | "allow" | "deny";
export type CountChoice = "inherit" | SelectionCountMode;

export type AssignmentPolicyDraft = {
  minSelections: string;
  maxSelections: string;
  repeat: RepeatChoice;
  count: CountChoice;
};

export type AssignmentPolicyPatchBody = {
  expectedProductVersion: number;
  expectedAssignmentVersion: number;
  minSelections: number | null;
  maxSelections: number | null;
  repeatAllowed: boolean | null;
  selectionCountMode: SelectionCountMode | null;
};

export type PolicyRow = {
  key: "minimum" | "maximum" | "repeats" | "counting";
  label: string;
  value: string;
  source: "inherited" | "overridden";
  sourceLabel: string;
  /** The group's own value, shown when this product overrides it. */
  groupValue: string | null;
};

export function assignmentHasOverrides(assignment: Pick<AssignmentPolicyView, "overrides">) {
  return Object.values(assignment.overrides).some((value) => value !== null);
}

export function draftFromAssignment(assignment: AssignmentPolicyView): AssignmentPolicyDraft {
  const { overrides } = assignment;
  return {
    minSelections: overrides.minSelections == null ? "" : String(overrides.minSelections),
    maxSelections: overrides.maxSelections == null ? "" : String(overrides.maxSelections),
    repeat: overrides.repeatAllowed == null ? "inherit" : overrides.repeatAllowed ? "allow" : "deny",
    count: overrides.selectionCountMode ?? "inherit",
  };
}

function parseBound(value: string): number | null | undefined {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^\d+$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

/**
 * The PATCH body for a draft. Blank numbers and "inherit" become explicit
 * nulls so the server clears the override. Returns the invalid field when a
 * bound is not a whole number of 0 or more.
 */
export function policyPatchFromDraft(
  draft: AssignmentPolicyDraft,
  assignment: Pick<AssignmentPolicyView, "assignmentVersion">,
  productVersion: number,
):
  | { ok: true; body: AssignmentPolicyPatchBody }
  | { ok: false; field: "minSelections" | "maxSelections" } {
  const minSelections = parseBound(draft.minSelections);
  if (minSelections === undefined) return { ok: false, field: "minSelections" };
  const maxSelections = parseBound(draft.maxSelections);
  if (maxSelections === undefined) return { ok: false, field: "maxSelections" };

  return {
    ok: true,
    body: {
      expectedProductVersion: productVersion,
      expectedAssignmentVersion: assignment.assignmentVersion,
      minSelections,
      maxSelections,
      repeatAllowed: draft.repeat === "inherit" ? null : draft.repeat === "allow",
      selectionCountMode: draft.count === "inherit" ? null : draft.count,
    },
  };
}

/** Reset to default: every override cleared, so the product follows the group again. */
export function resetPolicyPatch(
  assignment: Pick<AssignmentPolicyView, "assignmentVersion">,
  productVersion: number,
): AssignmentPolicyPatchBody {
  return {
    expectedProductVersion: productVersion,
    expectedAssignmentVersion: assignment.assignmentVersion,
    minSelections: null,
    maxSelections: null,
    repeatAllowed: null,
    selectionCountMode: null,
  };
}

const SOURCE_COPY: Record<PolicyRow["source"], StaffUiCopyKey> = {
  inherited: "modifierPolicyInherited",
  overridden: "modifierPolicyOverridden",
};

function repeatValue(locale: StaffLocale, repeatAllowed: boolean | null) {
  if (repeatAllowed === null) return staffUiCopy(locale, "modifierPolicyRepeatsOptionLimits");
  return staffUiCopy(locale, repeatAllowed ? "modifierPolicyRepeatsAllowed" : "modifierPolicyRepeatsNotAllowed");
}

export function countModeLabel(locale: StaffLocale, mode: SelectionCountMode) {
  return staffUiCopy(locale, mode === "total_quantity" ? "modifierPolicyCountTotal" : "modifierPolicyCountDistinct");
}

/** Effective value, where it comes from, and the group value it replaces. */
export function describeAssignmentPolicy(locale: StaffLocale, assignment: AssignmentPolicyView): PolicyRow[] {
  const policy = assignment.effectivePolicy;
  const row = (
    key: PolicyRow["key"],
    labelKey: StaffUiCopyKey,
    value: string,
    source: PolicyRow["source"],
    groupValue: string,
  ): PolicyRow => ({
    key,
    label: staffUiCopy(locale, labelKey),
    value,
    source,
    sourceLabel: staffUiCopy(locale, SOURCE_COPY[source]),
    groupValue: source === "overridden" ? staffCopyWith(locale, "modifierPolicyGroupValue", { value: groupValue }) : null,
  });

  return [
    row(
      "minimum",
      "modifierPolicyMinimum",
      String(policy.effectiveMinSelections),
      policy.minSelectionsSource,
      String(assignment.groupMinSelections),
    ),
    row(
      "maximum",
      "modifierPolicyMaximum",
      String(policy.effectiveMaxSelections),
      policy.maxSelectionsSource,
      String(assignment.groupMaxSelections),
    ),
    row(
      "repeats",
      "modifierPolicyRepeats",
      repeatValue(locale, assignment.overrides.repeatAllowed),
      policy.repeatSource,
      repeatValue(locale, null),
    ),
    row(
      "counting",
      "modifierPolicyCounting",
      countModeLabel(locale, policy.selectionCountMode),
      policy.selectionCountModeSource,
      countModeLabel(locale, "distinct_options"),
    ),
  ];
}

/** "Cheese: up to 3" for each active option, after this product's repeat rule. */
export function describeOptionCaps(locale: StaffLocale, assignment: AssignmentPolicyView) {
  const names = new Map(
    assignment.options.map((option) => [
      option.publicId,
      option.translations[locale]?.displayName || option.translations.en.displayName || option.publicId,
    ]),
  );
  return assignment.effectivePolicy.options
    .filter((option) => option.status === "active")
    .map((option) =>
      staffCopyWith(locale, "modifierPolicyOptionCap", {
        option: names.get(option.publicId) ?? option.publicId,
        count: option.effectiveMaxQuantity,
      }),
    );
}
