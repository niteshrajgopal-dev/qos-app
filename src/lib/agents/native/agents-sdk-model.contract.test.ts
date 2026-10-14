import { describe, expect, it, vi } from "vitest";

import { createAgentsSdkModel, type OpenAiChatClient } from "@/lib/agents/native/agents-sdk-model";
import {
  FIXTURE_OPENAI_COMPLETED,
  FIXTURE_OPENAI_INVALID_EMPTY,
  FIXTURE_OPENAI_RATE_LIMITED,
} from "@/lib/agents/native/fixtures/FIXTURE_openai-chat-responses";

function clientFromSteps(steps: Array<{ status: number; body: unknown; headers?: Headers }>): OpenAiChatClient {
  let calls = 0;
  return {
    chat: {
      completions: {
        create: vi.fn(async () => {
          const step = steps[Math.min(calls, steps.length - 1)];
          calls += 1;
          if (step.status >= 400) {
            const error = new Error("provider_error") as Error & { status?: number; headers?: Headers };
            error.status = step.status;
            error.headers = step.headers ?? new Headers();
            throw error;
          }
          return step.body;
        }),
      },
    },
  } as unknown as OpenAiChatClient;
}

describe("Agents SDK model adapter (FIXTURE contract)", () => {
  const config = {
    provider: "openai" as const,
    modelId: "gpt-4.1-mini",
    openAiApiKey: "sk-FIXTURE_contract_key",
  };

  it("rejects tenant-supplied model ids before dispatch", async () => {
    const client = clientFromSteps([{ status: 200, body: FIXTURE_OPENAI_COMPLETED }]);
    const model = createAgentsSdkModel(config, { client });
    await expect(
      model.complete({
        modelId: "gpt-4o",
        instructions: "menu_manager.v2",
        input: "{}",
        tools: [],
      }),
    ).rejects.toThrow(/model_not_approved/);
    expect(client.chat.completions.create).not.toHaveBeenCalled();
  });

  it("retries 429 then completes without leaking the api key", async () => {
    const client = clientFromSteps([
      {
        status: 429,
        body: FIXTURE_OPENAI_RATE_LIMITED,
        headers: new Headers({ "retry-after": "0" }),
      },
      { status: 200, body: FIXTURE_OPENAI_COMPLETED },
    ]);
    const sleeps: number[] = [];
    const model = createAgentsSdkModel(config, {
      client,
      sleepMs: async (ms) => {
        sleeps.push(ms);
      },
    });
    const result = await model.complete({
      modelId: "gpt-4.1-mini",
      correlationId: "run_fixture",
      instructions: "menu_manager.v2",
      input: "{}",
      tools: [],
    });
    expect(result.type).toBe("completed");
    expect(client.chat.completions.create).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(sleeps)).not.toContain("sk-FIXTURE");
  });

  it("fails after bounded retries on invalid responses (never fake success)", async () => {
    const client = clientFromSteps([
      { status: 200, body: FIXTURE_OPENAI_INVALID_EMPTY },
      { status: 200, body: FIXTURE_OPENAI_INVALID_EMPTY },
      { status: 200, body: FIXTURE_OPENAI_INVALID_EMPTY },
    ]);
    const model = createAgentsSdkModel(config, { client, maxAttempts: 3, sleepMs: async () => {} });
    await expect(
      model.complete({
        modelId: "gpt-4.1-mini",
        instructions: "menu_manager.v2",
        input: "{}",
        tools: [],
      }),
    ).rejects.toThrow(/invalid_openai_completion/);
    expect(client.chat.completions.create).toHaveBeenCalledTimes(3);
  });
});
