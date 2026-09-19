import { describe, expect, it } from "vitest";

import {
  normalizeImportImageUrl,
  normalizeImportRow,
} from "@/lib/catalogue/catalogue-import-validation";
import { CatalogueValidationError } from "@/lib/catalogue/validation";

describe("catalogue import validation", () => {
  it("normalizes optional https image URLs", () => {
    expect(
      normalizeImportImageUrl(
        "https://media.finedinemenu.com/MawZBMZR_/example.jpeg",
      ),
    ).toBe("https://media.finedinemenu.com/MawZBMZR_/example.jpeg");
    expect(normalizeImportImageUrl("")).toBeNull();
  });

  it("rejects invalid image URLs", () => {
    expect(() => normalizeImportImageUrl("not-a-url")).toThrow(
      CatalogueValidationError,
    );
    expect(() =>
      normalizeImportImageUrl("http://media.finedinemenu.com/a.jpeg"),
    ).toThrow(CatalogueValidationError);
  });

  it("maps image_url from import rows when configured", () => {
    const normalized = normalizeImportRow(
      {
        source_id: "img-001",
        internal_name: "cream-espresso",
        display_name_en: "Cream Espresso",
        display_name_ar: "كريم اسبريسو",
        amount_minor: "3700",
        currency: "AED",
        image_url:
          "https://media.finedinemenu.com/MawZBMZR_/ae2ec51a-5128-4109-a4d9-418421621d47.jpeg",
      },
      {
        sourceId: "source_id",
        internalName: "internal_name",
        displayNameEn: "display_name_en",
        displayNameAr: "display_name_ar",
        amountMinor: "amount_minor",
        currency: "currency",
        imageUrl: "image_url",
      },
      2,
    );

    expect(normalized.imageUrl).toBe(
      "https://media.finedinemenu.com/MawZBMZR_/ae2ec51a-5128-4109-a4d9-418421621d47.jpeg",
    );
  });
});
