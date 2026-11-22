import { describe, expect, it } from "vitest";

import { SOURCE_MAP_SHEET } from "@/lib/workbook/dictionary";
import {
  computeFieldDecisions,
  decideField,
  CHANNEL_PRICE_APPLY_OWNER,
  PRODUCT_MODIFIER_POLICY_APPLY_OWNER,
  SELLING_ATTRIBUTE_APPLY_OWNER,
  VALIDATED_OWNER,
} from "@/lib/workbook/validation/capability";
import { qosInput } from "@/lib/workbook/validation/test-support";

describe("field decisions", () => {
  it("keeps deferred fields deferred with their owners", () => {
    for (const [sheet, column] of [
      [SOURCE_MAP_SHEET, "product_cost"],
      [SOURCE_MAP_SHEET, "channel_price:aggregator 1"],
      [SOURCE_MAP_SHEET, "channel_price:aggregator 2"],
      [SOURCE_MAP_SHEET, "channel_price:aggregator 3"],
      [SOURCE_MAP_SHEET, "allow_repeat"],
      [SOURCE_MAP_SHEET, "type_of_tax"],
      ["Variants", "price_tax_basis"],
      ["Variants", "tax_rate_basis_points"],
      ["Product Modifiers", "free_options_count"],
    ] as const) {
      const decision = decideField(sheet, column);
      expect(decision.decision, `${sheet}.${column}`).toBe("deferred");
      expect(decision.owner, `${sheet}.${column}`).toMatch(/QOS-21[2-5]/);
    }
  });

  it("defers v1.1 Product Modifiers policy columns to QOS-200 apply", () => {
    for (const column of ["min_selections", "max_selections", "repeat_allowed", "selection_count_mode"]) {
      expect(decideField("Product Modifiers", column), column).toMatchObject({
        decision: "deferred",
        owner: PRODUCT_MODIFIER_POLICY_APPLY_OWNER,
      });
    }
    expect(decideField("Product Modifiers", "sort_order")).toMatchObject({ decision: "validated", owner: VALIDATED_OWNER });
  });

  it("defers v1.2 persistable channel-price columns to QOS-200 apply", () => {
    for (const [sheet, column] of [
      ["Sales Channels", "channel_code"],
      ["Sales Channels", "display_name"],
      ["Sales Channels", "kind"],
      ["Sales Channels", "workbook_slot"],
      ["Sales Channels", "status"],
      ["Variant Channel Prices", "amount_minor"],
      ["Variant Channel Prices", "currency"],
      ["Variant Channel Prices", "workbook_slot"],
      ["Modifier Option Channel Prices", "amount_minor"],
      ["Modifier Option Channel Prices", "currency"],
      ["Modifier Option Channel Prices", "workbook_slot"],
    ] as const) {
      expect(decideField(sheet, column), `${sheet}.${column}`).toMatchObject({
        decision: "deferred",
        owner: CHANNEL_PRICE_APPLY_OWNER,
      });
    }
    expect(decideField("Variant Channel Prices", "action")).toMatchObject({ decision: "mechanics" });
    expect(decideField("Sales Channels", "expected_revision")).toMatchObject({ decision: "mechanics" });
  });

  it("defers v1.3 selling-attribute columns to QOS-200 apply and keeps Products.nutrition_calories validated", () => {
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
      expect(decideField(sheet, column), `${sheet}.${column}`).toMatchObject({
        decision: "deferred",
        owner: SELLING_ATTRIBUTE_APPLY_OWNER,
      });
    }
    // The 1.0 Products.nutrition_calories column is a different field and stays validated.
    expect(decideField("Products", "nutrition_calories")).toMatchObject({ decision: "validated", owner: VALIDATED_OWNER });
    expect(decideField("Variants", "amount_minor")).toMatchObject({ decision: "validated", owner: VALIDATED_OWNER });
  });

  it("calls supported columns validated, steering columns mechanics and Phase 3 sheets rejected", () => {
    expect(decideField("Variants", "amount_minor")).toMatchObject({ decision: "validated", owner: VALIDATED_OWNER, dictionaryClass: "recognized" });
    expect(decideField("Products", "display_name_ar")).toMatchObject({ decision: "validated" });
    for (const column of ["action", "expected_revision", "clear_fields", "row_check"]) {
      expect(decideField("Products", column).decision, column).toBe("mechanics");
    }
    expect(decideField("Future Combos", "name").decision).toBe("rejected");
    expect(decideField("Units", "name")).toMatchObject({ decision: "deferred", dictionaryClass: "deferred" });
    expect(decideField("Suppliers", "name")).toMatchObject({ decision: "deferred", owner: expect.stringContaining("QOS-195") });
  });

  it("lists only columns with values, counts rows and never says persistable", () => {
    const decisions = computeFieldDecisions(
      qosInput({
        Variants: [
          { variant_key: "a", action: "create", amount_minor: "100", tax_rate_basis_points: "500" },
          { variant_key: "b", action: "create", amount_minor: "200" },
        ],
      }),
    );
    expect(decisions.find((entry) => entry.column === "amount_minor")).toMatchObject({ rowsWithValues: 2, decision: "validated" });
    expect(decisions.find((entry) => entry.column === "tax_rate_basis_points")).toMatchObject({ rowsWithValues: 1, decision: "deferred" });
    expect(decisions.find((entry) => entry.column === "sku")).toBeUndefined();
    expect(JSON.stringify(decisions)).not.toContain("persistable");
  });
});
