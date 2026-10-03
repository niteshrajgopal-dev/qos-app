import { db as appDb } from "@/db";
import type { DbClient } from "@/db/client";
import { readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { createHyperagentRuntimeProvider } from "@/lib/agents/hyperagent/hyperagent-runtime";
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

export function getAgentRuntimeProvider(
  kind: AgentProviderKind,
  options: { db?: DbClient; config?: AgentConfig } = {},
): AgentRuntimeProvider {
  if (providerOverride) {
    if (providerOverride.kind !== kind) {
      throw new AgentProviderError(
        "provider_unavailable",
        `No ${kind} provider is registered.`,
        { outcome: "not_dispatched" },
      );
    }
    return providerOverride;
  }

  const config = options.config ?? readAgentConfig();
  if (
    kind === "hyperagent" &&
    config.enabled &&
    config.hyperagentMcpUrl &&
    config.credentialEncryptionKey
  ) {
    return createHyperagentRuntimeProvider({
      db: options.db ?? appDb,
      credentialKey: parseAgentCredentialKey(config.credentialEncryptionKey),
      serverUrl: config.hyperagentMcpUrl,
    });
  }

  throw new AgentProviderError(
    "provider_unavailable",
    `The ${kind} provider is not available in this environment.`,
    { outcome: "not_dispatched" },
  );
}
