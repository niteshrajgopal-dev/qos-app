import { describe, expect, it } from "vitest";

import { sanitizeTranslationSuggestion } from "@/lib/catalogue/translation-review/sanitize";

describe("translation suggestion sanitization (FIXTURE)", () => {
  const source = {
    displayName: "House Salad",
    description: "Crisp greens with house dressing.",
  };

  it("strips markup from suggestions", () => {
    const result = sanitizeTranslationSuggestion(source, {
      displayName: "<b>Salad</b>",
      description: "<p>Fresh</p>",
    });
    expect(result).toMatchObject({
      ok: true,
      value: { displayName: "Salad", description: "Fresh" },
    });
  });

  it("rejects fabricated nutrition claims not in the source", () => {
    const result = sanitizeTranslationSuggestion(source, {
      displayName: "House Salad",
      description: "Only 120 kcal per serving.",
    });
    expect(result).toMatchObject({ ok: false, code: "fabricated_claim" });
  });

  it("allows nutrition wording when the source already contains it", () => {
    const richSource = {
      displayName: "Light Bowl",
      description: "About 120 kcal per bowl.",
    };
    const result = sanitizeTranslationSuggestion(richSource, {
      displayName: "Light Bowl",
      description: "حوالي 120 سعرة حرارية.",
    });
    expect(result.ok).toBe(true);
  });

  it("rejects prompt-injection style allergen additions", () => {
    const result = sanitizeTranslationSuggestion(source, {
      displayName: "House Salad — contains peanuts",
      description: null,
    });
    expect(result).toMatchObject({ ok: false, code: "fabricated_claim" });
  });
});
