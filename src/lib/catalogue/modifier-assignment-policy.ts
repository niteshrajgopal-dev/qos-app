import {
  assertModifierDefaultsAreFeasible,
  type ModifierGroupRules,
  type ModifierOptionRules,
} from "@/lib/catalogue/modifier-selection";
import { CatalogueValidationError } from "@/lib/catalogue/validation";

/* QOS-212: the only place that turns a reusable modifier group, its option
   hard limits and one product assignment's overrides into the effective
   policy for that product. Pure: no database access.

   - A null override inherits the group (bounds) or the options (repeat).
   - An assignment may only tighten repeats. repeat_allowed = false caps every
     option at one; repeat_allowed = true never raises an option's own
     allows_quantity or max_quantity.
   - Counting stays distinct_options (today's behaviour) unless the
     assignment explicitly says total_quantity. */

export const SELECTION_COUNT_MODES = ["distinct_options", "total_quantity"] as const;

export type SelectionCountMode = (typeof SELECTION_COUNT_MODES)[number];

export const DEFAULT_SELECTION_COUNT_MODE: SelectionCountMode = "distinct_options";

export function isSelectionCountMode(value: unknown): value is SelectionCountMode {
  return (
    typeof value === "string" &&
    (SELECTION_COUNT_MODES as readonly string[]).includes(value)
  );
}

export type ModifierAssignmentOverrides = {
  minSelections: number | null;
  maxSelections: number | null;
  repeatAllowed: boolean | null;
  selectionCountMode: SelectionCountMode | null;
};

export const INHERIT_ALL_OVERRIDES: ModifierAssignmentOverrides = {
  minSelections: null,
  maxSelections: null,
  repeatAllowed: null,
  selectionCountMode: null,
};

export type PolicySource = "inherited" | "overridden";

export type EffectiveModifierOptionPolicy = {
  publicId: string;
  status: ModifierOptionRules["status"];
  /** The option's own hard limits on the shared group. */
  allowsQuantity: boolean;
  maxQuantity: number;
  effectiveAllowsQuantity: boolean;
  effectiveMaxQuantity: number;
  /** True when this option can be chosen more than once on this product. */
  canRepeat: boolean;
};

export type EffectiveModifierAssignmentPolicy = {
  effectiveMinSelections: number;
  effectiveMaxSelections: number;
  selectionCountMode: SelectionCountMode;
  minSelectionsSource: PolicySource;
  maxSelectionsSource: PolicySource;
  repeatSource: PolicySource;
  selectionCountModeSource: PolicySource;
  options: EffectiveModifierOptionPolicy[];
};

export type ModifierAssignmentPolicyErrorCode =
  | "modifier_assignment_invalid_bounds"
  | "modifier_assignment_repeat_conflict"
  | "modifier_assignment_infeasible";

/** A validation failure that needs a reviewed correction, with a stable code. */
export class ModifierAssignmentPolicyError extends CatalogueValidationError {
  readonly code: ModifierAssignmentPolicyErrorCode;

  constructor(message: string, field: string, code: ModifierAssignmentPolicyErrorCode) {
    super(message, field);
    this.name = "ModifierAssignmentPolicyError";
    this.code = code;
  }
}

type GroupBounds = { minSelections: number; maxSelections: number };

export function resolveEffectiveSelectionBounds(
  group: GroupBounds,
  overrides: Pick<ModifierAssignmentOverrides, "minSelections" | "maxSelections">,
) {
  return {
    effectiveMinSelections: overrides.minSelections ?? group.minSelections,
    effectiveMaxSelections: overrides.maxSelections ?? group.maxSelections,
  };
}

function resolveOption(
  option: ModifierOptionRules,
  repeatAllowed: boolean | null,
): EffectiveModifierOptionPolicy {
  const hardMax = option.allowsQuantity ? option.maxQuantity : 1;
  const effectiveAllowsQuantity = repeatAllowed === false ? false : option.allowsQuantity;
  const effectiveMaxQuantity = repeatAllowed === false ? 1 : hardMax;

  return {
    publicId: option.publicId,
    status: option.status,
    allowsQuantity: option.allowsQuantity,
    maxQuantity: option.maxQuantity,
    effectiveAllowsQuantity,
    effectiveMaxQuantity,
    canRepeat: effectiveAllowsQuantity && effectiveMaxQuantity > 1,
  };
}

/** True when the option's own hard limits let it be chosen more than once. */
export function optionCanRepeat(option: ModifierOptionRules) {
  return option.allowsQuantity && option.maxQuantity > 1;
}

export function resolveModifierAssignmentPolicy(
  group: GroupBounds & { options: ModifierOptionRules[] },
  overrides: ModifierAssignmentOverrides,
): EffectiveModifierAssignmentPolicy {
  return {
    ...resolveEffectiveSelectionBounds(group, overrides),
    selectionCountMode: overrides.selectionCountMode ?? DEFAULT_SELECTION_COUNT_MODE,
    minSelectionsSource: overrides.minSelections == null ? "inherited" : "overridden",
    maxSelectionsSource: overrides.maxSelections == null ? "inherited" : "overridden",
    repeatSource: overrides.repeatAllowed == null ? "inherited" : "overridden",
    selectionCountModeSource:
      overrides.selectionCountMode == null ? "inherited" : "overridden",
    options: group.options.map((option) => resolveOption(option, overrides.repeatAllowed)),
  };
}

/**
 * The group rules a product actually enforces: effective bounds, count mode
 * and option caps. Feed these to selection validation and feasibility checks.
 */
export function toEffectiveModifierGroupRules(
  group: ModifierGroupRules,
  overrides: ModifierAssignmentOverrides,
): ModifierGroupRules {
  const policy = resolveModifierAssignmentPolicy(group, overrides);
  const effectiveByPublicId = new Map(policy.options.map((option) => [option.publicId, option]));

  return {
    publicId: group.publicId,
    minSelections: policy.effectiveMinSelections,
    maxSelections: policy.effectiveMaxSelections,
    selectionCountMode: policy.selectionCountMode,
    options: group.options.map((option) => {
      const effective = effectiveByPublicId.get(option.publicId)!;
      return {
        ...option,
        allowsQuantity: effective.effectiveAllowsQuantity,
        maxQuantity: effective.effectiveMaxQuantity,
      };
    }),
  };
}

function assertOptionalBound(value: number | null, field: "minSelections" | "maxSelections") {
  if (value != null && (!Number.isInteger(value) || value < 0)) {
    throw new ModifierAssignmentPolicyError(
      `${field} must be a non-negative integer or null.`,
      field,
      "modifier_assignment_invalid_bounds",
    );
  }
}

/**
 * Validates assignment overrides against the shared group as it is now.
 * `checkRepeatConflict` is for saving the assignment itself: repeat_allowed =
 * true is refused when no active option can repeat, because the assignment
 * cannot raise an option's own cap.
 */
export function assertModifierAssignmentPolicyIsValid(
  group: ModifierGroupRules,
  overrides: ModifierAssignmentOverrides,
  options: { checkRepeatConflict?: boolean } = {},
) {
  assertOptionalBound(overrides.minSelections, "minSelections");
  assertOptionalBound(overrides.maxSelections, "maxSelections");

  const { effectiveMinSelections, effectiveMaxSelections } = resolveEffectiveSelectionBounds(
    group,
    overrides,
  );
  if (effectiveMinSelections > effectiveMaxSelections) {
    throw new ModifierAssignmentPolicyError(
      `Effective minimum (${effectiveMinSelections}) cannot exceed effective maximum (${effectiveMaxSelections}) for this product.`,
      overrides.minSelections != null ? "minSelections" : "maxSelections",
      "modifier_assignment_invalid_bounds",
    );
  }

  if (
    (options.checkRepeatConflict ?? true) &&
    overrides.repeatAllowed === true &&
    !group.options.some((option) => option.status === "active" && optionCanRepeat(option))
  ) {
    throw new ModifierAssignmentPolicyError(
      "Repeats cannot be allowed for this product: no active option in the group allows a quantity above one. Change the option limits on the shared group first.",
      "repeatAllowed",
      "modifier_assignment_repeat_conflict",
    );
  }

  try {
    assertModifierDefaultsAreFeasible(toEffectiveModifierGroupRules(group, overrides));
  } catch (error) {
    if (error instanceof CatalogueValidationError) {
      throw new ModifierAssignmentPolicyError(
        error.message,
        error.field ?? "options",
        "modifier_assignment_infeasible",
      );
    }
    throw error;
  }
}
