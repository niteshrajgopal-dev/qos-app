import { describe, expect, it } from "vitest";

import {
  assertModifierAssignmentPolicyIsValid,
  INHERIT_ALL_OVERRIDES,
  ModifierAssignmentPolicyError,
  resolveModifierAssignmentPolicy,
  toEffectiveModifierGroupRules,
  type ModifierAssignmentOverrides,
} from "@/lib/catalogue/modifier-assignment-policy";
import type { ModifierGroupRules } from "@/lib/catalogue/modifier-selection";

/* One shared Extras group: cheese may repeat up to 3, sauce never repeats,
   and an archived bacon option could repeat but must not count. */
const extras: ModifierGroupRules = {
  publicId: "modgrp_extras",
  minSelections: 0,
  maxSelections: 3,
  options: [
    { publicId: "modopt_cheese", status: "active", isDefault: false, allowsQuantity: true, maxQuantity: 3, priceMinor: 200 },
    { publicId: "modopt_sauce", status: "active", isDefault: false, allowsQuantity: false, maxQuantity: 1, priceMinor: 100 },
    { publicId: "modopt_bacon", status: "archived", isDefault: false, allowsQuantity: true, maxQuantity: 5, priceMinor: 500 },
  ],
};

const noRepeatOptions: ModifierGroupRules = {
  ...extras,
  options: [
    { publicId: "modopt_a", status: "active", isDefault: false, allowsQuantity: false, maxQuantity: 4, priceMinor: 0 },
    { publicId: "modopt_b", status: "active", isDefault: false, allowsQuantity: true, maxQuantity: 1, priceMinor: 0 },
    { publicId: "modopt_c", status: "archived", isDefault: false, allowsQuantity: true, maxQuantity: 9, priceMinor: 0 },
  ],
};

function overrides(partial: Partial<ModifierAssignmentOverrides>): ModifierAssignmentOverrides {
  return { ...INHERIT_ALL_OVERRIDES, ...partial };
}

function policyError(fn: () => void) {
  try {
    fn();
  } catch (error) {
    if (error instanceof ModifierAssignmentPolicyError) return error;
    throw error;
  }
  throw new Error("expected a ModifierAssignmentPolicyError");
}

describe("resolveModifierAssignmentPolicy", () => {
  it("inherits group bounds, option repeat limits and distinct counting when every override is null", () => {
    const policy = resolveModifierAssignmentPolicy(extras, INHERIT_ALL_OVERRIDES);

    expect(policy).toMatchObject({
      effectiveMinSelections: 0,
      effectiveMaxSelections: 3,
      selectionCountMode: "distinct_options",
      minSelectionsSource: "inherited",
      maxSelectionsSource: "inherited",
      repeatSource: "inherited",
      selectionCountModeSource: "inherited",
    });
    expect(policy.options.map((option) => [option.publicId, option.effectiveAllowsQuantity, option.effectiveMaxQuantity, option.canRepeat])).toEqual([
      ["modopt_cheese", true, 3, true],
      ["modopt_sauce", false, 1, false],
      ["modopt_bacon", true, 5, true],
    ]);
  });

  it("applies min/max overrides and marks them overridden without touching the group", () => {
    const policy = resolveModifierAssignmentPolicy(extras, overrides({ minSelections: 1, maxSelections: 2 }));

    expect(policy).toMatchObject({
      effectiveMinSelections: 1,
      effectiveMaxSelections: 2,
      minSelectionsSource: "overridden",
      maxSelectionsSource: "overridden",
      repeatSource: "inherited",
    });
    expect(extras.minSelections).toBe(0);
    expect(extras.maxSelections).toBe(3);
  });

  it("overrides one bound and inherits the other", () => {
    const policy = resolveModifierAssignmentPolicy(extras, overrides({ maxSelections: 1 }));
    expect([policy.effectiveMinSelections, policy.minSelectionsSource]).toEqual([0, "inherited"]);
    expect([policy.effectiveMaxSelections, policy.maxSelectionsSource]).toEqual([1, "overridden"]);
  });

  it("repeat_allowed = false tightens every option to one", () => {
    const policy = resolveModifierAssignmentPolicy(extras, overrides({ repeatAllowed: false }));

    expect(policy.repeatSource).toBe("overridden");
    for (const option of policy.options) {
      expect(option.effectiveAllowsQuantity, option.publicId).toBe(false);
      expect(option.effectiveMaxQuantity, option.publicId).toBe(1);
      expect(option.canRepeat, option.publicId).toBe(false);
    }
    // The shared option limits are reported unchanged next to the effective ones.
    expect(policy.options[0]).toMatchObject({ allowsQuantity: true, maxQuantity: 3 });
  });

  it("repeat_allowed = true never raises an option's own allows_quantity or max_quantity", () => {
    const policy = resolveModifierAssignmentPolicy(extras, overrides({ repeatAllowed: true }));

    expect(policy.repeatSource).toBe("overridden");
    expect(policy.options.find((option) => option.publicId === "modopt_cheese")).toMatchObject({
      effectiveAllowsQuantity: true,
      effectiveMaxQuantity: 3,
    });
    expect(policy.options.find((option) => option.publicId === "modopt_sauce")).toMatchObject({
      effectiveAllowsQuantity: false,
      effectiveMaxQuantity: 1,
      canRepeat: false,
    });
  });

  it("uses total_quantity only when explicitly set", () => {
    expect(resolveModifierAssignmentPolicy(extras, overrides({ selectionCountMode: null })).selectionCountMode).toBe(
      "distinct_options",
    );
    const explicit = resolveModifierAssignmentPolicy(extras, overrides({ selectionCountMode: "total_quantity" }));
    expect([explicit.selectionCountMode, explicit.selectionCountModeSource]).toEqual(["total_quantity", "overridden"]);
  });
});

describe("toEffectiveModifierGroupRules", () => {
  it("returns the group unchanged apart from an explicit distinct count when nothing is overridden", () => {
    expect(toEffectiveModifierGroupRules(extras, INHERIT_ALL_OVERRIDES)).toEqual({
      ...extras,
      selectionCountMode: "distinct_options",
    });
  });

  it("carries the tightened caps, bounds and count mode", () => {
    const rules = toEffectiveModifierGroupRules(
      extras,
      overrides({ minSelections: 1, maxSelections: 2, repeatAllowed: false, selectionCountMode: "total_quantity" }),
    );
    expect(rules).toMatchObject({ minSelections: 1, maxSelections: 2, selectionCountMode: "total_quantity" });
    expect(rules.options.map((option) => [option.allowsQuantity, option.maxQuantity])).toEqual([
      [false, 1],
      [false, 1],
      [false, 1],
    ]);
  });
});

describe("assertModifierAssignmentPolicyIsValid", () => {
  it("accepts inherited and valid overridden policies", () => {
    expect(() => assertModifierAssignmentPolicyIsValid(extras, INHERIT_ALL_OVERRIDES)).not.toThrow();
    expect(() =>
      assertModifierAssignmentPolicyIsValid(extras, overrides({ minSelections: 1, maxSelections: 2, repeatAllowed: true })),
    ).not.toThrow();
  });

  it("rejects negative or fractional bounds", () => {
    expect(policyError(() => assertModifierAssignmentPolicyIsValid(extras, overrides({ minSelections: -1 })))).toMatchObject({
      code: "modifier_assignment_invalid_bounds",
      field: "minSelections",
    });
    expect(policyError(() => assertModifierAssignmentPolicyIsValid(extras, overrides({ maxSelections: 1.5 })))).toMatchObject({
      code: "modifier_assignment_invalid_bounds",
      field: "maxSelections",
    });
  });

  it("rejects an effective minimum above the effective maximum, including one inherited from the group", () => {
    expect(
      policyError(() => assertModifierAssignmentPolicyIsValid(extras, overrides({ minSelections: 3, maxSelections: 2 }))),
    ).toMatchObject({ code: "modifier_assignment_invalid_bounds" });

    const groupMinTwo = { ...extras, minSelections: 2 };
    expect(
      policyError(() => assertModifierAssignmentPolicyIsValid(groupMinTwo, overrides({ maxSelections: 1 }))),
    ).toMatchObject({ code: "modifier_assignment_invalid_bounds", field: "maxSelections" });
  });

  it("refuses repeat_allowed = true when no active option can repeat (archived options do not count)", () => {
    const error = policyError(() =>
      assertModifierAssignmentPolicyIsValid(noRepeatOptions, overrides({ repeatAllowed: true })),
    );
    expect(error).toMatchObject({ code: "modifier_assignment_repeat_conflict", field: "repeatAllowed" });

    // The same group may still tighten or inherit.
    expect(() => assertModifierAssignmentPolicyIsValid(noRepeatOptions, overrides({ repeatAllowed: false }))).not.toThrow();
    expect(() => assertModifierAssignmentPolicyIsValid(noRepeatOptions, INHERIT_ALL_OVERRIDES)).not.toThrow();
    // Group-side re-checks skip the repeat conflict: repeats can never be raised.
    expect(() =>
      assertModifierAssignmentPolicyIsValid(noRepeatOptions, overrides({ repeatAllowed: true }), { checkRepeatConflict: false }),
    ).not.toThrow();
  });

  it("checks default and active-option feasibility against the effective rules", () => {
    const withDefaults: ModifierGroupRules = {
      ...extras,
      options: extras.options.map((option) => ({ ...option, isDefault: option.status === "active" })),
    };
    // Two defaults fit the group's max of 3, but not a product max of 1.
    expect(() => assertModifierAssignmentPolicyIsValid(withDefaults, INHERIT_ALL_OVERRIDES)).not.toThrow();
    expect(
      policyError(() => assertModifierAssignmentPolicyIsValid(withDefaults, overrides({ maxSelections: 1 }))),
    ).toMatchObject({ code: "modifier_assignment_infeasible", field: "options" });

    // Two active options cannot satisfy a distinct minimum of 3 ...
    expect(
      policyError(() => assertModifierAssignmentPolicyIsValid(extras, overrides({ minSelections: 3 }))),
    ).toMatchObject({ code: "modifier_assignment_infeasible" });
    // ... but cheese x3 + sauce x1 can when quantities are explicitly summed.
    expect(() =>
      assertModifierAssignmentPolicyIsValid(extras, overrides({ minSelections: 3, selectionCountMode: "total_quantity" })),
    ).not.toThrow();
    // Tightening repeats removes that capacity again.
    expect(
      policyError(() =>
        assertModifierAssignmentPolicyIsValid(
          extras,
          overrides({ minSelections: 3, selectionCountMode: "total_quantity", repeatAllowed: false }),
        ),
      ),
    ).toMatchObject({ code: "modifier_assignment_infeasible" });
  });
});
