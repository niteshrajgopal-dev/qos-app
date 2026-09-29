import { z } from "zod";

import type { HyperagentToolCaller } from "@/lib/agents/hyperagent/hyperagent-mcp-client";
import {
  AgentProviderError,
  type AgentDescriptor,
  type AgentRunObservation,
  type AgentRuntimeProvider,
  type StartAgentRunInput,
} from "@/lib/agents/types";

const PROVIDER_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_START_MESSAGE_CHARS = 400_000;
export const MAX_FINAL_MESSAGE_CHARS = 200_000;
const THREAD_MESSAGE_LIMIT = 20;

const providerId = z.string().regex(PROVIDER_ID_PATTERN);

const listAgentsResponse = z.object({
  agents: z.array(
    z.object({
      id: providerId,
      name: z.string().max(500),
      description: z.string().max(5_000).nullish(),
    }),
  ),
});

const createThreadResponse = z.union([
  z.object({ threadId: providerId }),
  z.object({ thread: z.object({ id: providerId }) }),
  z.object({ id: providerId }),
]);

const threadMessage = z.object({
  role: z.string(),
  content: z.string().nullish(),
});

const getThreadResponse = z.object({
  thread: z.object({ id: providerId }),
  messages: z.array(threadMessage),
  isRunning: z.boolean(),
  awaitingApproval: z.boolean(),
});

function parseResponse<T>(schema: z.ZodType<T>, tool: string, payload: unknown): T {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new AgentProviderError(
      "invalid_provider_response",
      `Hyperagent ${tool} returned an unexpected shape.`,
    );
  }
  return parsed.data;
}

/**
 * Interprets a thread read. `awaitingApproval` wins over `isRunning` because
 * Hyperagent records the pause moments before the turn finishes.
 */
export function observeHyperagentThread(
  thread: z.infer<typeof getThreadResponse>,
): AgentRunObservation {
  if (thread.awaitingApproval) {
    return { state: "awaiting_approval" };
  }
  if (thread.isRunning) {
    return { state: "running" };
  }

  const conversational = thread.messages.filter(
    (message) => message.role === "assistant" || message.role === "user",
  );
  const last = conversational.at(-1);

  // The agent may not have picked up the opening message yet; the run
  // deadline bounds how long QOS keeps waiting.
  if (!last || last.role !== "assistant") {
    return { state: "running" };
  }

  const finalMessage = last.content?.trim() ?? "";
  if (!finalMessage) {
    return {
      state: "failed",
      code: "empty_final_message",
      message: "Hyperagent finished without a final assistant message.",
    };
  }
  if (finalMessage.length > MAX_FINAL_MESSAGE_CHARS) {
    return {
      state: "failed",
      code: "final_message_too_large",
      message: "Hyperagent's final message exceeded the size QOS accepts.",
    };
  }

  return { state: "completed", finalMessage };
}

export class HyperagentProvider implements AgentRuntimeProvider {
  readonly kind = "hyperagent" as const;
  private readonly callTool: HyperagentToolCaller;

  constructor(callTool: HyperagentToolCaller) {
    this.callTool = callTool;
  }

  async listAgents(): Promise<AgentDescriptor[]> {
    const payload = await this.callTool("list_agents", {});
    const { agents } = parseResponse(listAgentsResponse, "list_agents", payload);
    return agents.map((agent) => ({
      providerAgentId: agent.id,
      name: agent.name,
      description: agent.description ?? null,
    }));
  }

  async startRun(input: StartAgentRunInput): Promise<{ providerThreadId: string }> {
    if (!PROVIDER_ID_PATTERN.test(input.providerAgentId)) {
      throw new AgentProviderError("invalid_agent_id", "The provider agent id is invalid.");
    }
    if (!input.message.trim() || input.message.length > MAX_START_MESSAGE_CHARS) {
      throw new AgentProviderError("invalid_message", "The run message is empty or too large.");
    }

    // Hyperagent has no idempotency key; QOS's own run row prevents a second start.
    const payload = await this.callTool("create_thread", {
      agentId: input.providerAgentId,
      message: input.message,
    });
    const parsed = parseResponse(createThreadResponse, "create_thread", payload);
    const providerThreadId =
      "threadId" in parsed ? parsed.threadId : "thread" in parsed ? parsed.thread.id : parsed.id;
    return { providerThreadId };
  }

  async getRun(input: { providerThreadId: string }): Promise<AgentRunObservation> {
    if (!PROVIDER_ID_PATTERN.test(input.providerThreadId)) {
      throw new AgentProviderError("invalid_thread_id", "The provider thread id is invalid.");
    }

    const payload = await this.callTool("get_thread", {
      threadId: input.providerThreadId,
      messageLimit: THREAD_MESSAGE_LIMIT,
    });
    const thread = parseResponse(getThreadResponse, "get_thread", payload);
    if (thread.thread.id !== input.providerThreadId) {
      throw new AgentProviderError(
        "invalid_provider_response",
        "Hyperagent returned a different thread than requested.",
      );
    }
    return observeHyperagentThread(thread);
  }
}
