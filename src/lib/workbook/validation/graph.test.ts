import { describe, expect, it } from "vitest";

import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { emptySnapshot, qosInput, seedRow, snapshotFrom } from "@/lib/workbook/validation/test-support";

const CATEGORY = { category_key: "c1", action: "create", internal_name: "cold", display_name_en: "Cold drinks", display_name_ar: "مشروبات باردة", sort_order: "1", status: "draft" };
const PRODUCT = { product_key: "p1", action: "create", internal_name: "iced-latte", display_name_en: "Iced latte", display_name_ar: "لاتيه مثلج", status: "draft" };
const VARIANT = { variant_key: "v1", action: "create", product_key: "p1", is_default: "TRUE", sort_order: "0", amount_minor: "1600", currency: "AED", status: "draft" };
const LINK = { product_category_key: "p1~c1", action: "create", product_key: "p1", category_key: "c1", sort_order: "1" };

function unverified(sheets: Parameters<typeof qosInput>[0]) {
  return qosInput(sheets, { keysVerified: false, isExport: false });
}

describe("dependency graph", () => {
  it("never invents a missing record: an unknown reference is Invalid and names the referenced sheet", () => {
    const review = reviewWorkbook(unverified({ Variants: [{ ...VARIANT, product_key: "nowhere" }] }), emptySnapshot());
    expect(review.rows[0]).toMatchObject({ classification: "invalid" });
    expect(review.rows[0]!.diagnostics).toContainEqual(
      expect.objectContaining({ code: "unresolved_reference", column: "product_key", params: { refSheet: "Products", key: "nowhere" } }),
    );
  });

  it("blocks dependents of invalid or conflicting rows and points at the responsible row", () => {
    const review = reviewWorkbook(
      unverified({
        Categories: [{ ...CATEGORY, display_name_ar: "" }],
        Products: [{ ...PRODUCT, display_name_en: "Flat White" }],
        "Product Categories": [LINK],
        Variants: [VARIANT],
      }),
      snapshotFrom(),
    );
    const byKey = Object.fromEntries(review.rows.map((row) => [`${row.sheet}:${row.key}`, row]));
    expect(byKey["Categories:c1"]).toMatchObject({ classification: "invalid", dependencies: { blocks: [{ sheet: "Product Categories", row: 7, key: "p1~c1" }] } });
    expect(byKey["Products:p1"]).toMatchObject({ classification: "conflicting" });
    expect(byKey["Products:p1"]!.dependencies.blocks).toHaveLength(2);
    expect(byKey["Product Categories:p1~c1"]).toMatchObject({
      classification: "blocked",
      dependencies: { blockedBy: [{ sheet: "Products", row: 7, key: "p1" }, { sheet: "Categories", row: 7, key: "c1" }] },
    });
    expect(byKey["Product Categories:p1~c1"]!.diagnostics.filter((d) => d.code === "blocked_by_dependency").map((d) => d.responsible)).toEqual([
      { sheet: "Products", row: 7, key: "p1" },
      { sheet: "Categories", row: 7, key: "c1" },
    ]);
    expect(byKey["Variants:v1"]).toMatchObject({ classification: "blocked" });
  });

  it("deferred rows that reference supported rows never block or fail them", () => {
    const review = reviewWorkbook(
      unverified({
        Products: [PRODUCT],
        Variants: [VARIANT],
        Recipes: [{ recipe_version_key: "r1", action: "create", recipe_key: "r", version_number: "1", name: "R", target_type: "SOLD_VARIANT", variant_key: "v1", yield_quantity: "1" }],
        "Recipe Lines": [{ recipe_line_key: "l1", action: "create", recipe_version_key: "r1", ingredient_key: "missing", quantity_recipe_units: "0.2", sort_order: "1" }],
      }),
      emptySnapshot(),
    );
    expect(review.rows.map((row) => [row.sheet, row.classification])).toEqual([
      ["Products", "create"],
      ["Variants", "create"],
      ["Recipes", "unsupported"],
      ["Recipe Lines", "unsupported"],
    ]);
    expect(review.rows[3]!.diagnostics).toContainEqual(expect.objectContaining({ code: "unresolved_reference", severity: "warning" }));
    expect(review.rows[0]!.dependencies.blocks).toEqual([]);
  });

  it("flags duplicate keys on both rows", () => {
    const review = reviewWorkbook(unverified({ Categories: [CATEGORY, { ...CATEGORY, display_name_en: "Other", display_name_ar: "آخر", internal_name: "other" }] }), emptySnapshot());
    expect(review.rows.map((row) => row.classification)).toEqual(["invalid", "invalid"]);
    expect(review.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "duplicate_key", params: { key: "c1", rows: "7, 8" } }));
  });

  it("flags two creates with the same name in one scope as Conflicting", () => {
    const review = reviewWorkbook(unverified({ Categories: [CATEGORY, { ...CATEGORY, category_key: "c2" }] }), emptySnapshot());
    expect(review.rows.map((row) => row.classification)).toEqual(["conflicting", "conflicting"]);
    expect(review.rows[1]!.diagnostics).toContainEqual(expect.objectContaining({ code: "duplicate_name_in_workbook", params: { row: 7, key: "c1" } }));
  });

  it("resolves verified export keys to existing records, but not unverified keys", () => {
    const link = { product_category_key: "x", action: "create", product_key: "prd_flat_white", category_key: "cat_hot", sort_order: "3" };
    const verified = reviewWorkbook(qosInput({ "Product Categories": [link] }), snapshotFrom());
    expect(verified.rows[0]).toMatchObject({ classification: "update", identity: { via: "endpoints" }, changes: [{ column: "sort_order", before: "2", after: "3" }] });
    expect(verified.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "resolved_existing", column: "product_key" }));
    const unverifiedReview = reviewWorkbook(unverified({ "Product Categories": [link] }), snapshotFrom());
    expect(unverifiedReview.rows[0]).toMatchObject({ classification: "invalid" });
  });

  it("tells a branch outside the scope from an unknown branch", () => {
    const scoped = snapshotFrom({ permittedBranches: [{ publicId: "loc_quotes_hbz", name: "HBZ Stadium" }], branchScope: ["loc_quotes_hbz"] });
    const review = reviewWorkbook(
      qosInput({
        "Branch Prices": [
          { branch_price_key: "a", action: "create", variant_key: "var_flat_white_regular", branch_key: "loc_quotes_hct", amount_minor: "2100", currency: "AED" },
          { branch_price_key: "b", action: "create", variant_key: "var_flat_white_regular", branch_key: "loc_nowhere", amount_minor: "2100", currency: "AED" },
          seedRow("Branch Prices", 0, { action: "update", amount_minor: "2000" }),
        ],
      }),
      scoped,
    );
    expect(review.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "branch_not_permitted", params: { branch: "loc_quotes_hct" } }));
    expect(review.rows[1]!.diagnostics).toContainEqual(expect.objectContaining({ code: "unresolved_reference", params: { refSheet: "Branches", key: "loc_nowhere" } }));
    expect(review.rows[2]).toMatchObject({ classification: "update", branch: { publicId: "loc_quotes_hbz", name: "HBZ Stadium" }, changes: [{ column: "amount_minor", before: "1900", after: "2000" }] });
    expect(review.rows.map((row) => row.classification)).toEqual(["invalid", "invalid", "update"]);
  });

  it("an export reviewed untouched proposes nothing", () => {
    const records = snapshotFrom();
    const sheets = Object.fromEntries(
      Object.entries(records.records).map(([sheet, rows]) => [sheet, [...rows.values()]]),
    );
    const review = reviewWorkbook(qosInput(sheets), records);
    expect(review.counts).toMatchObject({ create: 0, update: 0, conflicting: 0, invalid: 0, blocked: 0, skipped: review.counts.rows });
    expect(review.rows.every((row) => row.changes.length === 0)).toBe(true);
  });
});
