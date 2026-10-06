import { describe, expect, it, vi } from "vitest";

import { FakeQosModel } from "@/lib/ai/model/fake-qos-model";
import { NATIVE_MAX_TOOL_ROUNDS, runNativeExecutor } from "@/lib/agents/native/native-executor";

const VALID = JSON.stringify({
  schema: "qos.menu_manager_result.v1",
  menuPublicId: "men_breakfast",
  summary: "Looks good.",
  findings: [],
  suggestions: [],
});

function interpret(text: string) {
  if (text === VALID) {
    return { ok: true as const, result: JSON.parse(text) as Record<string, unknown> };
  }
  return {
    ok: false as const,
    code: "invalid_reply",
    message: "The review reply was not valid.",
    rawResultExcerpt: text,
  };
}

describe("runNativeExecutor", () => {
  it("completes from a fake model without replacing the definition", async () => {
    const model = new FakeQosModel().script({ type: "completed", text: VALID, usage: { input_tokens: 2 } });
    const runTool = vi.fn();

    const result = await runNativeExecutor({
      model,
      instructions: "menu_manager.v2",
      input: '{"schema":"qos.menu_snapshot.v1"}',
      tools: [{ name: "menu.get_health", description: "health", inputSchema: {} }],
      runTool,
      interpret,
    });

    expect(result).toEqual({
      kind: "completed",
      output: JSON.parse(VALID),
      usage: { input_tokens: 2 },
    });
    expect(runTool).not.toHaveBeenCalled();
    expect(model.requests[0]?.instructions).toBe("menu_manager.v2");
  });

  it("runs one tool round then completes", async () => {
    const model = new FakeQosModel().script(
      {
        type: "tool_calls",
        calls: [{ callId: "call_1", name: "menu.get_health", input: {} }],
        usage: { output_tokens: 1 },
      },
      { type: "completed", text: VALID, usage: { output_tokens: 4 } },
    );
    const runTool = vi.fn().mockResolvedValue({ ok: true, output: { issueCounts: {} } });

    const result = await runNativeExecutor({
      model,
      instructions: "x",
      input: "y",
      tools: [{ name: "menu.get_health", description: "health", inputSchema: {} }],
      runTool,
      interpret,
    });

    expect(result).toMatchObject({ kind: "completed", usage: { output_tokens: 5 } });
    expect(runTool).toHaveBeenCalledWith("menu.get_health", {});
    expect(model.requests[1]?.toolResults).toEqual([
      { callId: "call_1", output: { issueCounts: {} } },
    ]);
  });

  it("fails invalid JSON as billed-possible after processing", async () => {
    const model = new FakeQosModel().script({ type: "completed", text: "not json", usage: null });

    await expect(
      runNativeExecutor({
        model,
        instructions: "x",
        input: "y",
        tools: [],
        runTool: vi.fn(),
        interpret,
      }),
    ).resolves.toMatchObject({
      kind: "failed",
      outcome: "failed_after_processing",
      code: "invalid_reply",
      billedPossible: true,
    });
  });

  it("classifies a thrown model call as submission_unknown", async () => {
    const model = new FakeQosModel().script(new Error("socket reset"));

    await expect(
      runNativeExecutor({
        model,
        instructions: "x",
        input: "y",
        tools: [],
        runTool: vi.fn(),
        interpret,
      }),
    ).resolves.toMatchObject({
      kind: "failed",
      outcome: "submission_unknown",
      code: "model_submission_unknown",
      billedPossible: true,
    });
  });

  it(`stops after ${NATIVE_MAX_TOOL_ROUNDS} tool rounds`, async () => {
    const model = new FakeQosModel().script({
      type: "tool_calls",
      calls: [{ callId: "call_x", name: "menu.get_items", input: { productPublicIds: ["prd_1"] } }],
      usage: null,
    });

    await expect(
      runNativeExecutor({
        model,
        instructions: "x",
        input: "y",
        tools: [{ name: "menu.get_items", description: "items", inputSchema: {} }],
        runTool: vi.fn().mockResolvedValue({ ok: true, output: { products: [] } }),
        interpret,
      }),
    ).resolves.toMatchObject({
      kind: "failed",
      outcome: "failed_after_processing",
      code: "too_many_tool_rounds",
      billedPossible: true,
    });
    expect(model.requests).toHaveLength(NATIVE_MAX_TOOL_ROUNDS);
  });
});
