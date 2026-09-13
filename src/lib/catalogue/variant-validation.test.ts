import { describe, expect, it } from "vitest";

import { CatalogueValidationError } from "@/lib/catalogue/validation";
import {
  assertDistinctVariantLabels,
  assertVariantLabelsForMultipleChoices,
  validateCreateProductVariantInput,
  validateReorderProductVariantsInput,
  validateUpdateProductVariantInput,
} from "@/lib/catalogue/variant-validation";

describe("variant validation", () => {
  it("rejects non-integer and negative prices", () => {
    expect(() =>
      validateCreateProductVariantInput({
        expectedProductVersion: 1,
        amountMinor: 12.5,
      }),
    ).toThrow(CatalogueValidationError);

    expect(() =>
      validateCreateProductVariantInput({
        expectedProductVersion: 1,
        amountMinor: -100,
      }),
    ).toThrow(CatalogueValidationError);
  });

  it("allows explicit zero prices", () => {
    const validated = validateCreateProductVariantInput({
      expectedProductVersion: 1,
      amountMinor: 0,
    });

    expect(validated.amountMinor).toBe(0);
  });

  it("requires distinguishable labels when multiple choices exist", () => {
    expect(() =>
      assertVariantLabelsForMultipleChoices(
        2,
        { en: { displayName: "" }, ar: { displayName: "كبير" } },
        "variant.large",
      ),
    ).toThrow(CatalogueValidationError);

    expect(() =>
      assertDistinctVariantLabels(
        [
          { publicId: "var_small", displayName: "Small" },
          { publicId: "var_large", displayName: "small" },
        ],
        "en",
      ),
    ).toThrow(CatalogueValidationError);
  });

  it("validates reorder payloads", () => {
    expect(() =>
      validateReorderProductVariantsInput({
        expectedProductVersion: 1,
        orderedPublicIds: ["var_a", "var_a"],
      }),
    ).toThrow(CatalogueValidationError);

    const validated = validateReorderProductVariantsInput({
      expectedProductVersion: 2,
      orderedPublicIds: ["var_large", "var_small"],
    });

    expect(validated.orderedPublicIds).toEqual(["var_large", "var_small"]);
  });

  it("validates archive status updates", () => {
    expect(() =>
      validateUpdateProductVariantInput({
        expectedProductVersion: 1,
        status: "draft" as "archived",
      }),
    ).toThrow(CatalogueValidationError);
  });
});
