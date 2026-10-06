import type { AgentExecutionIdentity, ModelProvider } from "@/lib/ai/execution-identity";
import type { AgentProviderKind } from "@/lib/agents/types";

export const NATIVE_ADAPTER_VERSION = "agents-sdk.v1";
export const NATIVE_PROVIDER_AGENT_ID = "qos.menu_manager";

/**
 * Compatibility mapping from the persisted `agent_provider` column to execution
 * identity. Existing rows keep their stored value; this table says what it
 * means. Hyperagent does not disclose which model served a thread, so model
 * identity is recorded as unknown rather than guessed. Native runs overwrite
 * model fields from config at admission; they are never guessed later.
 */
export const PERSISTED_AGENT_PROVIDER_IDENTITY = {
  hyperagent: {
    executorKind: "external",
    executorAdapter: "hyperagent",
    adapterVersion: "hyperagent-mcp.v1",
    modelProvider: null,
    modelId: null,
  },
  agents_sdk: {
    executorKind: "native",
    executorAdapter: "agents_sdk",
    adapterVersion: NATIVE_ADAPTER_VERSION,
    modelProvider: null,
    modelId: null,
  },
} as const satisfies Record<AgentProviderKind, AgentExecutionIdentity>;

export function executionIdentityForPersistedProvider(
  provider: AgentProviderKind,
): AgentExecutionIdentity {
  return PERSISTED_AGENT_PROVIDER_IDENTITY[provider];
}

export function executionIdentityForNative(model: {
  provider: ModelProvider;
  modelId: string;
}): AgentExecutionIdentity {
  return {
    executorKind: "native",
    executorAdapter: "agents_sdk",
    adapterVersion: NATIVE_ADAPTER_VERSION,
    modelProvider: model.provider,
    modelId: model.modelId,
  };
}
