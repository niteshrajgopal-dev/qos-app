import { describe, expect, it } from "vitest";

import { FakeQosModel } from "@/lib/ai/model/fake-qos-model";

describe("FakeQosModel", () => {
  it("returns a scripted completion and records the request", async () => {
    const model = new FakeQosModel().script({
      type: "completed",
      text: '{"ok":true}',
      usage: { input_tokens: 3 },
    });

    const result = await model.complete({
      modelId: model.modelId,
      instructions: "Review the menu.",
      input: '{"menuPublicId":"men_1"}',
      tools: [],
    });

    expect(result).toEqual({ type: "completed", text: '{"ok":true}', usage: { input_tokens: 3 } });
    expect(model.requests).toHaveLength(1);
    expect(JSON.stringify(model.requests[0])).not.toMatch(/password|api[_-]?key|secret/i);
  });

  it("plays tool calls then a completion", async () => {
    const model = new FakeQosModel().script(
      {
        type: "tool_calls",
        calls: [{ callId: "call_1", name: "menu.get_health", input: {} }],
        usage: null,
      },
      { type: "completed", text: '{"schema":"qos.menu_manager_result.v1"}', usage: null },
    );

    const first = await model.complete({
      modelId: model.modelId,
      instructions: "x",
      input: "y",
      tools: [{ name: "menu.get_health", description: "health", inputSchema: {} }],
    });
    const second = await model.complete({
      modelId: model.modelId,
      instructions: "x",
      input: "y",
      tools: [],
      toolResults: [{ callId: "call_1", output: { issueCounts: {} } }],
    });

    expect(first.type).toBe("tool_calls");
    expect(second).toMatchObject({ type: "completed" });
  });

  it("rethrows a scripted failure so the loop can classify it", async () => {
    const model = new FakeQosModel().script(new Error("reset after send"));
    await expect(
      model.complete({ modelId: model.modelId, instructions: "", input: "", tools: [] }),
    ).rejects.toThrow("reset after send");
  });
});
