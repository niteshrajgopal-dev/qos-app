export type AgentProviderKind = "hyperagent";

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
 * Provider-neutral runtime. There is intentionally no approval-resolution
 * operation: approvals of protected actions belong to QOS, never the provider.
 */
export interface AgentRuntimeProvider {
  readonly kind: AgentProviderKind;
  listAgents(): Promise<AgentDescriptor[]>;
  startRun(input: StartAgentRunInput): Promise<{ providerThreadId: string }>;
  getRun(input: { providerThreadId: string }): Promise<AgentRunObservation>;
}

export class AgentProviderError extends Error {
  readonly code: string;
  /** True when the platform connection must be re-authorized by an operator. */
  readonly requiresReauth: boolean;

  constructor(code: string, message: string, options: { requiresReauth?: boolean } = {}) {
    super(message);
    this.name = "AgentProviderError";
    this.code = code;
    this.requiresReauth = options.requiresReauth ?? false;
  }
}
