import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  INHERIT_ALL_OVERRIDES,
  resolveModifierAssignmentPolicy,
  type ModifierAssignmentOverrides,
} from "@/lib/catalogue/modifier-assignment-policy";
import {
  assignmentHasOverrides,
  describeAssignmentPolicy,
  describeOptionCaps,
  draftFromAssignment,
  policyPatchFromDraft,
  resetPolicyPatch,
  type AssignmentPolicyView,
} from "@/lib/catalogue/modifier-assignment-policy-ui";
import { STAFF_UI_COPY } from "@/lib/staff/locale";

const options: AssignmentPolicyView["options"] = [
  {
    publicId: "modopt_cheese",
    sortOrder: 0,
    isDefault: false,
    allowsQuantity: true,
    maxQuantity: 3,
    status: "active",
    priceMinor: 200,
    nutritionCalories: null,
    referenceCost: { policy: null, resolution: { status: "unavailable" as const, reason: "no_policy" as const } },
    currency: "AED",
    translations: { en: { displayName: "Cheese" }, ar: { displayName: "جبن" } },
  },
  {
    publicId: "modopt_sauce",
    sortOrder: 1,
    isDefault: false,
    allowsQuantity: false,
    maxQuantity: 1,
    status: "active",
    priceMinor: 150,
    nutritionCalories: null,
    referenceCost: { policy: null, resolution: { status: "unavailable" as const, reason: "no_policy" as const } },
    currency: "AED",
    translations: { en: { displayName: "Sauce" }, ar: { displayName: "" } },
  },
  {
    publicId: "modopt_old",
    sortOrder: 2,
    isDefault: false,
    allowsQuantity: true,
    maxQuantity: 9,
    status: "archived",
    priceMinor: 0,
    nutritionCalories: null,
    referenceCost: { policy: null, resolution: { status: "unavailable" as const, reason: "no_policy" as const } },
    currency: "AED",
    translations: { en: { displayName: "Old" }, ar: { displayName: "قديم" } },
  },
];

function assignment(overrides: Partial<ModifierAssignmentOverrides> = {}): AssignmentPolicyView {
  const merged = { ...INHERIT_ALL_OVERRIDES, ...overrides };
  return {
    assignmentVersion: 4,
    groupMinSelections: 0,
    groupMaxSelections: 2,
    overrides: merged,
    effectivePolicy: resolveModifierAssignmentPolicy({ minSelections: 0, maxSelections: 2, options }, merged),
    options,
  };
}

const POLICY_KEYS = Object.keys(STAFF_UI_COPY.en).filter((key) => key.startsWith("modifierPolicy"));

describe("product modifier policy editor copy", () => {
  it("has English and Arabic text for every policy key, in sentence case", () => {
    expect(POLICY_KEYS.length).toBeGreaterThanOrEqual(20);
    for (const key of POLICY_KEYS) {
      const en = STAFF_UI_COPY.en[key as keyof typeof STAFF_UI_COPY.en];
      const ar = STAFF_UI_COPY.ar[key as keyof typeof STAFF_UI_COPY.ar];
      expect(en, key).toBeTruthy();
      expect(ar, key).toMatch(/[؀-ۿ]/);
      expect(en, key).not.toMatch(/\b[A-Z]{3,}\b/);
      // Sentence case: no capitalised word after the first.
      expect(en.split(" ").slice(1).filter((word) => /^[A-Z][a-z]/.test(word)), key).toEqual([]);
    }
  });

  it("describes inherited policy in English and Arabic without group comparisons", () => {
    const rows = describeAssignmentPolicy("en", assignment());
    expect(rows.map((row) => [row.label, row.value, row.sourceLabel, row.groupValue])).toEqual([
      ["Minimum choices", "0", "Group default", null],
      ["Maximum choices", "2", "Group default", null],
      ["Repeated options", "Each option's own limit", "Group default", null],
      ["Counting", "Each option counts once", "Group default", null],
    ]);

    const arabic = describeAssignmentPolicy("ar", assignment());
    expect(arabic.map((row) => [row.label, row.sourceLabel])).toEqual([
      ["الحد الأدنى للاختيارات", "القيمة الافتراضية للمجموعة"],
      ["الحد الأقصى للاختيارات", "القيمة الافتراضية للمجموعة"],
      ["تكرار الخيارات", "القيمة الافتراضية للمجموعة"],
      ["طريقة العدّ", "القيمة الافتراضية للمجموعة"],
    ]);
  });

  it("shows overridden values next to the group value they replace", () => {
    const rows = describeAssignmentPolicy(
      "en",
      assignment({ minSelections: 1, maxSelections: 1, repeatAllowed: false, selectionCountMode: "total_quantity" }),
    );
    expect(rows.map((row) => [row.value, row.sourceLabel, row.groupValue])).toEqual([
      ["1", "Product override", "Group: 0"],
      ["1", "Product override", "Group: 2"],
      ["Not allowed", "Product override", "Group: Each option's own limit"],
      ["Total quantity", "Product override", "Group: Each option counts once"],
    ]);
    expect(describeAssignmentPolicy("ar", assignment({ maxSelections: 3 }))[1]).toMatchObject({
      value: "3",
      sourceLabel: "مخصّصة لهذا المنتج",
      groupValue: "المجموعة: 2",
    });
  });

  it("lists effective caps for active options only, falling back to English names", () => {
    expect(describeOptionCaps("en", assignment())).toEqual(["Cheese: up to 3", "Sauce: up to 1"]);
    expect(describeOptionCaps("en", assignment({ repeatAllowed: false }))).toEqual(["Cheese: up to 1", "Sauce: up to 1"]);
    expect(describeOptionCaps("ar", assignment())).toEqual(["جبن: حتى 3", "Sauce: حتى 1"]);
  });
});

describe("product modifier policy editor requests", () => {
  it("round-trips the current overrides into the form", () => {
    expect(draftFromAssignment(assignment())).toEqual({ minSelections: "", maxSelections: "", repeat: "inherit", count: "inherit" });
    expect(
      draftFromAssignment(assignment({ minSelections: 0, maxSelections: 3, repeatAllowed: true, selectionCountMode: "distinct_options" })),
    ).toEqual({ minSelections: "0", maxSelections: "3", repeat: "allow", count: "distinct_options" });
  });

  it("sends explicit nulls for blank or inherit fields and carries both versions", () => {
    const result = policyPatchFromDraft(
      { minSelections: " ", maxSelections: "3", repeat: "deny", count: "inherit" },
      assignment(),
      12,
    );
    expect(result).toEqual({
      ok: true,
      body: {
        expectedProductVersion: 12,
        expectedAssignmentVersion: 4,
        minSelections: null,
        maxSelections: 3,
        repeatAllowed: false,
        selectionCountMode: null,
      },
    });
  });

  it("refuses non-integer bounds before sending", () => {
    expect(policyPatchFromDraft({ minSelections: "-1", maxSelections: "", repeat: "inherit", count: "inherit" }, assignment(), 1)).toEqual({
      ok: false,
      field: "minSelections",
    });
    expect(policyPatchFromDraft({ minSelections: "", maxSelections: "1.5", repeat: "inherit", count: "inherit" }, assignment(), 1)).toEqual({
      ok: false,
      field: "maxSelections",
    });
  });

  it("resets every override to the group default and only offers reset when something is overridden", () => {
    expect(resetPolicyPatch(assignment({ maxSelections: 1 }), 7)).toEqual({
      expectedProductVersion: 7,
      expectedAssignmentVersion: 4,
      minSelections: null,
      maxSelections: null,
      repeatAllowed: null,
      selectionCountMode: null,
    });
    expect(assignmentHasOverrides(assignment())).toBe(false);
    expect(assignmentHasOverrides(assignment({ repeatAllowed: false }))).toBe(true);
  });

  it("is wired into the existing product modifier panel, not a new page", () => {
    const panel = readFileSync(
      path.join(process.cwd(), "src/app/tenants/[tenantId]/catalogue/products/product-modifier-groups-panel.tsx"),
      "utf8",
    );
    expect(panel).toContain("<ProductModifierAssignmentPolicyEditor");
    expect(panel).toContain('method: "PATCH"');
    const editor = readFileSync(
      path.join(process.cwd(), "src/app/tenants/[tenantId]/catalogue/products/product-modifier-assignment-policy-editor.tsx"),
      "utf8",
    );
    expect(editor).toContain("resetPolicyPatch(");
    expect(editor).toContain('copy("modifierPolicyReset")');
  });
});
