import type { CompletionInterpretation } from "@/lib/agents/agent-runs";
import {
  buildMenuExtractionModelRequest,
  MENU_EXTRACTION_PROMPT_VERSION,
} from "@/lib/catalogue/menu-extraction/prompt";
import {
  interpretMenuExtractionModelReply,
  MENU_EXTRACTION_INPUT_SCHEMA,
  MENU_EXTRACTION_RESULT_SCHEMA,
  type MenuExtractionReplyContext,
} from "@/lib/catalogue/menu-extraction/result";

export const CATALOGUE_MENU_EXTRACTION_DEFINITION_KEY = "catalogue_menu_extraction";

export type CatalogueMenuExtractionDefinition = {
  readonly key: typeof CATALOGUE_MENU_EXTRACTION_DEFINITION_KEY;
  readonly version: string;
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly allowedTools: readonly string[];
  buildRequest(input: {
    sourcePublicId: string;
    pageCount: number;
    localeHint: "en" | "ar" | "mixed";
  }): string;
  interpretReply(
    finalMessage: string,
    context: MenuExtractionReplyContext,
  ): CompletionInterpretation;
};

const CATALOGUE_MENU_EXTRACTION_V1: CatalogueMenuExtractionDefinition = Object.freeze({
  key: CATALOGUE_MENU_EXTRACTION_DEFINITION_KEY,
  version: "catalogue_menu_extraction.v1",
  inputSchema: MENU_EXTRACTION_INPUT_SCHEMA,
  outputSchema: MENU_EXTRACTION_RESULT_SCHEMA,
  allowedTools: Object.freeze([]),
  buildRequest: buildMenuExtractionModelRequest,
  interpretReply: interpretMenuExtractionModelReply,
});

export const CURRENT_CATALOGUE_MENU_EXTRACTION_DEFINITION = CATALOGUE_MENU_EXTRACTION_V1;

export function getCatalogueMenuExtractionDefinition(version: string | null) {
  if (version === null || version === CATALOGUE_MENU_EXTRACTION_V1.version) {
    return CATALOGUE_MENU_EXTRACTION_V1;
  }
  return null;
}

export const CATALOGUE_MENU_EXTRACTION_PROVIDER_AGENT_ID = "qos.catalogue.menu_extraction";
