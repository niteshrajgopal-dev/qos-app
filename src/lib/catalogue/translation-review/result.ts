import type { CompletionInterpretation } from "@/lib/agents/agent-runs";
import { CATALOGUE_TRANSLATION_PROMPT_VERSION } from "@/lib/catalogue/translation-review/prompt";
import {
  sanitizeTranslationSuggestion,
  type TranslationSourceFields,
} from "@/lib/catalogue/translation-review/sanitize";
import type { ProductLocale } from "@/lib/catalogue/validation";

export const TRANSLATION_INPUT_SCHEMA = "qos.catalogue_translation_input.v1";
export const TRANSLATION_RESULT_SCHEMA = "qos.catalogue_translation_result.v1";

export type TranslationReplyContext = {
  sourceLocale: ProductLocale;
  targetLocale: ProductLocale;
  source: TranslationSourceFields;
  sourceTranslationVersion: number;
  targetTranslationVersion: number;
};

export type TranslationRunResult = {
  schema: typeof TRANSLATION_RESULT_SCHEMA;
  displayName: string;
  description: string | null;
  sourceTranslationVersion: number;
  targetTranslationVersion: number;
  sourceLocale: ProductLocale;
  targetLocale: ProductLocale;
  modelId: string;
  promptVersion: string;
};

export function interpretTranslationModelReply(
  finalMessage: string,
  context: TranslationReplyContext,
): CompletionInterpretation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(finalMessage.trim());
  } catch {
    return {
      ok: false,
      code: "invalid_model_json",
      message: "The model did not return valid JSON.",
      rawResultExcerpt: finalMessage.slice(0, 512),
    };
  }

  if (!parsed || typeof parsed !== "object") {
    return {
      ok: false,
      code: "invalid_model_json",
      message: "The model did not return a JSON object.",
      rawResultExcerpt: finalMessage.slice(0, 512),
    };
  }

  const record = parsed as Record<string, unknown>;
  if (record.schema !== TRANSLATION_RESULT_SCHEMA) {
    return {
      ok: false,
      code: "invalid_result_schema",
      message: "The model returned an unexpected result schema.",
      rawResultExcerpt: finalMessage.slice(0, 512),
    };
  }

  const sanitized = sanitizeTranslationSuggestion(context.source, {
    displayName: typeof record.displayName === "string" ? record.displayName : "",
    description:
      record.description === null || typeof record.description === "string"
        ? record.description
        : undefined,
  });

  if (!sanitized.ok) {
    return {
      ok: false,
      code: sanitized.code,
      message: sanitized.message,
      rawResultExcerpt: finalMessage.slice(0, 512),
    };
  }

  const result: TranslationRunResult = {
    schema: TRANSLATION_RESULT_SCHEMA,
    displayName: sanitized.value.displayName,
    description: sanitized.value.description,
    sourceTranslationVersion: context.sourceTranslationVersion,
    targetTranslationVersion: context.targetTranslationVersion,
    sourceLocale: context.sourceLocale,
    targetLocale: context.targetLocale,
    modelId: typeof record.modelId === "string" ? record.modelId : "",
    promptVersion: CATALOGUE_TRANSLATION_PROMPT_VERSION,
  };

  return { ok: true, result };
}
