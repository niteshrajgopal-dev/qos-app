import { describe, expect, it } from "vitest";

import { familyStates, lineStates, variantStates, versionStates } from "@/lib/recipes/states";

const TODAY = "2026-11-10";
const draftVersion = {
  status: "draft" as const,
  effectiveFrom: null,
  effectiveTo: null,
  yieldQuantityMicros: BigInt(4_000_000),
  yieldUnitStatus: "active" as const,
  activeLineCount: 2,
};

describe("recipe states", () => {
  it("derives line states for archived items, missing conversions and costs", () => {
    expect(lineStates({ itemStatus: "active", conversion: "ok", cost: "known" })).toEqual([]);
    expect(lineStates({ itemStatus: "archived", conversion: "missing", cost: "unknown" })).toEqual([
      "item_archived",
      "missing_conversion",
      "cost_unknown",
    ]);
    expect(lineStates({ itemStatus: "active", conversion: "ok", cost: "not_convertible" })).toEqual(["cost_not_convertible"]);
  });

  it("derives version states: no lines, yield missing, yield unit archived, scheduled and ended", () => {
    expect(versionStates(draftVersion, TODAY)).toEqual([]);
    expect(versionStates({ ...draftVersion, activeLineCount: 0, yieldQuantityMicros: null, yieldUnitStatus: null }, TODAY)).toEqual([
      "no_lines",
      "yield_missing",
    ]);
    expect(versionStates({ ...draftVersion, yieldUnitStatus: "archived" }, TODAY)).toEqual(["yield_unit_archived"]);
    const approved = { ...draftVersion, status: "approved" as const, effectiveFrom: "2026-11-01" };
    expect(versionStates(approved, TODAY)).toEqual([]);
    expect(versionStates({ ...approved, effectiveFrom: "2026-12-01" }, TODAY)).toEqual(["scheduled"]);
    expect(versionStates({ ...approved, effectiveTo: "2026-11-10" }, TODAY)).toEqual(["ended"]);
    expect(versionStates({ ...draftVersion, status: "discarded", activeLineCount: 0 }, TODAY)).toEqual([]);
  });

  it("derives family states: no approved version, draft pending, no assignment, output item archived", () => {
    expect(familyStates({ kind: "sellable", versions: [{ status: "draft" }], liveLinkCount: 0, outputItemStatus: null })).toEqual([
      "no_approved_version",
      "draft_pending",
      "no_assignment",
    ]);
    expect(familyStates({ kind: "sellable", versions: [{ status: "approved" }], liveLinkCount: 2, outputItemStatus: null })).toEqual([]);
    expect(
      familyStates({ kind: "prepared", versions: [{ status: "approved" }], liveLinkCount: 0, outputItemStatus: "archived" }),
    ).toEqual(["output_item_archived"]);
  });

  it("shows the stock-product flag without a direct-stock link as needing one, and a recipe link beside it as a conflict", () => {
    const base = { variantStatus: "active" as const, productStatus: "active" as const, sellingQuantityBasis: null };
    expect(variantStates({ ...base, directStockIntent: true, liveLinkKind: null })).toEqual(["needs_direct_stock_link"]);
    expect(variantStates({ ...base, directStockIntent: true, liveLinkKind: "recipe" })).toEqual(["flag_conflicts_with_recipe"]);
    expect(variantStates({ ...base, directStockIntent: true, liveLinkKind: "direct_stock" })).toEqual([]);
    expect(variantStates({ ...base, directStockIntent: null, liveLinkKind: null })).toEqual(["unlinked"]);
    expect(variantStates({ ...base, directStockIntent: false, liveLinkKind: "recipe" })).toEqual([]);
  });

  it("marks archived variants and weight-sold variants", () => {
    expect(
      variantStates({
        variantStatus: "archived",
        productStatus: "active",
        sellingQuantityBasis: "weight",
        directStockIntent: null,
        liveLinkKind: "recipe",
      }),
    ).toEqual(["variant_archived", "weight_basis_unsupported"]);
    expect(
      variantStates({ variantStatus: "active", productStatus: "archived", sellingQuantityBasis: null, directStockIntent: null, liveLinkKind: "recipe" }),
    ).toEqual(["variant_archived"]);
  });
});
