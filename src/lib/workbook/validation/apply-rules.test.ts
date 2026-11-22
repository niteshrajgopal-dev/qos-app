import { describe, expect, it } from "vitest";

import { reviewWorkbook } from "@/lib/workbook/validation/review";
import { qosInput, seedRow, snapshotFrom } from "@/lib/workbook/validation/test-support";

function rowsOf(sheet: string, rows: ReturnType<typeof reviewWorkbook>["rows"]) {
  return rows.filter((row) => row.sheet === sheet);
}

function expectReason(row: ReturnType<typeof reviewWorkbook>["rows"][number], reason: string) {
  expect(row.classification).toBe("invalid");
  expect(row.diagnostics).toContainEqual(
    expect.objectContaining({ code: "service_validation", params: expect.objectContaining({ reason }) }),
  );
}

describe("QOS-217 service-parity review rules", () => {
  it("refuses product and menu draft → active, and a create already marked active", () => {
    const snapshot = snapshotFrom({
      records: {
        Products: [seedRow("Products", 0, { status: "draft" })],
        Menus: [seedRow("Menus", 0, { status: "draft" })],
      },
    });
    const product = reviewWorkbook(
      qosInput({
        Products: [seedRow("Products", 0, { action: "update", status: "active" })],
      }),
      snapshot,
    );
    expectReason(rowsOf("Products", product.rows)[0]!, "status_requires_publication");

    const created = reviewWorkbook(
      qosInput({
        Products: [
          {
            product_key: "prd~new",
            action: "create",
            internal_name: "new",
            display_name_en: "New",
            display_name_ar: "جديد",
            status: "active",
          },
        ],
        Variants: [
          {
            variant_key: "var~new-default",
            action: "create",
            product_key: "prd~new",
            variant_label_en: "Regular",
            variant_label_ar: "عادي",
            is_default: "TRUE",
            amount_minor: "1000",
            currency: "AED",
          },
        ],
      }),
      snapshotFrom(),
    );
    expectReason(rowsOf("Products", created.rows)[0]!, "status_requires_publication");

    const menus = reviewWorkbook(
      qosInput({
        Menus: [seedRow("Menus", 0, { action: "update", status: "active" })],
      }),
      snapshot,
    );
    expectReason(rowsOf("Menus", menus.rows)[0]!, "status_requires_publication");
  });

  it("leaves an existing product or menu status alone when the workbook only writes draft", () => {
    const product = reviewWorkbook(
      qosInput({
        Products: [seedRow("Products", 0, { action: "update", display_name_en: "Flat White (large)", status: "draft" })],
      }),
      snapshotFrom(),
    );
    const productRow = rowsOf("Products", product.rows)[0]!;
    expect(productRow.classification).toBe("update");
    expect(productRow.changes.map((change) => change.column)).toEqual(["display_name_en"]);

    const menu = reviewWorkbook(
      qosInput({
        Menus: [seedRow("Menus", 0, { action: "update", display_name_en: "Main menu (revised)", status: "draft" })],
      }),
      snapshotFrom(),
    );
    const menuRow = rowsOf("Menus", menu.rows)[0]!;
    expect(menuRow.classification).toBe("update");
    expect(menuRow.changes.map((change) => change.column)).toEqual(["display_name_en"]);
  });

  it("refuses a menu create that has no Menu Branches row", () => {
    const review = reviewWorkbook(
      qosInput({
        Menus: [
          {
            menu_key: "menu~new",
            action: "create",
            internal_name: "new-menu",
            display_name_en: "New menu",
            display_name_ar: "قائمة جديدة",
            status: "draft",
          },
        ],
      }),
      snapshotFrom(),
    );
    expectReason(rowsOf("Menus", review.rows)[0]!, "menu_requires_branch");
  });

  it("refuses Branch Prices on a non-default variant", () => {
    const snapshot = snapshotFrom({
      records: {
        Products: [seedRow("Products", 0)],
        Variants: [
          seedRow("Variants", 0, { is_default: "TRUE" }),
          {
            ...seedRow("Variants", 0, {
              variant_key: "var_extra",
              qos_variant_id: "var_extra",
              is_default: "FALSE",
              variant_label_en: "Large",
              variant_label_ar: "كبير",
            }),
          },
        ],
      },
    });
    const review = reviewWorkbook(
      qosInput({
        "Branch Prices": [
          {
            branch_price_key: "bp1",
            action: "create",
            variant_key: "var_extra",
            branch_key: "loc_quotes_hbz",
            amount_minor: "1500",
            currency: "AED",
          },
        ],
      }),
      snapshot,
    );
    expectReason(rowsOf("Branch Prices", review.rows)[0]!, "branch_price_default_variant_only");
  });
});
