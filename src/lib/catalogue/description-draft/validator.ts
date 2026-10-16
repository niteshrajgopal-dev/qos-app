import {
  FABRICATED_CLAIM_PATTERNS,
  suggestionAddsUnauthorizedClaim,
} from "@/lib/catalogue/translation-review/sanitize";

const HTML_TAG = /<[^>]+>/g;

export type DescriptionSourceFacts = {
  displayName: string;
  description: string | null;
  nutritionCalories: number | null;
};

export type ValidateDescriptionSuggestionResult =
  | { ok: true; value: string | null }
  | { ok: false; code: string; message: string; flags?: string[] };

function stripMarkup(value: string) {
  return value.replace(HTML_TAG, "").trim();
}

export function buildDescriptionFactsCorpus(facts: DescriptionSourceFacts): string {
  const parts = [facts.displayName];
  if (facts.description) {
    parts.push(facts.description);
  }
  if (facts.nutritionCalories != null && Number.isFinite(facts.nutritionCalories)) {
    const calories = Math.trunc(facts.nutritionCalories);
    parts.push(`${calories} kcal`, `${calories} calories`, `${calories} cal`);
  }
  return parts.join("\n");
}

export function validateDescriptionSuggestion(
  facts: DescriptionSourceFacts,
  rawDescription: string | null | undefined,
): ValidateDescriptionSuggestionResult {
  const descriptionRaw =
    rawDescription === undefined || rawDescription === null
      ? null
      : stripMarkup(rawDescription);
  if (descriptionRaw && descriptionRaw.length > 4000) {
    return {
      ok: false,
      code: "description_too_long",
      message: "The description is too long.",
    };
  }

  const normalized = descriptionRaw && descriptionRaw.length > 0 ? descriptionRaw : null;
  if (!normalized) {
    return { ok: true, value: null };
  }

  const corpus = buildDescriptionFactsCorpus(facts);
  const flags: string[] = [];
  for (const pattern of FABRICATED_CLAIM_PATTERNS) {
    if (suggestionAddsUnauthorizedClaim(corpus, normalized, pattern)) {
      flags.push(pattern.source);
    }
  }
  if (flags.length > 0) {
    return {
      ok: false,
      code: "fabricated_claim",
      message: "The suggestion adds claims that are not present in the authorized product source.",
      flags,
    };
  }

  return { ok: true, value: normalized };
}
