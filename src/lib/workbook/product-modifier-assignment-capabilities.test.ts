import { describe, expect, it } from "vitest";

import { contractSheet, isDeferredField } from "@/lib/workbook/contract";
import {
  PRODUCT_MODIFIER_ASSIGNMENT_CAPABILITIES,
  reviewProductModifierAssignmentRow,
} from "@/lib/workbook/product-modifier-assignment-capabilities";

describe("product modifier assignment capability matrix (QOS-200 contract)", () => {
  const columns = new Map(contractSheet("Product Modifiers").columns.map((column) => [column.key, column]));

  it("marks the four policy fields recognised and persistable, mapped exactly as the contract maps them", () => {
    for (const key of ["min_selections", "max_selections", "repeat_allowed", "selection_count_mode"] as const) {
      const capability = PRODUCT_MODIFIER_ASSIGNMENT_CAPABILITIES[key];
      expect(capability, key).toMatchObject({ recognized: true, persistable: true, apply: "QOS-200", blank: "inherit", reviewScope: "assignment" });
      expect(capability.target, key).toBe(columns.get(key)!.mapping);
      expect(isDeferredField(columns.get(key)!), key).toBe(false);
    }
  });

  it("keeps free_options_count unsupported and unscheduled, never labelled with a phase", () => {
    expect(PRODUCT_MODIFIER_ASSIGNMENT_CAPABILITIES.free_options_count).toEqual({
      recognized: true,
      persistable: false,
      target: null,
      apply: "unsupported",
      scheduled: false,
      blank: "ignored",
      reviewScope: "assignment",
    });
    const column = columns.get("free_options_count")!;
    expect(isDeferredField(column)).toBe(true);
    expect(column.phase).toBe("Later review");
    expect(JSON.stringify(column)).not.toMatch(/Phase 3/);
  });

  it("flags unknown counting modes for review and never coerces them", () => {
    expect(reviewProductModifierAssignmentRow({ selection_count_mode: "" })).toEqual([]);
    expect(reviewProductModifierAssignmentRow({})).toEqual([]);
    expect(reviewProductModifierAssignmentRow({ selection_count_mode: "distinct_options" })).toEqual([]);
    expect(reviewProductModifierAssignmentRow({ selection_count_mode: "total_quantity" })).toEqual([]);
    for (const value of ["TOTAL_QUANTITY", "sum", "Foodics", "distinct"]) {
      expect(reviewProductModifierAssignmentRow({ selection_count_mode: value }), value).toEqual([
        { column: "selection_count_mode", code: "ambiguous_selection_count_mode", params: { value } },
      ]);
    }
  });
});
