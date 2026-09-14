import { describe, expect, it } from "vitest";

import {
  validateAssignCategoryProductInput,
  validateCreateCategoryInput,
  validateReorderCategoriesInput,
  validateUpdateCategoryInput,
} from "@/lib/catalogue/category-validation";
import { CatalogueValidationError } from "@/lib/catalogue/validation";

describe("category validation", () => {
  it("requires EN and AR display names on create", () => {
    expect(() =>
      validateCreateCategoryInput({
        internalName: "bouquets",
        translations: {
          en: { displayName: "Bouquets" },
          ar: { displayName: "" },
        },
      }),
    ).toThrow(CatalogueValidationError);
  });

  it("normalizes a valid create payload", () => {
    expect(
      validateCreateCategoryInput({
        internalName: "  bouquets  ",
        publicId: "cat_bouquets",
        translations: {
          en: { displayName: " Bouquets " },
          ar: { displayName: " باقات " },
        },
      }),
    ).toEqual({
      internalName: "bouquets",
      publicId: "cat_bouquets",
      sortOrder: 0,
      translations: {
        en: { displayName: "Bouquets" },
        ar: { displayName: "باقات" },
      },
    });
  });

  it("rejects a public id without the cat_ prefix", () => {
    expect(() =>
      validateCreateCategoryInput({
        internalName: "bouquets",
        publicId: "bouquets",
        translations: {
          en: { displayName: "Bouquets" },
          ar: { displayName: "باقات" },
        },
      }),
    ).toThrow(/cat_/);
  });

  it("requires a version on update", () => {
    expect(() =>
      validateUpdateCategoryInput({
        expectedVersion: 0,
        translations: { en: { displayName: "Roses" } },
      }),
    ).toThrow(/expectedVersion/);
  });

  it("rejects duplicate reorder ids", () => {
    expect(() =>
      validateReorderCategoriesInput({
        orderedPublicIds: ["cat_a", "cat_a"],
      }),
    ).toThrow(/unique/);
  });

  it("requires a product public id for assignment", () => {
    expect(() =>
      validateAssignCategoryProductInput({ productPublicId: "  " }),
    ).toThrow(/productPublicId/);
  });
});
