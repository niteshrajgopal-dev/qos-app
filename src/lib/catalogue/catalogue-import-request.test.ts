import { describe, expect, it } from "vitest";

import type { CatalogueImportColumnMapping } from "@/db/schema";
import { suggestColumnMapping } from "@/lib/catalogue/catalogue-import-parser";
import {
  legacyPreviewFields,
  newImportIdempotencyKey,
} from "@/lib/catalogue/catalogue-import-request";
import { validateColumnMapping } from "@/lib/catalogue/catalogue-import-validation";

const HEADERS = ["source_id", "internal_name", "display_name_en", "display_name_ar", "amount_minor", "currency"];

const EMPTY_MAPPING: CatalogueImportColumnMapping = {
  sourceId: "",
  internalName: "",
  displayNameEn: "",
  displayNameAr: "",
  descriptionEn: "",
  descriptionAr: "",
  variantLabelEn: "",
  variantLabelAr: "",
  amountMinor: "",
  currency: "",
  sku: "",
  barcode: "",
  imageUrl: "",
};

describe("current-profile preview request (QOS-160 section 1.13)", () => {
  it("reproduces the defect: the old panel's empty starting mapping can never pass validation", () => {
    expect(() => validateColumnMapping(EMPTY_MAPPING, HEADERS)).toThrow("Column mapping for sourceId is required.");
    // What the server does when no mapping is sent:
    expect(() => validateColumnMapping(suggestColumnMapping(HEADERS), HEADERS)).not.toThrow();
  });

  it("sends no mapping on the first preview of a file, so the server suggests one", () => {
    expect(legacyPreviewFields({ connectionKey: " quotes.synthetic ", mapping: null })).toEqual([
      ["connectionKey", "quotes.synthetic"],
    ]);
  });

  it("sends the reviewed mapping once the file's headers are known", () => {
    const mapping = { ...suggestColumnMapping(HEADERS), displayNameAr: "display_name_ar" };
    expect(legacyPreviewFields({ connectionKey: "quotes.synthetic", mapping })).toEqual([
      ["connectionKey", "quotes.synthetic"],
      ["columnMapping", JSON.stringify(mapping)],
    ]);
  });

  it("creates a different idempotency key for every preview attempt", () => {
    const keys = new Set(Array.from({ length: 5 }, () => newImportIdempotencyKey()));
    expect(keys.size).toBe(5);
  });
});
