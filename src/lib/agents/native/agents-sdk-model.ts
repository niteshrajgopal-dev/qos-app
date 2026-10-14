import { setTracingDisabled } from "@openai/agents";
import OpenAI from "openai";

import type { NativeModelConfig } from "@/lib/agents/native/native-model-config";
import { redactOpenAiSecrets } from "@/lib/agents/native/openai-redaction";
import { aliasOpenAiToolNames, qosToolNameFromOpenAi } from "@/lib/agents/native/openai-tool-names";
import { parseRetryAfterMs } from "@/lib/ai/provider-outcome";
import type { QosModel, QosModelRequest, QosModelResult } from "@/lib/ai/model/qos-model";

setTracingDisabled(true);

export type OpenAiChatClient = Pick<OpenAI, "chat">;

export type AgentsSdkModelOptions = {
  client?: OpenAiChatClient;
  maxAttempts?: number;
  sleepMs?: (ms: number) => Promise<void>;
};

const DEFAULT_MAX_ATTEMPTS = 3;

function isRetryableOpenAiError(error: unknown) {
  if (!error || typeof error !== "object") {
    return false;
  }
  const record = error as { status?: number; code?: string; name?: string };
  if (record.status === 429) {
    return true;
  }
  if (typeof record.status === "number" && record.status >= 500) {
    return true;
  }
  if (record.code === "ETIMEDOUT" || record.code === "ECONNRESET") {
    return true;
  }
  if (record.name === "TimeoutError" || record.name === "APIConnectionError") {
    return true;
  }
  return false;
}

function retryAfterFromError(error: unknown) {
  if (!error || typeof error !== "object") {
    return null;
  }
  const headers = (error as { headers?: Headers }).headers;
  return headers ? parseRetryAfterMs(headers) : null;
}

function invalidCompletionResponse(response: OpenAI.Chat.Completions.ChatCompletion) {
  if (!response || typeof response !== "object") {
    return true;
  }
  if (!Array.isArray(response.choices) || response.choices.length === 0) {
    return true;
  }
  const message = response.choices[0]?.message;
  if (!message) {
    return true;
  }
  const hasText = typeof message.content === "string" && message.content.length > 0;
  const hasTools = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return !hasText && !hasTools;
}

/**
 * Agents SDK / OpenAI client adapter. Tracing is off. The client never retries;
 * QOS owns retries. SDK types do not leave this file.
 */
export function createAgentsSdkModel(
  config: NativeModelConfig,
  options: AgentsSdkModelOptions = {},
): QosModel {
  if (config.provider !== "openai" || !config.openAiApiKey) {
    throw new Error("Native OpenAI model is not configured.");
  }

  const client =
    options.client ??
    new OpenAI({ apiKey: config.openAiApiKey, maxRetries: 0, timeout: 120_000 });
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const sleep = options.sleepMs ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    provider: "openai",
    modelId: config.modelId,
    async complete(request: QosModelRequest): Promise<QosModelResult> {
      if (request.modelId !== config.modelId) {
        throw new Error("model_not_approved");
      }

      const userContent = request.toolResults?.length
        ? `${request.input}\n\nTool results:\n${JSON.stringify(request.toolResults)}`
        : request.input;
      const aliases = aliasOpenAiToolNames(request.tools.map((tool) => tool.name));
      const correlationId = request.correlationId?.trim() || undefined;

      let lastError: unknown;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          const response = await client.chat.completions.create(
            {
              model: config.modelId,
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
            },
            correlationId ? { headers: { "X-Client-Request-Id": correlationId } } : undefined,
          );

          if (invalidCompletionResponse(response)) {
            throw new Error("invalid_openai_completion");
          }

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
        } catch (error) {
          lastError = error;
          const retryable = isRetryableOpenAiError(error) || (error instanceof Error && error.message === "invalid_openai_completion");
          if (!retryable || attempt >= maxAttempts) {
            if (error instanceof Error) {
              error.message = redactOpenAiSecrets(error.message);
            }
            throw error;
          }
          const retryAfterMs = retryAfterFromError(error);
          await sleep(retryAfterMs ?? 50 * attempt);
        }
      }

      if (lastError instanceof Error) {
        lastError.message = redactOpenAiSecrets(lastError.message);
      }
      throw lastError;
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
