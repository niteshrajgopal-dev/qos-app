import { describe, expect, it } from "vitest";

import { buildFoodicsMenuFixture, FIXTURE_SHEETS } from "@/lib/workbook/foodics-menu/fixture";
import { parseWorkbookUpload } from "@/lib/workbook/reader";
import { toReviewInput } from "@/lib/workbook/validation/input";
import type { ReviewRow } from "@/lib/workbook/validation/model";
import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { BRAND, emptySnapshot, snapshotFrom, TENANT } from "@/lib/workbook/validation/test-support";

/* The sanitized Foodics fixture (#93) reviewed through the one engine: the
   in-memory canonical rows, unverified name-derived keys, deferred values
   with owners, tax kept with its source text, and no silent duplicates
   against a tenant that already has the same product. */

async function foodicsInput() {
  const bytes = await buildFoodicsMenuFixture({
    filled: true,
    prefillLastRow: 60,
    sentinel: "SENTINEL-NEVER-READ",
    edit: (workbook) => {
      // The original workbook stores tax as a fraction: 0.05 is 5%.
      workbook.getWorksheet(FIXTURE_SHEETS.products)!.getCell("P11").value = 0.05;
    },
  });
  const parsed = await parseWorkbookUpload(
    { fileName: "menu.xlsx", bytes },
    { tenantPublicId: TENANT, brandPublicIds: [BRAND], tenantCurrency: "AED", brandPublicId: BRAND, brandChoices: [{ publicId: BRAND, name: "Quotes" }] },
  );
  return toReviewInput(parsed, { tenantPublicId: TENANT, brandPublicId: BRAND, currency: "AED" });
}

function bySheet(rows: ReviewRow[]) {
  const map: Record<string, string[]> = {};
  for (const row of rows) (map[row.sheet] ??= []).push(row.classification);
  return map;
}

describe("Foodics menu review", () => {
  it("reviews the canonical rows against an empty catalogue with unverified keys and deferred values", async () => {
    const input = await foodicsInput();
    expect(input).toMatchObject({ profile: "foodics_menu_v1", keysVerified: false, sourceNamespace: `foodics-menu-v1:${TENANT}` });
    const review = reviewWorkbook(input, emptySnapshot());

    // Arabic-only source rows have no English name, which QOS requires on create.
    expect(bySheet(review.rows)).toEqual({
      Categories: ["create", "invalid"],
      Products: ["create", "create", "invalid"],
      "Product Categories": ["create", "create", "blocked"],
      Variants: ["create", "create", "blocked"],
      "Modifier Groups": ["create"],
      "Modifier Options": ["create", "create"],
      "Product Modifiers": ["create", "create"],
      Units: Array(4).fill("unsupported"),
      "Inventory Categories": Array(3).fill("unsupported"),
      Ingredients: Array(3).fill("unsupported"),
      Recipes: Array(3).fill("unsupported"),
      "Recipe Lines": Array(4).fill("unsupported"),
      "Modifier Effects": ["unsupported"],
    });
    const karak = review.rows.find((row) => row.sheet === "Products" && row.label.ar === "كرك")!;
    expect(karak.diagnostics).toContainEqual(expect.objectContaining({ code: "required_missing", column: "display_name_en" }));

    const variants = review.rows.filter((row) => row.sheet === "Variants");
    const tax = (row: ReviewRow) => row.deferredFields.find((field) => field.column === "tax_rate_basis_points");
    expect(tax(variants[0]!)).toMatchObject({ value: "500", owner: expect.stringContaining("QOS-212"), display: { sourceText: "0.05", basisPoints: 500, percentDisplay: "5%" } });
    expect(tax(variants[1]!)).toMatchObject({ display: { sourceText: "5%", basisPoints: 500, percentDisplay: "5%" } });
    // Tax and price basis are never proposed as changes.
    expect(variants[0]!.changes.map((change) => change.column)).not.toContain("tax_rate_basis_points");
    expect(variants[0]!.changes).toContainEqual({ column: "amount_minor", before: null, after: "1250", cell: "Products!K11" });

    const flatWhite = review.rows.find((row) => row.sheet === "Products" && row.key.startsWith("prd~flat-white"))!;
    expect(flatWhite.identity).toMatchObject({ keyVerified: false, namespace: `foodics-menu-v1:${TENANT}` });
    expect(flatWhite.deferredFields.map((field) => field.column)).toEqual(
      expect.arrayContaining(["channel_price:dine in", "channel_price:delivery", "product_cost", "selling_method"]),
    );
    expect(flatWhite.source?.range).toBe("Products!D11:V11");
    expect(review.counts.deferredValues).toBeGreaterThan(0);
    expect(review.acknowledgements.required.map((entry) => entry.kind)).toEqual(expect.arrayContaining(["acknowledge_deferred", "acknowledge_partial_apply"]));
    expect(review.context.ignoredSheets).toContainEqual({ sheet: "Users", reason: "credentials" });

    const serialized = JSON.stringify(review);
    expect(serialized).not.toContain("SENTINEL-NEVER-READ");
    expect(review.fieldDecisions.some((field) => (field as { decision: string }).decision === "persistable")).toBe(false);
  });

  it("reimporting against a tenant that already has Flat White is Conflicting, never a silent Create or Update", async () => {
    const input = await foodicsInput();
    const first = reviewWorkbook(input, snapshotFrom());
    const product = first.rows.find((row) => row.sheet === "Products" && row.key.startsWith("prd~flat-white"))!;
    expect(product).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "prd_flat_white" })] });
    const category = first.rows.find((row) => row.sheet === "Categories" && row.label.en === "Hot drinks")!;
    expect(category).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "cat_hot" })] });
    const variant = first.rows.find((row) => row.sheet === "Variants" && row.key.startsWith("prd~flat-white"))!;
    expect(variant).toMatchObject({ classification: "blocked", dependencies: { blockedBy: [{ sheet: "Products", row: product.row, key: product.key }] } });
    // The Oat milk option belongs to a new group, so it does not collide with the existing Milk group's option.
    expect(first.rows.filter((row) => row.sheet === "Modifier Options").map((row) => row.classification)).toEqual(["create", "create"]);

    const second = reviewWorkbook(input, snapshotFrom());
    expect(second.rows.map((row) => row.classification)).toEqual(first.rows.map((row) => row.classification));
    expect(first.rows.filter((row) => row.sheet === "Products" && row.classification === "create").map((row) => row.label.en)).toEqual(["Vanilla Latte"]);

    const matched = reviewWorkbook(input, snapshotFrom(), [{ kind: "match_existing", sheet: "Products", row: product.row, targetPublicId: "prd_flat_white" }]);
    const updated = matched.rows.find((row) => row.key === product.key && row.sheet === "Products")!;
    expect(updated).toMatchObject({ classification: "update", identity: { via: "decision", targetPublicId: "prd_flat_white" } });
    const changed = updated.changes.map((change) => change.column);
    expect(changed).toEqual(expect.arrayContaining(["description_en", "description_ar", "nutrition_calories", "image_url"]));
    // Conversion defaults (status draft) never overwrite the existing record; names, sku and barcode are equal.
    expect(changed).not.toContain("status");
    expect(changed).not.toContain("display_name_en");
    expect(changed).not.toContain("sku");

    const matchedVariant = matched.rows.find((row) => row.sheet === "Variants" && row.key === variant.key)!;
    expect(matchedVariant).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "var_flat_white_regular" })] });
    expect(matchedVariant.diagnostics).toContainEqual(expect.objectContaining({ code: "default_variant_conflict" }));

    const both = reviewWorkbook(input, snapshotFrom(), [
      { kind: "match_existing", sheet: "Products", row: product.row, targetPublicId: "prd_flat_white" },
      { kind: "match_existing", sheet: "Variants", row: variant.row, targetPublicId: "var_flat_white_regular" },
    ]);
    const priced = both.rows.find((row) => row.sheet === "Variants" && row.key === variant.key)!;
    expect(priced).toMatchObject({ classification: "update" });
    expect(priced.changes).toContainEqual({ column: "amount_minor", before: "1800", after: "1250", cell: "Products!K11" });
    expect(priced.changes.map((change) => change.column)).not.toContain("is_default");
  });
});
