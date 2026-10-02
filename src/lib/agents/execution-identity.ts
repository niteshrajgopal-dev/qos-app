import type { AgentExecutionIdentity } from "@/lib/ai/execution-identity";
import type { AgentProviderKind } from "@/lib/agents/types";

/**
 * Compatibility mapping from the persisted `agent_provider` column to execution
 * identity. Existing rows keep their stored value; this table says what it
 * means. Hyperagent does not disclose which model served a thread, so model
 * identity is recorded as unknown rather than guessed.
 */
export const PERSISTED_AGENT_PROVIDER_IDENTITY = {
  hyperagent: {
    executorKind: "external",
    executorAdapter: "hyperagent",
    adapterVersion: "hyperagent-mcp.v1",
    modelProvider: null,
    modelId: null,
  },
} as const satisfies Record<AgentProviderKind, AgentExecutionIdentity>;

export function executionIdentityForPersistedProvider(
  provider: AgentProviderKind,
): AgentExecutionIdentity {
  return PERSISTED_AGENT_PROVIDER_IDENTITY[provider];
}
