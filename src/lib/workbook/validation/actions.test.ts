import { describe, expect, it } from "vitest";

import { SUPPORTED_ENTITY_SHEETS } from "@/lib/workbook/contract";
import { ACTION_MATRIX, resolveAction } from "@/lib/workbook/validation/actions";
import type { ReviewRow } from "@/lib/workbook/validation/model";
import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { emptySnapshot, qosInput, seedRow, snapshotFrom } from "@/lib/workbook/validation/test-support";

function rowsOf(sheet: string, rows: ReviewRow[]) {
  return rows.filter((row) => row.sheet === sheet);
}

describe("action matrix", () => {
  it("offers only actions a QOS service exists for", () => {
    expect(resolveAction("Categories", "archive")).toMatchObject({ kind: "operation", operation: "archive" });
    expect(resolveAction("Product Categories", "remove_link")).toMatchObject({ kind: "operation", operation: "remove_link" });
    expect(resolveAction("Branch Prices", "reset_to_central")).toMatchObject({ kind: "operation", operation: "reset_to_central" });
    expect(resolveAction("Branches", "create")).toMatchObject({ kind: "unsupported" });
    expect(resolveAction("Branches", "update")).toMatchObject({ kind: "unsupported" });
    expect(resolveAction("Branches", "skip")).toMatchObject({ kind: "operation", operation: "skip" });
    expect(resolveAction("Products", "remove_link")).toMatchObject({ kind: "invalid", code: "action_not_allowed_for_sheet" });
    expect(resolveAction("Variants", "reset_to_central")).toMatchObject({ kind: "invalid", code: "action_not_allowed_for_sheet" });
    expect(resolveAction("Products", "delete")).toMatchObject({ kind: "invalid", code: "action_unknown" });
    expect(resolveAction("Products", "")).toMatchObject({ kind: "invalid", code: "action_required" });
    expect(resolveAction("Products", "Update")).toMatchObject({ kind: "operation", operation: "update", normalized: true });
    for (const sheet of SUPPORTED_ENTITY_SHEETS) {
      expect(ACTION_MATRIX[sheet].skip, sheet).toEqual({ operation: "skip" });
    }
  });

  it("classifies Branch create and update as unsupported with the owner, and deferred or rejected sheets as unsupported", () => {
    const review = reviewWorkbook(
      qosInput({
        Branches: [seedRow("Branches", 0, { action: "update", name: "Renamed" })],
        Units: [{ unit_key: "u1", action: "create", name: "kg", quantity_kind: "MASS", decimal_places: "3", active: "TRUE" }],
        "Future Combos": [{ combo_key: "c1", action: "create", name: "Combo" }],
      }),
      snapshotFrom(),
    );
    const [branch] = rowsOf("Branches", review.rows);
    expect(branch).toMatchObject({ classification: "unsupported", operation: null });
    expect(branch!.diagnostics).toContainEqual(expect.objectContaining({ code: "action_unsupported", params: expect.objectContaining({ reason: "unsupported_action" }) }));
    expect(rowsOf("Units", review.rows)[0]).toMatchObject({ classification: "unsupported" });
    expect(rowsOf("Future Combos", review.rows)[0]!.diagnostics).toContainEqual(
      expect.objectContaining({ code: "action_unsupported", params: expect.objectContaining({ owner: expect.stringContaining("Phase 3") }) }),
    );
  });

  it("refuses create with a QOS id, a missing action and an action foreign to the sheet", () => {
    const review = reviewWorkbook(
      qosInput({
        Categories: [
          { category_key: "c1", qos_category_id: "cat_hot", action: "create", internal_name: "x", display_name_en: "X", display_name_ar: "س", sort_order: "1", status: "draft" },
          { category_key: "c2", action: "", internal_name: "y", display_name_en: "Y", display_name_ar: "ص", sort_order: "1", status: "draft" },
          { category_key: "c3", action: "reset_to_central", internal_name: "z", display_name_en: "Z", display_name_ar: "ز", sort_order: "1", status: "draft" },
        ],
      }),
      snapshotFrom(),
    );
    expect(review.rows.map((row) => [row.classification, row.diagnostics.find((d) => d.severity === "error")?.code])).toEqual([
      ["invalid", "create_with_id"],
      ["invalid", "action_required"],
      ["invalid", "action_not_allowed_for_sheet"],
    ]);
  });

  it("keeps blank, zero and FALSE as typed: zero is a real price, blank on update keeps the value", () => {
    const review = reviewWorkbook(
      qosInput({
        Variants: [seedRow("Variants", 0, { action: "update", amount_minor: "0", sku: "", barcode: "" })],
      }),
      snapshotFrom(),
    );
    const [variant] = review.rows;
    expect(variant!.classification).toBe("update");
    expect(variant!.changes).toEqual([{ column: "amount_minor", before: "1800", after: "0" }]);
  });

  it("omitted rows do nothing: an empty workbook proposes nothing and never a deletion", () => {
    const review = reviewWorkbook(qosInput({}), snapshotFrom());
    expect(review.counts.rows).toBe(0);
    expect(review.rows).toEqual([]);
  });

  it("archive needs a verified target and refuses the default variant", () => {
    const review = reviewWorkbook(
      qosInput({
        Categories: [seedRow("Categories", 0, { action: "archive" })],
        Variants: [seedRow("Variants", 0, { action: "archive" })],
        Products: [{ product_key: "new", action: "archive", internal_name: "n", display_name_en: "Nothing", display_name_ar: "لا شيء", status: "draft" }],
      }),
      snapshotFrom(),
    );
    expect(rowsOf("Categories", review.rows)[0]).toMatchObject({ classification: "update", operation: "archive", changes: [{ column: "status", before: "active", after: "archived" }] });
    expect(rowsOf("Variants", review.rows)[0]).toMatchObject({ classification: "invalid" });
    expect(rowsOf("Variants", review.rows)[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "default_variant_archive" }));
    expect(rowsOf("Products", review.rows)[0]).toMatchObject({ classification: "invalid" });
    expect(rowsOf("Products", review.rows)[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "update_requires_id" }));
  });

  it("restores an archived product when its status returns to draft; the category service refuses draft", () => {
    const snapshot = snapshotFrom({
      records: {
        Products: [seedRow("Products", 0, { status: "archived" })],
        Categories: [seedRow("Categories", 0, { status: "archived" })],
      },
    });
    const review = reviewWorkbook(
      qosInput({
        Products: [seedRow("Products", 0, { action: "update", status: "draft", expected_revision: "" })],
        Categories: [seedRow("Categories", 0, { action: "update", status: "draft", expected_revision: "" })],
      }),
      snapshot,
    );
    expect(rowsOf("Products", review.rows)[0]).toMatchObject({ classification: "update", operation: "restore" });
    expect(rowsOf("Categories", review.rows)[0]).toMatchObject({ classification: "invalid" });
    expect(rowsOf("Categories", review.rows)[0]!.diagnostics).toContainEqual(
      expect.objectContaining({ code: "service_validation", params: expect.objectContaining({ field: "status" }) }),
    );
  });

  it("resets a branch price only where an override exists, and removes links by verified endpoints", () => {
    const review = reviewWorkbook(
      qosInput({
        "Branch Prices": [
          seedRow("Branch Prices", 0, { action: "reset_to_central" }),
          { branch_price_key: "x", action: "reset_to_central", variant_key: "var_flat_white_regular", branch_key: "loc_quotes_hct", amount_minor: "0", currency: "AED" },
        ],
        "Product Categories": [{ product_category_key: "pc", action: "remove_link", product_key: "prd_flat_white", category_key: "cat_hot", sort_order: "2" }],
      }),
      snapshotFrom(),
    );
    expect(rowsOf("Branch Prices", review.rows).map((row) => [row.classification, row.operation])).toEqual([
      ["update", "reset_to_central"],
      ["invalid", null],
    ]);
    expect(rowsOf("Branch Prices", review.rows)[1]!.diagnostics).toContainEqual(expect.objectContaining({ code: "reset_without_override" }));
    expect(rowsOf("Product Categories", review.rows)[0]).toMatchObject({
      classification: "update",
      operation: "remove_link",
      identity: { via: "endpoints", targetPublicId: "00000000-0000-4000-8000-0000000000a1" },
    });
  });

  it("does not apply anything for deferred columns: they are kept, never changes", () => {
    const review = reviewWorkbook(
      qosInput({ Variants: [seedRow("Variants", 0, { action: "update", price_tax_basis: "GROSS", tax_rate_basis_points: "500" })] }),
      snapshotFrom(),
    );
    expect(review.rows[0]).toMatchObject({ classification: "unchanged", changes: [] });
    expect(review.rows[0]!.deferredFields.map((field) => field.column)).toEqual(["price_tax_basis", "tax_rate_basis_points"]);
    expect(review.counts.deferredValues).toBe(2);
  });

  it("an empty snapshot and a skip row without id anchors nothing", () => {
    const review = reviewWorkbook(
      qosInput(
        {
          Products: [{ product_key: "p", action: "skip", internal_name: "p", display_name_en: "P", display_name_ar: "ب", status: "draft" }],
          Variants: [{ variant_key: "v", action: "create", product_key: "p", is_default: "TRUE", sort_order: "0", amount_minor: "100", currency: "AED", status: "draft" }],
        },
        { keysVerified: false, isExport: false },
      ),
      emptySnapshot(),
    );
    expect(review.rows.map((row) => row.classification)).toEqual(["skipped", "blocked"]);
  });
});
