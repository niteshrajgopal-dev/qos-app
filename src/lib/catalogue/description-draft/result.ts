import type { CompletionInterpretation } from "@/lib/agents/agent-runs";
import { CATALOGUE_DESCRIPTION_PROMPT_VERSION } from "@/lib/catalogue/description-draft/prompt";
import {
  type DescriptionSourceFacts,
  validateDescriptionSuggestion,
} from "@/lib/catalogue/description-draft/validator";

export const DESCRIPTION_INPUT_SCHEMA = "qos.catalogue_description_input.v1";
export const DESCRIPTION_RESULT_SCHEMA = "qos.catalogue_description_result.v1";

export type DescriptionReplyContext = {
  facts: DescriptionSourceFacts;
  sourceTranslationVersion: number;
};

export type DescriptionRunResult = {
  schema: typeof DESCRIPTION_RESULT_SCHEMA;
  description: string | null;
  sourceTranslationVersion: number;
  modelId: string;
  promptVersion: string;
};

export function interpretDescriptionModelReply(
  finalMessage: string,
  context: DescriptionReplyContext,
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
  if (record.schema !== DESCRIPTION_RESULT_SCHEMA) {
    return {
      ok: false,
      code: "invalid_result_schema",
      message: "The model returned an unexpected result schema.",
      rawResultExcerpt: finalMessage.slice(0, 512),
    };
  }

  const validated = validateDescriptionSuggestion(
    context.facts,
    record.description === null || typeof record.description === "string"
      ? record.description
      : undefined,
  );

  if (!validated.ok) {
    return {
      ok: false,
      code: validated.code,
      message: validated.message,
      rawResultExcerpt: finalMessage.slice(0, 512),
    };
  }

  const result: DescriptionRunResult = {
    schema: DESCRIPTION_RESULT_SCHEMA,
    description: validated.value,
    sourceTranslationVersion: context.sourceTranslationVersion,
    modelId: typeof record.modelId === "string" ? record.modelId : "",
    promptVersion: CATALOGUE_DESCRIPTION_PROMPT_VERSION,
  };

  return { ok: true, result };
}
