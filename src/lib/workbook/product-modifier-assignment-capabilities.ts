import { isSelectionCountMode } from "@/lib/catalogue/modifier-assignment-policy";

/* QOS-212 handler capability matrix for the Product Modifiers sheet, read by
   QOS-194 (review) and QOS-200 (apply). It states what QOS can do with each
   assignment-policy field today; it does not apply anything itself.

   - recognized: the reader parses the column and keeps the value.
   - persistable: a domain service can store it (updateProductModifierGroupPolicy).
   - apply: who writes it from a workbook. QOS-200 owns apply.
   - Review issues are row-scoped: a bad value blocks that assignment only. */

export type ProductModifierAssignmentField =
  | "min_selections"
  | "max_selections"
  | "repeat_allowed"
  | "selection_count_mode"
  | "free_options_count";

export type WorkbookFieldCapability = {
  recognized: boolean;
  persistable: boolean;
  /** Domain column the value maps to, when there is one. */
  target: string | null;
  apply: "QOS-200" | "unsupported";
  /** Unscheduled fields have no delivery plan; they are never labelled with a future phase. */
  scheduled: boolean;
  /** Blank cell meaning. */
  blank: "inherit" | "ignored";
  reviewScope: "assignment";
};

export const PRODUCT_MODIFIER_ASSIGNMENT_CAPABILITIES: Record<
  ProductModifierAssignmentField,
  WorkbookFieldCapability
> = {
  min_selections: {
    recognized: true,
    persistable: true,
    target: "catalogue_product_modifier_groups.min_selections",
    apply: "QOS-200",
    scheduled: true,
    blank: "inherit",
    reviewScope: "assignment",
  },
  max_selections: {
    recognized: true,
    persistable: true,
    target: "catalogue_product_modifier_groups.max_selections",
    apply: "QOS-200",
    scheduled: true,
    blank: "inherit",
    reviewScope: "assignment",
  },
  repeat_allowed: {
    recognized: true,
    persistable: true,
    target: "catalogue_product_modifier_groups.repeat_allowed",
    apply: "QOS-200",
    scheduled: true,
    blank: "inherit",
    reviewScope: "assignment",
  },
  selection_count_mode: {
    recognized: true,
    persistable: true,
    target: "catalogue_product_modifier_groups.selection_count_mode",
    apply: "QOS-200",
    scheduled: true,
    blank: "inherit",
    reviewScope: "assignment",
  },
  // Free-option allowances need a pricing design that does not exist; populated
  // cells are reported as deferred_field by the reader and never imported.
  free_options_count: {
    recognized: true,
    persistable: false,
    target: null,
    apply: "unsupported",
    scheduled: false,
    blank: "ignored",
    reviewScope: "assignment",
  },
};

export type ProductModifierAssignmentReviewIssue = {
  column: ProductModifierAssignmentField;
  code: "ambiguous_selection_count_mode";
  params: { value: string };
};

/**
 * Row-level review of one Product Modifiers row. A counting mode other than
 * blank, distinct_options or total_quantity is ambiguous: it is reported for
 * review and never coerced to either mode.
 */
export function reviewProductModifierAssignmentRow(
  values: Record<string, string>,
): ProductModifierAssignmentReviewIssue[] {
  const issues: ProductModifierAssignmentReviewIssue[] = [];
  const mode = values.selection_count_mode?.trim() ?? "";
  if (mode && !isSelectionCountMode(mode)) {
    issues.push({ column: "selection_count_mode", code: "ambiguous_selection_count_mode", params: { value: mode } });
  }
  return issues;
}
