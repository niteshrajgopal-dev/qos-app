import {
  AgentProviderError,
  type AgentProviderKind,
  type AgentRuntimeProvider,
} from "@/lib/agents/types";

let providerOverride: AgentRuntimeProvider | null = null;

/** Tests inject a fake provider so no real provider is ever invoked. */
export function setAgentRuntimeProviderForTesting(provider: AgentRuntimeProvider | null) {
  providerOverride = provider;
}

export function getAgentRuntimeProvider(kind: AgentProviderKind): AgentRuntimeProvider {
  if (providerOverride) {
    if (providerOverride.kind !== kind) {
      throw new AgentProviderError(
        "provider_unavailable",
        `No ${kind} provider is registered.`,
      );
    }
    return providerOverride;
  }

  throw new AgentProviderError(
    "provider_unavailable",
    `The ${kind} provider is not available in this environment.`,
  );
}
