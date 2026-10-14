const HTML_TAG = /<[^>]+>/g;

const FABRICATED_CLAIM_PATTERNS: readonly RegExp[] = [
  /\b\d+\s*(kcal|calories)\b/i,
  /\bgluten[- ]free\b/i,
  /\bcontains\s+(nuts|peanuts|dairy|soy|wheat|shellfish|fish|eggs)\b/i,
  /\ballergen(s)?\b/i,
  /\borganic\b/i,
  /\bhalal\b/i,
  /\bkosher\b/i,
  /\bvegan\b/i,
  /\bnon[- ]gmo\b/i,
  /\bproduct\s+of\b/i,
  /\bcertified\b/i,
];

export type TranslationSourceFields = {
  displayName: string;
  description: string | null;
};

export type TranslationSuggestionFields = {
  displayName: string;
  description?: string | null;
};

export type SanitizeTranslationResult =
  | { ok: true; value: { displayName: string; description: string | null } }
  | { ok: false; code: string; message: string };

function stripMarkup(value: string) {
  return value.replace(HTML_TAG, "").trim();
}

function sourceContainsClaim(source: string, pattern: RegExp) {
  return pattern.test(source);
}

function suggestionAddsClaim(
  source: TranslationSourceFields,
  suggestion: string,
  pattern: RegExp,
) {
  const inSource =
    sourceContainsClaim(source.displayName, pattern) ||
    (source.description ? sourceContainsClaim(source.description, pattern) : false);
  if (inSource) {
    return false;
  }
  return pattern.test(suggestion);
}

export function sanitizeTranslationSuggestion(
  source: TranslationSourceFields,
  suggestion: TranslationSuggestionFields,
): SanitizeTranslationResult {
  const displayName = stripMarkup(suggestion.displayName ?? "");
  if (!displayName) {
    return {
      ok: false,
      code: "empty_display_name",
      message: "The suggestion must include a display name.",
    };
  }
  if (displayName.length > 500) {
    return {
      ok: false,
      code: "display_name_too_long",
      message: "The display name is too long.",
    };
  }

  const descriptionRaw =
    suggestion.description === undefined || suggestion.description === null
      ? null
      : stripMarkup(suggestion.description);
  if (descriptionRaw && descriptionRaw.length > 4000) {
    return {
      ok: false,
      code: "description_too_long",
      message: "The description is too long.",
    };
  }

  const combined = `${displayName}\n${descriptionRaw ?? ""}`;
  for (const pattern of FABRICATED_CLAIM_PATTERNS) {
    if (suggestionAddsClaim(source, combined, pattern)) {
      return {
        ok: false,
        code: "fabricated_claim",
        message: "The suggestion adds claims that are not present in the source.",
      };
    }
  }

  return {
    ok: true,
    value: {
      displayName,
      description: descriptionRaw && descriptionRaw.length > 0 ? descriptionRaw : null,
    },
  };
}
