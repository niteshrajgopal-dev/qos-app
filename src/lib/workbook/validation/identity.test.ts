import { describe, expect, it } from "vitest";

import type { PlanDecision } from "@/lib/workbook/validation/model";
import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { qosInput, seedRow, snapshotFrom } from "@/lib/workbook/validation/test-support";

const NEW_PRODUCT = {
  product_key: "p-new",
  action: "create",
  internal_name: "something-else",
  display_name_en: "Something else",
  display_name_ar: "شيء آخر",
  status: "draft",
};
const NEW_VARIANT = { variant_key: "v-new", action: "create", product_key: "p-new", is_default: "TRUE", sort_order: "0", amount_minor: "1500", currency: "AED", status: "draft" };

function review(products: Array<Record<string, string>>, decisions: PlanDecision[] = [], options: { keysVerified?: boolean; links?: Array<{ sourceId: string; productPublicId: string }> } = {}) {
  return reviewWorkbook(
    qosInput(
      { Products: products, Variants: products.filter((row) => row.action === "create").map((row) => ({ ...NEW_VARIANT, variant_key: `${row.product_key}-v`, product_key: row.product_key! })) },
      { keysVerified: options.keysVerified ?? false, isExport: false, sourceNamespace: "foodics-menu-v1:ten_quotes_dev" },
    ),
    snapshotFrom({ sourceLinks: options.links }),
    decisions,
  );
}

describe("identity and matching", () => {
  it("a create colliding on the English, Arabic or internal name is Conflicting with candidates, never an Update", () => {
    for (const collision of [
      { display_name_en: "flat  white" },
      { display_name_ar: "فلات وايت" },
      { internal_name: "Flat-White" },
    ]) {
      const result = review([{ ...NEW_PRODUCT, ...collision }]);
      const product = result.rows.find((row) => row.sheet === "Products")!;
      expect(product.classification, JSON.stringify(collision)).toBe("conflicting");
      expect(product.operation).toBeNull();
      expect(product.identity.targetPublicId).toBeNull();
      expect(product.candidates).toEqual([expect.objectContaining({ publicId: "prd_flat_white", kind: "name_collision", variantCount: 1 })]);
      expect(product.diagnostics).toContainEqual(expect.objectContaining({ code: "name_collision" }));
      expect(result.counts.create).toBe(0);
      expect(result.counts.update).toBe(0);
    }
  });

  it("a create with nothing similar is a Create", () => {
    const result = review([NEW_PRODUCT]);
    expect(result.rows.map((row) => [row.sheet, row.classification])).toEqual([
      ["Products", "create"],
      ["Variants", "create"],
    ]);
  });

  it("an update without an id is never merged by name", () => {
    const named = review([{ ...NEW_PRODUCT, action: "update", display_name_en: "Flat White" }]);
    expect(named.rows[0]).toMatchObject({ classification: "conflicting", identity: { targetPublicId: null } });
    expect(named.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "update_target_unresolved" }));
    const unknown = review([{ ...NEW_PRODUCT, action: "update" }]);
    expect(unknown.rows[0]).toMatchObject({ classification: "invalid" });
    expect(unknown.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "update_requires_id" }));
  });

  it("a verified id with the current revision is an Update or Unchanged; a stale token is Conflicting", () => {
    const unchanged = reviewWorkbook(qosInput({ Products: [seedRow("Products", 0, { action: "update" })] }), snapshotFrom());
    expect(unchanged.rows[0]).toMatchObject({ classification: "unchanged", identity: { via: "qos_id", targetPublicId: "prd_flat_white" } });

    const renamed = reviewWorkbook(qosInput({ Products: [seedRow("Products", 0, { action: "update", display_name_en: "Flat White (large)" })] }), snapshotFrom());
    expect(renamed.rows[0]).toMatchObject({ classification: "update", operation: "update", changes: [{ column: "display_name_en", before: "Flat White", after: "Flat White (large)" }] });

    const stale = reviewWorkbook(
      qosInput({ Products: [seedRow("Products", 0, { action: "update", display_name_en: "X", expected_revision: "rv1.AAAAAAAAAAAAAAAAAAAAAA" })] }),
      snapshotFrom(),
    );
    expect(stale.rows[0]).toMatchObject({ classification: "conflicting" });
    expect(stale.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "stale_revision" }));

    const accepted = reviewWorkbook(
      qosInput({ Products: [seedRow("Products", 0, { action: "update", display_name_en: "X", expected_revision: "rv1.AAAAAAAAAAAAAAAAAAAAAA" })] }),
      snapshotFrom(),
      [{ kind: "accept_current_revision", sheet: "Products", row: 7 }],
    );
    expect(accepted.rows[0]).toMatchObject({ classification: "update", decision: { kind: "accept_current_revision" } });
    expect(accepted.rows[0]!.identity.targetRevision).toBe(seedRow("Products", 0).expected_revision);
  });

  it("an unknown or foreign public id is target_not_found", () => {
    const result = reviewWorkbook(qosInput({ Products: [seedRow("Products", 0, { action: "update", qos_product_id: "prd_flowers_rose", product_key: "prd_flowers_rose" })] }), snapshotFrom());
    expect(result.rows[0]).toMatchObject({ classification: "invalid" });
    expect(result.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "target_not_found", params: { id: "prd_flowers_rose" } }));
  });

  it("source links verify update rows and turn a create into key_already_linked", () => {
    const links = [{ sourceId: "p-new", productPublicId: "prd_flat_white" }];
    const update = review([{ ...NEW_PRODUCT, action: "update" }], [], { links });
    expect(update.rows[0]).toMatchObject({ classification: "update", identity: { via: "source_link", targetPublicId: "prd_flat_white" } });

    const create = review([NEW_PRODUCT], [], { links });
    expect(create.rows[0]).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "prd_flat_white", kind: "linked" })] });
    expect(create.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "key_already_linked" }));

    const used = review([NEW_PRODUCT], [{ kind: "use_linked_record", sheet: "Products", row: 7 }], { links });
    expect(used.rows[0]).toMatchObject({ classification: "update", identity: { via: "source_link" }, decision: { kind: "use_linked_record" } });

    const created = review([NEW_PRODUCT], [{ kind: "create_new", sheet: "Products", row: 7 }], { links });
    expect(created.rows[0]).toMatchObject({ classification: "create", acknowledgedCollision: true });
  });

  it("decisions change classes exactly as specified, and a bad target is rejected without a 500", () => {
    const row = { ...NEW_PRODUCT, display_name_en: "Flat White" };
    const matched = review([row], [{ kind: "match_existing", sheet: "Products", row: 7, targetPublicId: "prd_flat_white" }]);
    expect(matched.rows[0]).toMatchObject({ classification: "update", identity: { via: "decision", targetPublicId: "prd_flat_white", targetRevision: seedRow("Products", 0).expected_revision } });

    const createNew = review([row], [{ kind: "create_new", sheet: "Products", row: 7 }]);
    expect(createNew.rows[0]).toMatchObject({ classification: "create", acknowledgedCollision: true, decision: { kind: "create_new" } });

    const excluded = review([row], [{ kind: "exclude", sheet: "Products", row: 7 }]);
    expect(excluded.rows[0]).toMatchObject({ classification: "skipped", decision: { kind: "exclude" } });
    expect(excluded.rows[1]).toMatchObject({ classification: "blocked" });

    const missing = review([row], [{ kind: "match_existing", sheet: "Products", row: 7, targetPublicId: "prd_missing" }]);
    expect(missing.rows[0]).toMatchObject({ classification: "conflicting", decision: null });
    expect(missing.rows[0]!.diagnostics).toContainEqual(expect.objectContaining({ code: "decision_rejected", severity: "warning" }));
  });

  it("decisions addressed by key follow their row into an edited upload", () => {
    const row = { ...NEW_PRODUCT, display_name_en: "Flat White" };
    const result = review([{ ...NEW_PRODUCT, product_key: "other" }, row], [{ kind: "match_existing", sheet: "Products", row: 7, key: "p-new", targetPublicId: "prd_flat_white" }]);
    const target = result.rows.find((entry) => entry.key === "p-new")!;
    expect(target).toMatchObject({ row: 8, classification: "update", decision: { row: 8, key: "p-new" } });
  });

  it("names never confirm identity: the same rows reviewed twice give the same classes", () => {
    const first = review([{ ...NEW_PRODUCT, display_name_en: "Flat White" }]);
    const second = review([{ ...NEW_PRODUCT, display_name_en: "Flat White" }]);
    expect(second.rows.map((row) => row.classification)).toEqual(first.rows.map((row) => row.classification));
    expect(first.counts.create).toBe(0);
  });
});
