import type { AgentExecutionIdentity } from "@/lib/ai/execution-identity";
import {
  classifyProviderFailure,
  type ProviderFailureClassification,
  type ProviderOutcome,
} from "@/lib/ai/provider-outcome";

/** Persisted `agent_provider` value. See `execution-identity.ts` for what it means. */
export type AgentProviderKind = "hyperagent" | "agents_sdk";

export type AgentCapability = "menu_manager";

export type AgentRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "completed"
  | "failed";

export const ACTIVE_AGENT_RUN_STATUSES = ["queued", "running"] as const;

export const FINAL_AGENT_RUN_STATUSES = [
  "awaiting_approval",
  "completed",
  "failed",
] as const;

export type AgentConnectionStatus =
  | "disconnected"
  | "connected"
  | "needs_reauth"
  | "error";

export type AgentDescriptor = {
  providerAgentId: string;
  name: string;
  description: string | null;
};

export type StartAgentRunInput = {
  providerAgentId: string;
  /** Complete, self-contained task text for the provider. */
  message: string;
  /** Stable per QOS run so a provider retry cannot fork a second thread. */
  idempotencyKey: string;
};

/**
 * What QOS observed about a provider run on one poll. `awaiting_approval`
 * means the provider wants a human decision; QOS records it and stops.
 */
export type AgentRunObservation =
  | { state: "running" }
  | { state: "awaiting_approval" }
  | { state: "completed"; finalMessage: string }
  | { state: "failed"; code: string; message: string };

/**
 * What an executor adapter can actually do. Callers must not assume a
 * capability that is not declared; an adapter never claims more than it has.
 */
export type AgentExecutorCapabilities = {
  /** `strict_schema`: the provider enforces the schema. `prompted_json`: QOS validates afterwards. */
  structuredOutput: "strict_schema" | "prompted_json";
  /** `qos_gateway`: tool calls go through the QOS tool gateway. */
  toolCalls: "none" | "qos_gateway";
  /** `local_stop_only`: QOS stops its own loop; the provider is not told. */
  cancellation: "none" | "local_stop_only" | "provider_confirmed";
  continuation: boolean;
  usageReporting: boolean;
  /** `none`: a lost submit response may leave remote work QOS cannot dedupe. */
  submitIdempotency: "none" | "provider_key";
};

/**
 * Provider-neutral runtime. There is intentionally no approval-resolution
 * operation: approvals of protected actions belong to QOS, never the provider.
 */
export interface AgentRuntimeProvider {
  readonly kind: AgentProviderKind;
  readonly identity: AgentExecutionIdentity;
  readonly capabilities: AgentExecutorCapabilities;
  listAgents(): Promise<AgentDescriptor[]>;
  startRun(input: StartAgentRunInput): Promise<{ providerThreadId: string }>;
  getRun(input: { providerThreadId: string }): Promise<AgentRunObservation>;
}

export type AgentProviderErrorOptions = {
  requiresReauth?: boolean;
  /**
   * Defaults to `submission_unknown`: without evidence, QOS must assume the
   * provider may have accepted the work.
   */
  outcome?: ProviderOutcome;
  retryable?: boolean;
  retryAfterMs?: number | null;
};

export class AgentProviderError extends Error {
  readonly code: string;
  /** True when the platform connection must be re-authorized by an operator. */
  readonly requiresReauth: boolean;
  readonly classification: ProviderFailureClassification;

  constructor(code: string, message: string, options: AgentProviderErrorOptions = {}) {
    super(message);
    this.name = "AgentProviderError";
    this.code = code;
    this.requiresReauth = options.requiresReauth ?? false;
    this.classification = classifyProviderFailure(options.outcome ?? "submission_unknown", {
      retryable: options.retryable,
      retryAfterMs: options.retryAfterMs,
    });
  }

  get outcome(): ProviderOutcome {
    return this.classification.outcome;
  }
}
