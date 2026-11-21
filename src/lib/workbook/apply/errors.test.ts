import { describe, expect, it } from "vitest";

import { CatalogueCategoryError } from "@/lib/catalogue/categories";
import { LocationPriceOverrideError } from "@/lib/catalogue/location-price-overrides";
import { MenuError } from "@/lib/catalogue/menus";
import { MenuValidationError } from "@/lib/catalogue/menus.validation";
import { CatalogueModifierError } from "@/lib/catalogue/modifiers";
import { CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE, CatalogueProductMutationGuardError } from "@/lib/catalogue/product-mutation-policy";
import { CatalogueProductError } from "@/lib/catalogue/products";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
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
