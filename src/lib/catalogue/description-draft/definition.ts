import type { CompletionInterpretation } from "@/lib/agents/agent-runs";
import { buildDescriptionModelRequest } from "@/lib/catalogue/description-draft/prompt";
import {
  interpretDescriptionModelReply,
  DESCRIPTION_INPUT_SCHEMA,
  DESCRIPTION_RESULT_SCHEMA,
  type DescriptionReplyContext,
} from "@/lib/catalogue/description-draft/result";
import type { DescriptionSourceFacts } from "@/lib/catalogue/description-draft/validator";

export const CATALOGUE_DESCRIPTION_DEFINITION_KEY = "catalogue_description";

export type CatalogueDescriptionDefinition = {
  readonly key: typeof CATALOGUE_DESCRIPTION_DEFINITION_KEY;
  readonly version: string;
  readonly inputSchema: string;
  readonly outputSchema: string;
  readonly allowedTools: readonly string[];
  buildRequest(input: { facts: DescriptionSourceFacts }): string;
  interpretReply(finalMessage: string, context: DescriptionReplyContext): CompletionInterpretation;
};

const CATALOGUE_DESCRIPTION_V1: CatalogueDescriptionDefinition = Object.freeze({
  key: CATALOGUE_DESCRIPTION_DEFINITION_KEY,
  version: "catalogue_description.v1",
  inputSchema: DESCRIPTION_INPUT_SCHEMA,
  outputSchema: DESCRIPTION_RESULT_SCHEMA,
  allowedTools: Object.freeze([]),
  buildRequest: buildDescriptionModelRequest,
  interpretReply: interpretDescriptionModelReply,
});

export const CURRENT_CATALOGUE_DESCRIPTION_DEFINITION = CATALOGUE_DESCRIPTION_V1;

export function getCatalogueDescriptionDefinition(
  version: string | null,
): CatalogueDescriptionDefinition | null {
  if (version === null || version === CATALOGUE_DESCRIPTION_V1.version) {
    return CATALOGUE_DESCRIPTION_V1;
  }
  return null;
}

export const CATALOGUE_DESCRIPTION_PROVIDER_AGENT_ID = "qos.catalogue.description";
