import { describe, expect, it } from "vitest";

import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { emptySnapshot, qosInput, seedRecords, seedRow, snapshotFrom } from "@/lib/workbook/validation/test-support";

const PRODUCT = { product_key: "p1", action: "create", internal_name: "mocha", display_name_en: "Mocha", display_name_ar: "موكا", status: "draft" };
const VARIANT = { variant_key: "v1", action: "create", product_key: "p1", is_default: "TRUE", sort_order: "0", amount_minor: "1600", currency: "AED", status: "draft" };

describe("variants and options", () => {
  it("needs exactly one default variant per product across the workbook and the existing variants", () => {
    const two = reviewWorkbook(
      qosInput({ Products: [PRODUCT], Variants: [VARIANT, { ...VARIANT, variant_key: "v2", variant_label_en: "Large", variant_label_ar: "كبير" }] }, { keysVerified: false }),
      emptySnapshot(),
    );
    expect(two.rows.filter((row) => row.sheet === "Variants").map((row) => row.classification)).toEqual(["conflicting", "conflicting"]);
    expect(two.rows[1]!.diagnostics).toContainEqual(expect.objectContaining({ code: "default_variant_conflict", params: expect.objectContaining({ count: 2 }) }));

    const none = reviewWorkbook(qosInput({ Products: [PRODUCT] }, { keysVerified: false }), emptySnapshot());
    expect(none.rows[0]).toMatchObject({ classification: "invalid" });
    expect(none.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "default_variant_conflict", params: { count: 0 } }));

    const added = reviewWorkbook(
      qosInput({ Variants: [{ ...VARIANT, product_key: "prd_flat_white", variant_label_en: "Large", variant_label_ar: "كبير" }] }),
      snapshotFrom(),
    );
    expect(added.rows[0]).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "var_flat_white_regular", isDefault: true, detail: "1800 AED" })] });
  });

  it("requires a reviewed target on an existing product with several variants, never fanning out", () => {
    const records = seedRecords();
    records.Variants = [...records.Variants!, { ...records.Variants![0]!, variant_key: "var_flat_white_large", qos_variant_id: "var_flat_white_large", is_default: "FALSE", variant_label_en: "Large", variant_label_ar: "كبير", amount_minor: "2200" }];
    const snapshot = snapshotFrom({ records });
    const row = { variant_key: "x", action: "update", product_key: "prd_flat_white", is_default: "TRUE", sort_order: "0", amount_minor: "1700", currency: "AED", status: "active" };
    const create = reviewWorkbook(qosInput({ Variants: [{ ...row, action: "create" }] }), snapshot);
    expect(create.rows[0]).toMatchObject({ classification: "conflicting" });
    expect(create.rows[0]!.candidates!.map((candidate) => candidate.publicId).sort()).toEqual(["var_flat_white_large", "var_flat_white_regular"]);
    expect(create.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "variant_target_required" }));

    const decided = reviewWorkbook(qosInput({ Variants: [{ ...row, action: "create" }] }), snapshot, [
      { kind: "match_existing", sheet: "Variants", row: 7, targetPublicId: "var_flat_white_regular" },
    ]);
    expect(decided.rows[0]).toMatchObject({ classification: "update", identity: { targetPublicId: "var_flat_white_regular" } });
    expect(decided.rows[0]!.changes.map((change) => change.column)).toContain("amount_minor");

    const foreign = reviewWorkbook(qosInput({ Variants: [{ ...row, action: "create" }] }), snapshot, [
      { kind: "match_existing", sheet: "Variants", row: 7, targetPublicId: "var_other_product" },
    ]);
    expect(foreign.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "decision_rejected" }));
  });

  it("a product row change proposes no variant change", () => {
    const review = reviewWorkbook(qosInput({ Products: [seedRow("Products", 0, { action: "update", sku: "999" })] }), snapshotFrom());
    expect(review.rows).toHaveLength(1);
    expect(review.rows[0]!.changes).toEqual([{ column: "sku", before: "000123", after: "999" }]);
  });

  it("refuses more default options than the group allows", () => {
    const review = reviewWorkbook(
      qosInput({
        "Modifier Options": [
          { modifier_option_key: "o1", action: "create", modifier_group_key: "mg_milk", display_name_en: "Almond", display_name_ar: "لوز", price_minor: "300", currency: "AED", is_default: "TRUE", allows_quantity: "FALSE", max_quantity: "1", sort_order: "2", status: "draft" },
          { modifier_option_key: "o2", action: "create", modifier_group_key: "mg_milk", display_name_en: "Soy", display_name_ar: "صويا", price_minor: "300", currency: "AED", is_default: "TRUE", allows_quantity: "FALSE", max_quantity: "1", sort_order: "3", status: "draft" },
        ],
      }),
      snapshotFrom(),
    );
    expect(review.rows.map((row) => row.classification)).toEqual(["conflicting", "conflicting"]);
    expect(review.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "too_many_defaults", params: expect.objectContaining({ count: 2, max: 1 }) }));
  });

  it("checks modifier group bounds and new options' names within their own group only", () => {
    const review = reviewWorkbook(
      qosInput({
        "Modifier Groups": [{ modifier_group_key: "g", action: "create", internal_name: "extras", display_name_en: "Extras", display_name_ar: "إضافات", min_selections: "3", max_selections: "1", status: "draft" }],
        "Modifier Options": [
          { modifier_option_key: "o", action: "create", modifier_group_key: "mg_milk", display_name_en: "Oat Milk", display_name_ar: "حليب", price_minor: "300", currency: "AED", is_default: "FALSE", allows_quantity: "FALSE", max_quantity: "1", sort_order: "2", status: "draft" },
        ],
      }),
      snapshotFrom(),
    );
    expect(review.rows[0]).toMatchObject({ classification: "invalid" });
    expect(review.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "service_validation", params: expect.objectContaining({ field: "minSelections" }) }));
    expect(review.rows[1]).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "opt_oat" })] });
  });
});
