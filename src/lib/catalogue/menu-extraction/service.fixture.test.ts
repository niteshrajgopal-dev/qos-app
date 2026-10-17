import { describe, expect, it } from "vitest";

import { evaluateNativeOpenAiGate } from "@/lib/agents/native/openai-runtime-gate";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";

describe("menu extraction gate", () => {
  it("gate disabled admits no catalogue.menu_extraction provider work", () => {
    const gate = evaluateNativeOpenAiGate("catalogue.menu_extraction", {}, readAiSpendPolicy({}));
    expect(gate.ready).toBe(false);
  });
});
