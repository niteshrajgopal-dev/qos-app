import { describe, expect, it } from "vitest";

import { evaluateNativeOpenAiGate } from "@/lib/agents/native/openai-runtime-gate";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { computeDescriptionSuggestionState } from "@/lib/catalogue/description-draft/service";
import type { AgentRunRecord } from "@/lib/agents/agent-runs";

describe("catalogue description draft fixtures", () => {
  it("gate disabled admits no catalogue.description provider work", () => {
    const gate = evaluateNativeOpenAiGate("catalogue.description", {}, readAiSpendPolicy({}));
    expect(gate.ready).toBe(false);
  });

  it("marks suggestions stale when the English translation version moved", () => {
    const run = {
      status: "completed",
      requestSummary: {
        schema: "qos.catalogue_description_request.v1",
        sourceTranslationVersion: 1,
        productVersion: 1,
        modelId: "fake-model",
        promptVersion: "catalogue_description_prompt.v1",
      },
      result: {
        schema: "qos.catalogue_description_result.v1",
        description: "New copy",
        sourceTranslationVersion: 1,
        modelId: "fake-model",
        promptVersion: "catalogue_description_prompt.v1",
      },
    } as unknown as AgentRunRecord;
    const state = computeDescriptionSuggestionState({
      run,
      summary: {
        schema: "qos.catalogue_description_request.v1",
        sourceTranslationVersion: 1,
        productVersion: 1,
        modelId: "fake-model",
        promptVersion: "catalogue_description_prompt.v1",
      },
      currentSourceVersion: 2,
      decision: null,
    });
    expect(state).toBe("stale");
  });
});
