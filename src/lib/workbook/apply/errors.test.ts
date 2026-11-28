import { describe, expect, it } from "vitest";

import { CatalogueCategoryError } from "@/lib/catalogue/categories";
import { LocationPriceOverrideError } from "@/lib/catalogue/location-price-overrides";
import { MenuError } from "@/lib/catalogue/menus";
import { MenuValidationError } from "@/lib/catalogue/menus.validation";
import { CatalogueModifierError } from "@/lib/catalogue/modifiers";
import { CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE, CatalogueProductMutationGuardError } from "@/lib/catalogue/product-mutation-policy";
import { CatalogueProductError } from "@/lib/catalogue/products";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import { InventoryConflictError, InventoryDependencyError, InventoryDetailError, InventoryError } from "@/lib/inventory/errors";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { ApplyUnitError, describeApplyFailure } from "@/lib/workbook/apply/errors";

describe("describeApplyFailure", () => {
  it("maps service errors by class and status, never leaking unexpected detail", () => {
    expect(describeApplyFailure(new ApplyUnitError("stale_revision", "changed"))).toMatchObject({
      code: "stale_revision",
      message: "changed",
    });
    expect(describeApplyFailure(new StaffAuthorizationError("no"))).toMatchObject({ code: "forbidden", message: "no" });
    expect(describeApplyFailure(new CatalogueValidationError("bad sku", "sku"))).toMatchObject({
      code: "service_validation",
      field: "sku",
      message: "bad sku",
    });
    expect(describeApplyFailure(new MenuValidationError("need a branch", "locationIds"))).toMatchObject({
      code: "service_validation",
      field: "locationIds",
    });
    expect(describeApplyFailure(new CatalogueProductError("taken", 409))).toMatchObject({ code: "conflict" });
    expect(describeApplyFailure(new CatalogueCategoryError("missing", 404))).toMatchObject({ code: "target_not_found" });
    expect(describeApplyFailure(new CatalogueModifierError("no", 403))).toMatchObject({ code: "forbidden" });
    expect(describeApplyFailure(new MenuError("bad", 400))).toMatchObject({ code: "service_validation" });
    expect(describeApplyFailure(new LocationPriceOverrideError("no price", 400))).toMatchObject({ code: "service_validation" });
    expect(
      describeApplyFailure(new CatalogueProductMutationGuardError("archived", 409, undefined, CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE)),
    ).toMatchObject({ code: "archived_target" });
    expect(describeApplyFailure(Object.assign(new Error("dup"), { code: "23505" }))).toMatchObject({
      code: "unique_violation",
    });
    const unexpected = describeApplyFailure(new Error("ECONNRESET secret=abc"));
    expect(unexpected).toEqual({ code: "unexpected", message: "The change could not be saved." });
    expect(JSON.stringify(unexpected)).not.toContain("secret=abc");
    expect(JSON.stringify(unexpected)).not.toContain("ECONNRESET");
  });
});

describe("describeApplyFailure for the inventory and recipe services (QOS-200)", () => {
  it("maps a stale expected version to stale_revision and keeps the service reason and dependencies", () => {
    expect(describeApplyFailure(new InventoryConflictError("changed", "expected_version_mismatch", "expectedVersion"))).toMatchObject({
      code: "stale_revision",
      reason: "expected_version_mismatch",
    });
    expect(describeApplyFailure(new InventoryError("Enter a name.", 400, "name_required", "nameEn"))).toEqual({
      code: "service_validation",
      message: "Enter a name.",
      reason: "name_required",
      field: "nameEn",
    });
    expect(describeApplyFailure(new InventoryError("Item not found.", 404, "item_not_found", "itemPublicId"))).toMatchObject({ code: "target_not_found" });
    expect(describeApplyFailure(new InventoryError("Only administrators.", 403, "administrator_required"))).toMatchObject({ code: "forbidden" });
    expect(
      describeApplyFailure(new InventoryDependencyError("in use", "unit_in_use", "status", [{ kind: "inventory_items", count: 2 }])),
    ).toMatchObject({ code: "in_use", reason: "unit_in_use", details: { dependencies: [{ kind: "inventory_items", count: 2 }] } });
    expect(
      describeApplyFailure(new InventoryDetailError("cycle", "recipe_cycle", "lines", { path: ["Syrup", "Base", "Syrup"] })),
    ).toMatchObject({ code: "conflict", reason: "recipe_cycle", details: { path: ["Syrup", "Base", "Syrup"] } });
    expect(describeApplyFailure(new InventoryConflictError("archived", "recipe_archived"))).toMatchObject({ code: "archived_target" });
    expect(describeApplyFailure(new InventoryError("boom", 500, "internal"))).toEqual({ code: "unexpected", message: "The change could not be saved." });
  });
  it("reports a dependency refusal as in use with its counts, never as a concurrent change (QOS-200 follow-up)", () => {
    expect(describeApplyFailure(new InventoryDependencyError("Items still use this supplier.", "supplier_in_use", "status", [{ kind: "inventory_items", count: 1 }]))).toEqual({
      code: "in_use",
      message: "Items still use this supplier.",
      reason: "supplier_in_use",
      field: "status",
      details: { dependencies: [{ kind: "inventory_items", count: 1 }] },
    });
    for (const reason of ["category_in_use", "item_in_use", "warehouse_in_use", "recipe_in_use"]) {
      expect(describeApplyFailure(new InventoryDependencyError("in use", reason, "status", [{ kind: "recipe_lines", count: 3 }]))).toMatchObject({ code: "in_use", reason });
    }
    // The unit service refuses without counts.
    expect(describeApplyFailure(new InventoryConflictError("in use", "unit_in_use", "status"))).toEqual({ code: "in_use", message: "in use", reason: "unit_in_use", field: "status" });
    // Other conflicts keep their meaning.
    expect(describeApplyFailure(new InventoryConflictError("draft", "draft_exists"))).toMatchObject({ code: "conflict", reason: "draft_exists" });
    expect(describeApplyFailure(new InventoryConflictError("changed", "expected_version_mismatch"))).toMatchObject({ code: "stale_revision" });
  });
});
