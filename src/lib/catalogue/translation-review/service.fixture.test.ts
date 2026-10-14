import { describe, expect, it } from "vitest";

import { evaluateNativeOpenAiGate } from "@/lib/agents/native/openai-runtime-gate";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { computeSuggestionState } from "@/lib/catalogue/translation-review/service";
import type { AgentRunRecord } from "@/lib/agents/agent-runs";

describe("catalogue translation review (FIXTURE)", () => {
  it("gate disabled admits no catalogue.translation provider work", () => {
    const gate = evaluateNativeOpenAiGate("catalogue.translation", {}, readAiSpendPolicy({}));
    expect(gate.ready).toBe(false);
  });

  it("marks suggestions stale when target translation version drifts", () => {
    const run = {
      status: "completed",
      requestSummary: {
        schema: "qos.catalogue_translation_request.v1",
        sourceLocale: "en",
        targetLocale: "ar",
        sourceTranslationVersion: 2,
        targetTranslationVersion: 3,
        productVersion: 1,
        modelId: "fake-model",
        promptVersion: "catalogue_translation_prompt.v1",
      },
      result: {
        schema: "qos.catalogue_translation_result.v1",
        displayName: "x",
        description: null,
        sourceTranslationVersion: 2,
        targetTranslationVersion: 3,
      },
    } as unknown as AgentRunRecord;

    const state = computeSuggestionState({
      run,
      summary: {
        schema: "qos.catalogue_translation_request.v1",
        sourceLocale: "en",
        targetLocale: "ar",
        sourceTranslationVersion: 2,
        targetTranslationVersion: 3,
        productVersion: 1,
        modelId: "fake-model",
        promptVersion: "catalogue_translation_prompt.v1",
      },
      currentSourceVersion: 2,
      currentTargetVersion: 4,
      decision: null,
    });
    expect(state).toBe("stale");
  });
});
