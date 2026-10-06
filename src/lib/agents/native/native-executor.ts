import type { QosModel, QosModelRequest, QosModelResult } from "@/lib/ai/model/qos-model";
import type { ProviderOutcome } from "@/lib/ai/provider-outcome";

export const NATIVE_MAX_TOOL_ROUNDS = 4;

export type NativeToolSpec = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type NativeToolRunner = (
  name: string,
  input: unknown,
) => Promise<{ ok: true; output: unknown } | { ok: false; code: string; message: string }>;

export type NativeInterpret = (
  text: string,
) =>
  | { ok: true; result: Record<string, unknown> }
  | { ok: false; code: string; message: string; rawResultExcerpt: string };

export type NativeExecutorStepResult =
  | { kind: "completed"; output: Record<string, unknown>; usage: Record<string, number> | null }
  | {
      kind: "failed";
      outcome: ProviderOutcome;
      code: string;
      message: string;
      billedPossible: boolean;
    };

export type NativeExecutorInput = {
  model: QosModel;
  instructions: string;
  input: string;
  tools: readonly NativeToolSpec[];
  runTool: NativeToolRunner;
  interpret: NativeInterpret;
};

function mergeUsage(
  into: Record<string, number> | null,
  next: Record<string, number> | null,
): Record<string, number> | null {
  if (!next) {
    return into;
  }
  const merged = { ...(into ?? {}) };
  for (const [key, value] of Object.entries(next)) {
    if (Number.isInteger(value) && value >= 0) {
      merged[key] = (merged[key] ?? 0) + value;
    }
  }
  return merged;
}

/**
 * QOS-owned native loop. One worker step runs at most four model rounds.
 * SDK Runner objects are not used here; the model adapter is injected.
 */
export async function runNativeExecutor(input: NativeExecutorInput): Promise<NativeExecutorStepResult> {
  let usage: Record<string, number> | null = null;
  let toolResults: QosModelRequest["toolResults"];

  for (let round = 0; round < NATIVE_MAX_TOOL_ROUNDS; round += 1) {
    let result: QosModelResult;
    try {
      result = await input.model.complete({
        modelId: input.model.modelId,
        instructions: input.instructions,
        input: input.input,
        tools: input.tools,
        ...(toolResults ? { toolResults } : {}),
      });
    } catch {
      return {
        kind: "failed",
        outcome: "submission_unknown",
        code: "model_submission_unknown",
        message: "QOS could not confirm whether the model accepted this review.",
        billedPossible: true,
      };
    }

    usage = mergeUsage(usage, result.usage);

    if (result.type === "completed") {
      const interpreted = input.interpret(result.text);
      if (!interpreted.ok) {
        return {
          kind: "failed",
          outcome: "failed_after_processing",
          code: interpreted.code,
          message: interpreted.message,
          billedPossible: true,
        };
      }
      return { kind: "completed", output: interpreted.result, usage };
    }

    const nextResults: Array<{ callId: string; output: unknown }> = [];
    for (const call of result.calls) {
      const tool = await input.runTool(call.name, call.input);
      nextResults.push({
        callId: call.callId,
        output: tool.ok ? tool.output : { error: tool.code, message: tool.message },
      });
    }
    toolResults = nextResults;
  }

  return {
    kind: "failed",
    outcome: "failed_after_processing",
    code: "too_many_tool_rounds",
    message: "The review asked for too many tool calls.",
    billedPossible: true,
  };
}
