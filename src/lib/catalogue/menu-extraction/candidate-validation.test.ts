import { describe, expect, it } from "vitest";

import {
  MenuExtractionCandidateValidationError,
  parseMenuExtractionCandidatePayload,
} from "@/lib/catalogue/menu-extraction/candidate-validation";

const BASE = {
  schema: "qos.catalogue_menu_extraction_candidate.v1" as const,
  candidateKey: "row-1",
  sectionName: "Mains",
  displayNameEn: "Grilled Halloumi",
  displayNameAr: "حلوم مشوي",
  descriptionEn: null,
  descriptionAr: null,
  variantLabelEn: "Default",
  variantLabelAr: "افتراضي",
  priceText: "AED 32",
  amountMinor: 3200,
  currency: "AED",
  allergenText: null,
  unitText: null,
  uncertainty: {
    displayNameEn: "none",
    displayNameAr: "none",
    descriptionEn: "missing",
    descriptionAr: "missing",
    price: "low",
    allergen: "missing",
    unit: "missing",
  },
  evidence: { pageNumber: 1, bbox: null, originalText: "SYNTHETIC" },
  modelConfidenceEstimate: "medium",
};

describe("parseMenuExtractionCandidatePayload", () => {
  it("rejects negative prices parsed from priceText", () => {
    expect(() =>
      parseMenuExtractionCandidatePayload(
        { ...BASE, priceText: "-5", amountMinor: 3200, currency: "AED" },
        "row-1",
      ),
    ).toThrow(MenuExtractionCandidateValidationError);

    try {
      parseMenuExtractionCandidatePayload(
        { ...BASE, priceText: "-5", amountMinor: 3200, currency: "AED" },
        "row-1",
      );
    } catch (error) {
      expect(error).toMatchObject({ field: "priceText", candidateKey: "row-1" });
    }
  });

  it("syncs amountMinor from edited priceText", () => {
    const parsed = parseMenuExtractionCandidatePayload(
      { ...BASE, priceText: "AED 40", amountMinor: 3200, currency: "AED" },
      "row-1",
    );
    expect(parsed.amountMinor).toBe(4000);
    expect(parsed.currency).toBe("AED");
  });
});
