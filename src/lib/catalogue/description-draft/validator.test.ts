import { describe, expect, it } from "vitest";

import {
  buildDescriptionFactsCorpus,
  validateDescriptionSuggestion,
} from "@/lib/catalogue/description-draft/validator";

const BASE_FACTS = {
  displayName: "Latte",
  description: "Smooth espresso with milk.",
  nutritionCalories: null as number | null,
};

describe("validateDescriptionSuggestion", () => {
  it("rejects fabricated nutrition claims not in the source", () => {
    const result = validateDescriptionSuggestion(BASE_FACTS, "Now with 500 kcal per cup.");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("fabricated_claim");
    }
  });

  it("allows nutrition wording when calories are authorized on the product", () => {
    const facts = { ...BASE_FACTS, nutritionCalories: 120 };
    expect(buildDescriptionFactsCorpus(facts)).toContain("120 kcal");
    const result = validateDescriptionSuggestion(facts, "About 120 kcal per serving.");
    expect(result).toEqual({ ok: true, value: "About 120 kcal per serving." });
  });

  it("rejects prompt-injection style allergen additions", () => {
    const result = validateDescriptionSuggestion(
      BASE_FACTS,
      "Contains peanuts and tree nuts.",
    );
    expect(result.ok).toBe(false);
  });
});
