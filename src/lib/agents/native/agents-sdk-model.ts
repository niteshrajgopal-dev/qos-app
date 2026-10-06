import { setTracingDisabled } from "@openai/agents";
import OpenAI from "openai";

import type { NativeModelConfig } from "@/lib/agents/native/native-model-config";
import { aliasOpenAiToolNames, qosToolNameFromOpenAi } from "@/lib/agents/native/openai-tool-names";
import type { QosModel, QosModelRequest, QosModelResult } from "@/lib/ai/model/qos-model";

setTracingDisabled(true);

/**
 * Agents SDK / OpenAI client adapter. Tracing is off. The client never retries;
 * QOS owns retries. SDK types do not leave this file.
 */
export function createAgentsSdkModel(config: NativeModelConfig): QosModel {
  if (config.provider !== "openai" || !config.openAiApiKey) {
    throw new Error("Native OpenAI model is not configured.");
  }

  const client = new OpenAI({ apiKey: config.openAiApiKey, maxRetries: 0 });

  return {
    provider: "openai",
    modelId: config.modelId,
    async complete(request: QosModelRequest): Promise<QosModelResult> {
      const userContent = request.toolResults?.length
        ? `${request.input}\n\nTool results:\n${JSON.stringify(request.toolResults)}`
        : request.input;
      const aliases = aliasOpenAiToolNames(request.tools.map((tool) => tool.name));

      const response = await client.chat.completions.create({
        model: request.modelId,
        messages: [
          { role: "system", content: request.instructions },
          { role: "user", content: userContent },
        ],
        ...(request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: "function" as const,
                function: {
                  name: aliases.toProvider.get(tool.name) ?? tool.name,
                  description: tool.description,
                  parameters: tool.inputSchema,
                },
              })),
            }
          : {}),
        store: false,
      });

      const message = response.choices[0]?.message;
      const usage = response.usage
        ? {
            input_tokens: response.usage.prompt_tokens,
            output_tokens: response.usage.completion_tokens,
            total_tokens: response.usage.total_tokens,
          }
        : null;

      const toolCalls = message?.tool_calls?.filter((call) => call.type === "function") ?? [];
      if (toolCalls.length > 0) {
        return {
          type: "tool_calls",
          usage,
          calls: toolCalls.map((call) => ({
            callId: call.id,
            name: qosToolNameFromOpenAi(call.function.name, aliases),
            input: parseToolInput(call.function.arguments),
          })),
        };
      }

      return { type: "completed", text: message?.content ?? "", usage };
    },
  };
}

function parseToolInput(raw: string) {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return {};
  }
}