import { describe, expect, it } from "vitest";

import {
  validateCreateModifierOptionInput,
  validateUpdateModifierOptionInput,
} from "@/lib/catalogue/modifier-validation";
import {
  assertVariantSellingBasisConsistent,
  directStockConsumptionEligible,
  directStockMappingState,
  sellingBasisEnablesFractionalCheckout,
  sellingBasisState,
  validateProductSellingAttributesInput,
  validateVariantSellingBasisPatch,
  variantSellingBasisFromRow,
} from "@/lib/catalogue/selling-attributes";
import {
  CatalogueValidationError,
  validateCreateDraftProductInput,
  validateUpdateDraftProductInput,
} from "@/lib/catalogue/validation";
import {
  validateCreateProductVariantInput,
  validateUpdateProductVariantInput,
} from "@/lib/catalogue/variant-validation";

const baseProduct = {
  internalName: "flat-white",
  translations: {
    en: { displayName: "Flat white" },
    ar: { displayName: "فلات وايت" },
  },
  defaultVariant: { amountMinor: 1800 },
};

function fieldOf(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    if (error instanceof CatalogueValidationError) return error.field;
    throw error;
  }
  throw new Error("expected a CatalogueValidationError");
}

describe("product selling attributes validation", () => {
  it("keeps null, 0 and false distinct on create", () => {
    const unknown = validateCreateDraftProductInput(baseProduct, "hospitality");
    expect(unknown).toMatchObject({
      preparationTimeMinutes: null,
      walkingTimeMinutes: null,
      highSalt: null,
      directStockIntent: null,
    });

    const declared = validateCreateDraftProductInput(
      {
        ...baseProduct,
        preparationTimeMinutes: 0,
        walkingTimeMinutes: 0,
        highSalt: false,
        directStockIntent: false,
      },
      "hospitality",
    );
    expect(declared).toMatchObject({
      preparationTimeMinutes: 0,
      walkingTimeMinutes: 0,
      highSalt: false,
      directStockIntent: false,
    });
  });

  it("leaves omitted fields undefined on update and keeps explicit null as a clear", () => {
    const omitted = validateUpdateDraftProductInput({ expectedVersion: 2 }, "hospitality");
    expect(omitted.preparationTimeMinutes).toBeUndefined();
    expect(omitted.highSalt).toBeUndefined();
    expect("walkingTimeMinutes" in omitted).toBe(false);

    const cleared = validateUpdateDraftProductInput(
      { expectedVersion: 2, preparationTimeMinutes: null, highSalt: null, directStockIntent: null },
      "hospitality",
    );
    expect(cleared).toMatchObject({ preparationTimeMinutes: null, highSalt: null, directStockIntent: null });
  });

  it("rejects negative and fractional minutes", () => {
    expect(fieldOf(() => validateProductSellingAttributesInput({ preparationTimeMinutes: -1 }, "hospitality"))).toBe(
      "preparationTimeMinutes",
    );
    expect(fieldOf(() => validateProductSellingAttributesInput({ walkingTimeMinutes: 2.5 }, "hospitality"))).toBe(
      "walkingTimeMinutes",
    );
    expect(fieldOf(() => validateProductSellingAttributesInput({ preparationTimeMinutes: "5" }, "hospitality"))).toBe(
      "preparationTimeMinutes",
    );
  });

  it("does not coerce strings or numbers into declared booleans", () => {
    expect(fieldOf(() => validateProductSellingAttributesInput({ highSalt: "false" }, "hospitality"))).toBe("highSalt");
    expect(fieldOf(() => validateProductSellingAttributesInput({ directStockIntent: 0 }, "hospitality"))).toBe(
      "directStockIntent",
    );
  });

  it("gates walking time and high salt to hospitality but not prep time or stock intent", () => {
    expect(fieldOf(() => validateProductSellingAttributesInput({ walkingTimeMinutes: 10 }, "generic_retail"))).toBe(
      "walkingTimeMinutes",
    );
    expect(fieldOf(() => validateProductSellingAttributesInput({ highSalt: false }, "generic_retail"))).toBe("highSalt");
    expect(
      validateProductSellingAttributesInput(
        { preparationTimeMinutes: 4, directStockIntent: true, walkingTimeMinutes: null, highSalt: null },
        "generic_retail",
      ),
    ).toEqual({ preparationTimeMinutes: 4, directStockIntent: true, walkingTimeMinutes: null, highSalt: null });
  });

  it("keeps barcode 001234 as text", () => {
    expect(validateCreateDraftProductInput({ ...baseProduct, barcode: "001234" }, "hospitality").barcode).toBe("001234");
    expect(validateUpdateDraftProductInput({ expectedVersion: 1, barcode: " 001234 " }, "hospitality").barcode).toBe(
      "001234",
    );
    expect(validateCreateProductVariantInput({ expectedProductVersion: 1, barcode: "001234" }).barcode).toBe("001234");
  });
});

describe("variant selling basis", () => {
  it("treats all-null as undeclared, not per piece", () => {
    expect(sellingBasisState({ sellingQuantityBasis: null, priceUnit: null, priceUnitQuantity: null })).toBe(
      "undeclared",
    );
  });

  it("resolves weight only with a mass unit and a positive quantity", () => {
    expect(sellingBasisState({ sellingQuantityBasis: "weight", priceUnit: "kg", priceUnitQuantity: 1 })).toBe(
      "weight_resolved",
    );
    expect(sellingBasisState({ sellingQuantityBasis: "weight", priceUnit: "g", priceUnitQuantity: 100 })).toBe(
      "weight_resolved",
    );
    expect(sellingBasisState({ sellingQuantityBasis: "weight", priceUnit: null, priceUnitQuantity: null })).toBe(
      "unresolved",
    );
    expect(sellingBasisState({ sellingQuantityBasis: "weight", priceUnit: "kg", priceUnitQuantity: null })).toBe(
      "unresolved",
    );
    expect(sellingBasisState({ sellingQuantityBasis: null, priceUnit: "g", priceUnitQuantity: 100 })).toBe(
      "unresolved",
    );
  });

  it("accepts each with no unit or with each", () => {
    expect(sellingBasisState({ sellingQuantityBasis: "each", priceUnit: null, priceUnitQuantity: null })).toBe("each");
    expect(sellingBasisState({ sellingQuantityBasis: "each", priceUnit: "each", priceUnitQuantity: 1 })).toBe("each");
  });

  it("rejects weight priced per piece and each priced by mass", () => {
    expect(() =>
      assertVariantSellingBasisConsistent({ sellingQuantityBasis: "weight", priceUnit: "each", priceUnitQuantity: 1 }),
    ).toThrow(CatalogueValidationError);
    for (const priceUnit of ["kg", "g"] as const) {
      expect(() =>
        assertVariantSellingBasisConsistent({ sellingQuantityBasis: "each", priceUnit, priceUnitQuantity: 1 }),
      ).toThrow(CatalogueValidationError);
    }
    expect(() =>
      assertVariantSellingBasisConsistent({ sellingQuantityBasis: "weight", priceUnit: null, priceUnitQuantity: null }),
    ).not.toThrow();
  });

  it("validates enum values and positive quantities", () => {
    expect(fieldOf(() => validateVariantSellingBasisPatch({ sellingQuantityBasis: "litre" }))).toBe(
      "sellingQuantityBasis",
    );
    expect(fieldOf(() => validateVariantSellingBasisPatch({ priceUnit: "lb" }))).toBe("priceUnit");
    expect(fieldOf(() => validateVariantSellingBasisPatch({ priceUnitQuantity: 0 }))).toBe("priceUnitQuantity");
    expect(fieldOf(() => validateVariantSellingBasisPatch({ priceUnitQuantity: -2 }))).toBe("priceUnitQuantity");
    expect(validateVariantSellingBasisPatch({ priceUnitQuantity: 0.25 })).toEqual({ priceUnitQuantity: 0.25 });
  });

  it("passes undefined through on update and null on create", () => {
    expect(validateUpdateProductVariantInput({ expectedProductVersion: 1 }).sellingQuantityBasis).toBeUndefined();
    expect(
      validateUpdateProductVariantInput({ expectedProductVersion: 1, sellingQuantityBasis: null }).sellingQuantityBasis,
    ).toBeNull();
    expect(validateCreateProductVariantInput({ expectedProductVersion: 1 })).toMatchObject({
      sellingQuantityBasis: null,
      priceUnit: null,
      priceUnitQuantity: null,
    });
  });

  it("maps numeric column text and never enables fractional checkout", () => {
    const view = variantSellingBasisFromRow({ sellingQuantityBasis: "weight", priceUnit: "g", priceUnitQuantity: "100" });
    expect(view).toEqual({
      sellingQuantityBasis: "weight",
      priceUnit: "g",
      priceUnitQuantity: 100,
      sellingBasisState: "weight_resolved",
    });
    expect(sellingBasisEnablesFractionalCheckout(view)).toBe(false);
  });
});

describe("direct stock intent", () => {
  it("is never eligible for consumption, even when intent is true", () => {
    expect(directStockConsumptionEligible({ directStockIntent: true })).toBe(false);
    expect(directStockConsumptionEligible({ directStockIntent: false })).toBe(false);
    expect(directStockConsumptionEligible({ directStockIntent: null })).toBe(false);
  });

  it("shows an unresolved mapping only when intent is true", () => {
    expect(directStockMappingState(true)).toBe("unresolved");
    expect(directStockMappingState(false)).toBe("not_stock_product");
    expect(directStockMappingState(null)).toBe("unknown");
  });
});

describe("modifier option calories", () => {
  it("reuses the product calorie convention", () => {
    expect(validateCreateModifierOptionInput({ expectedGroupVersion: 1 }, "hospitality").nutritionCalories).toBeNull();
    expect(
      validateCreateModifierOptionInput({ expectedGroupVersion: 1, nutritionCalories: 0 }, "hospitality")
        .nutritionCalories,
    ).toBe(0);
    expect(validateUpdateModifierOptionInput({ expectedGroupVersion: 1 }, "hospitality").nutritionCalories).toBeUndefined();
    expect(
      fieldOf(() => validateUpdateModifierOptionInput({ expectedGroupVersion: 1, nutritionCalories: -5 }, "hospitality")),
    ).toBe("nutritionCalories");
    expect(
      fieldOf(() => validateUpdateModifierOptionInput({ expectedGroupVersion: 1, nutritionCalories: 1.5 }, "hospitality")),
    ).toBe("nutritionCalories");
    expect(
      fieldOf(() => validateCreateModifierOptionInput({ expectedGroupVersion: 1, nutritionCalories: 30 }, "generic_retail")),
    ).toBe("nutritionCalories");
  });
});
