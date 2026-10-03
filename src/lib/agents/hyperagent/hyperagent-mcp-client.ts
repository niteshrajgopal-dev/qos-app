import { UnauthorizedError } from "@modelcontextprotocol/sdk/client/auth.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StreamableHTTPClientTransport,
  StreamableHTTPError,
} from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { QosOAuthClientProvider } from "@/lib/agents/hyperagent/hyperagent-oauth";
import { AgentProviderError } from "@/lib/agents/types";
import type { ProviderOutcome } from "@/lib/ai/provider-outcome";

/**
 * The only Hyperagent tools QOS may call. Approval resolution is deliberately
 * absent: QOS never approves or denies anything on the provider's behalf.
 */
export const HYPERAGENT_ALLOWED_TOOLS = ["list_agents", "create_thread", "get_thread"] as const;

export type HyperagentToolName = (typeof HYPERAGENT_ALLOWED_TOOLS)[number];

/** Calls one tool and returns its parsed JSON payload. */
export type HyperagentToolCaller = (
  name: HyperagentToolName,
  args: Record<string, unknown>,
) => Promise<unknown>;

const MAX_TOOL_RESULT_CHARS = 1_000_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;

const READ_TOOLS: ReadonlySet<string> = new Set(["list_agents", "get_thread"]);

/**
 * Outcome when a tool call fails after it may have reached Hyperagent. Reads
 * are safe to repeat; `create_thread` (and anything unrecognised) may have
 * created a paid thread QOS cannot see, because it takes no idempotency key.
 */
export function hyperagentFailureOutcome(name: string): ProviderOutcome {
  return READ_TOOLS.has(name) ? "read_failed" : "submission_unknown";
}

function assertAllowedTool(name: string): asserts name is HyperagentToolName {
  if (!(HYPERAGENT_ALLOWED_TOOLS as readonly string[]).includes(name)) {
    throw new AgentProviderError("tool_not_allowed", `Tool ${name} is not allowed.`, {
      outcome: "not_dispatched",
    });
  }
}

type ToolResultLike = {
  isError?: boolean;
  structuredContent?: unknown;
  content?: unknown;
};

/** Extracts the JSON payload from an MCP `CallToolResult`. */
export function parseHyperagentToolResult(name: string, result: ToolResultLike): unknown {
  const textBlocks = Array.isArray(result.content)
    ? result.content.filter(
        (block): block is { type: "text"; text: string } =>
          typeof block === "object" &&
          block !== null &&
          (block as { type?: unknown }).type === "text" &&
          typeof (block as { text?: unknown }).text === "string",
      )
    : [];
  const text = textBlocks.map((block) => block.text).join("");

  // A tool error result does not prove `create_thread` made no thread.
  const failedAfterReach = { outcome: hyperagentFailureOutcome(name), retryable: true };

  if (result.isError) {
    throw new AgentProviderError(
      "provider_tool_error",
      `Hyperagent ${name} failed: ${text.slice(0, 300) || "no detail"}`,
      failedAfterReach,
    );
  }

  if (result.structuredContent !== undefined && result.structuredContent !== null) {
    return result.structuredContent;
  }

  if (text.length > MAX_TOOL_RESULT_CHARS) {
    throw new AgentProviderError(
      "invalid_provider_response",
      `Hyperagent ${name} response is too large.`,
      failedAfterReach,
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new AgentProviderError(
      "invalid_provider_response",
      `Hyperagent ${name} did not return JSON.`,
      failedAfterReach,
    );
  }
}

/**
 * Maps a transport failure to a classified provider error. `phase` is
 * `connect` until the tool request is handed to the transport: failures before
 * then prove the tool call was never sent.
 */
export function classifyHyperagentTransportError(
  name: string,
  error: unknown,
  context: { reauthRequired: boolean; phase: "connect" | "call" },
) {
  if (error instanceof AgentProviderError) {
    return error;
  }
  if (
    context.reauthRequired ||
    error instanceof UnauthorizedError ||
    (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403))
  ) {
    return new AgentProviderError(
      "provider_reauth_required",
      "The platform Hyperagent connection must be re-authorized by an operator.",
      { requiresReauth: true, outcome: "rejected" },
    );
  }
  const detail = error instanceof Error ? error.message.slice(0, 300) : "unknown error";
  return new AgentProviderError("provider_request_failed", `Hyperagent ${name} failed: ${detail}`, {
    outcome: context.phase === "connect" ? "not_dispatched" : hyperagentFailureOutcome(name),
    retryable: true,
  });
}

/**
 * Real MCP transport. Each call opens a short Streamable HTTP session so no
 * connection state survives between request-driven polls.
 */
export function createHyperagentToolCaller(options: {
  serverUrl: string;
  authProvider: QosOAuthClientProvider;
  requestTimeoutMs?: number;
}): HyperagentToolCaller {
  const url = new URL(options.serverUrl);

  return async (name, args) => {
    assertAllowedTool(name);

    const client = new Client({ name: "qos-platform", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(url, {
      authProvider: options.authProvider,
    });
    const timeout = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    let phase: "connect" | "call" = "connect";

    try {
      await client.connect(transport, { timeout });
      phase = "call";
      const result = await client.callTool({ name, arguments: args }, undefined, { timeout });
      return parseHyperagentToolResult(name, result as ToolResultLike);
    } catch (error) {
      throw classifyHyperagentTransportError(name, error, {
        reauthRequired: options.authProvider.reauthRequired,
        phase,
      });
    } finally {
      await client.close().catch(() => undefined);
    }
  };
}
