import { afterEach, describe, expect, it } from "vitest";

import {
  assertCapabilities,
  FIELD_CAPABILITIES,
  fieldExtensionFor,
  registerFieldExtension,
  splitDeferred,
} from "@/lib/workbook/apply/capability";
import { ApplyUnitError } from "@/lib/workbook/apply/errors";
import { contractSheet, SUPPORTED_ENTITY_SHEETS } from "@/lib/workbook/contract";
import { isDeferredColumn } from "@/lib/workbook/validation/capability";

const MECHANICS = new Set(["action", "expected_revision", "clear_fields", "row_check"]);

function isIdentity(sheet: string, column: string) {
  const definition = contractSheet(sheet).columns.find((candidate) => candidate.key === column);
  return !definition || Boolean(definition.isKey) || Boolean(definition.readonly) || definition.type === "reference";
}

describe("FIELD_CAPABILITIES", () => {
  it("covers every non-mechanics, non-deferred, non-readonly data column of each supported sheet", () => {
    for (const sheet of SUPPORTED_ENTITY_SHEETS) {
      if (sheet === "Branches") {
        expect(FIELD_CAPABILITIES.Branches).toEqual([]);
        continue;
      }
      const expected = contractSheet(sheet)
        .columns.map((column) => column.key)
        .filter((column) => !MECHANICS.has(column) && !isIdentity(sheet, column) && !isDeferredColumn(sheet, column));
      for (const column of expected) {
        expect(FIELD_CAPABILITIES[sheet], `${sheet}.${column}`).toContain(column);
      }
    }
  });

  it("reports deferred columns and never treats them as persistable capabilities", () => {
    expect(isDeferredColumn("Variants", "price_tax_basis")).toBe(true);
    expect(isDeferredColumn("Variants", "tax_rate_basis_points")).toBe(true);
    expect(isDeferredColumn("Product Modifiers", "free_options_count")).toBe(true);
    for (const column of ["min_selections", "max_selections", "repeat_allowed", "selection_count_mode"]) {
      expect(isDeferredColumn("Product Modifiers", column), column).toBe(true);
      expect(FIELD_CAPABILITIES["Product Modifiers"], column).not.toContain(column);
    }
    expect(FIELD_CAPABILITIES.Variants).not.toContain("price_tax_basis");
    expect(FIELD_CAPABILITIES["Sales Channels"]).toEqual([]);
    expect(FIELD_CAPABILITIES["Variant Channel Prices"]).toEqual([]);
    expect(FIELD_CAPABILITIES["Modifier Option Channel Prices"]).toEqual([]);
    for (const [sheet, column] of [
      ["Sales Channels", "channel_code"],
      ["Sales Channels", "display_name"],
      ["Variant Channel Prices", "amount_minor"],
      ["Modifier Option Channel Prices", "amount_minor"],
    ] as const) {
      expect(isDeferredColumn(sheet, column), `${sheet}.${column}`).toBe(true);
    }
    expect(FIELD_CAPABILITIES.Variants).not.toContain("tax_rate_basis_points");
    for (const [sheet, column] of [
      ["Products", "preparation_time_minutes"],
      ["Products", "walking_time_minutes"],
      ["Products", "high_salt"],
      ["Products", "is_stock_product"],
      ["Variants", "selling_quantity_basis"],
      ["Variants", "price_unit"],
      ["Variants", "price_unit_quantity"],
      ["Modifier Options", "nutrition_calories"],
    ] as const) {
      expect(isDeferredColumn(sheet, column), `${sheet}.${column}`).toBe(true);
      expect(FIELD_CAPABILITIES[sheet], `${sheet}.${column}`).not.toContain(column);
    }
    expect(FIELD_CAPABILITIES.Products).toContain("nutrition_calories");
    expect(isDeferredColumn("Products", "nutrition_calories")).toBe(false);
    const deferred = splitDeferred("Variants", [
      { column: "tax_rate_basis_points", owner: "QOS-215", value: "500" },
      { column: "product_cost", owner: "QOS-215", value: "1.20" },
    ]);
    expect(deferred.kept.map((field) => field.column).sort()).toEqual(["product_cost", "tax_rate_basis_points"]);
    expect(deferred.extended).toEqual([]);
  });

  it("fails closed on an unknown after column", () => {
    expect(() =>
      assertCapabilities({
        sheet: "Products",
        operation: "create",
        after: { internal_name: "x", display_name_en: "X", display_name_ar: "س", invented_column: "1" },
        changes: [],
      }),
    ).toThrow(ApplyUnitError);
    try {
      assertCapabilities({
        sheet: "Products",
        operation: "update",
        after: { invented_column: "1" },
        changes: [{ column: "invented_column" }],
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ApplyUnitError);
      expect((error as ApplyUnitError).failure).toMatchObject({ code: "unsupported_field", field: "invented_column" });
    }
  });

  it("routes only a registered extension's column to that extension", () => {
    const extension = { sheet: "Products", column: "invented_column", owner: "QOS-test", apply: async () => undefined };
    const unregister = registerFieldExtension(extension);
    try {
      expect(fieldExtensionFor("Products", "invented_column")).toBe(extension);
      expect(fieldExtensionFor("Products", "sku")).toBeNull();
    } finally {
      unregister();
    }
    expect(fieldExtensionFor("Products", "invented_column")).toBeNull();
  });
});

afterEach(() => {
  // registry cleaned by tests that register
});
