import type { CompletionInterpretation } from "@/lib/agents/agent-runs";
import {
  interpretTranslationModelReply,
  TRANSLATION_INPUT_SCHEMA,
  TRANSLATION_RESULT_SCHEMA,
  type TranslationReplyContext,
} from "@/lib/catalogue/translation-review/result";
import { buildTranslationModelRequest } from "@/lib/catalogue/translation-review/prompt";
import type { ProductLocale } from "@/lib/catalogue/validation";

export const CATALOGUE_TRANSLATION_DEFINITION_KEY = "catalogue_translation";

export type CatalogueTranslationDefinition = {
  readonly key: typeof CATALOGUE_TRANSLATION_DEFINITION_KEY;
  readonly version: string;
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly allowedTools: readonly string[];
  buildRequest(input: {
    sourceLocale: ProductLocale;
    targetLocale: ProductLocale;
    source: { displayName: string; description: string | null };
  }): string;
  interpretReply(finalMessage: string, context: TranslationReplyContext): CompletionInterpretation;
};

const CATALOGUE_TRANSLATION_V1: CatalogueTranslationDefinition = Object.freeze({
  key: CATALOGUE_TRANSLATION_DEFINITION_KEY,
  version: "catalogue_translation.v1",
  inputSchema: TRANSLATION_INPUT_SCHEMA,
  outputSchema: TRANSLATION_RESULT_SCHEMA,
  allowedTools: Object.freeze([]),
  buildRequest: buildTranslationModelRequest,
  interpretReply: interpretTranslationModelReply,
});

export const CURRENT_CATALOGUE_TRANSLATION_DEFINITION = CATALOGUE_TRANSLATION_V1;

export function getCatalogueTranslationDefinition(
  version: string | null,
): CatalogueTranslationDefinition | null {
  if (version === null || version === CATALOGUE_TRANSLATION_V1.version) {
    return CATALOGUE_TRANSLATION_V1;
  }
  return null;
}

export const CATALOGUE_TRANSLATION_PROVIDER_AGENT_ID = "qos.catalogue.translation";
