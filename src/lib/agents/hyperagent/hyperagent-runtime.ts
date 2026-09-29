import type { DbClient } from "@/db/client";
import type { AgentCredentialKey } from "@/lib/agents/credential-crypto";
import {
  createHyperagentToolCaller,
  type HyperagentToolCaller,
} from "@/lib/agents/hyperagent/hyperagent-mcp-client";
import {
  QosOAuthClientProvider,
  readHyperagentOAuthState,
} from "@/lib/agents/hyperagent/hyperagent-oauth";
import { HyperagentProvider } from "@/lib/agents/hyperagent/hyperagent-provider";
import {
  AgentProviderConnectionError,
  loadAgentProviderCredentials,
  markAgentProviderConnectionStatus,
  replaceAgentProviderCredentials,
  type LoadedProviderCredentials,
} from "@/lib/agents/provider-connections";
import { AgentProviderError } from "@/lib/agents/types";

async function loadConnection(db: DbClient, credentialKey: AgentCredentialKey) {
  try {
    return await loadAgentProviderCredentials(db, "hyperagent", credentialKey);
  } catch (error) {
    if (error instanceof AgentProviderConnectionError) {
      throw new AgentProviderError(
        error.code === "needs_reauth" ? "provider_reauth_required" : "provider_not_connected",
        error.message,
        { requiresReauth: error.code === "needs_reauth" },
      );
    }
    throw error;
  }
}

/**
 * Builds a tool caller whose OAuth session lives in the encrypted platform
 * connection. Refreshed tokens are written back with an optimistic version so
 * concurrent replicas cannot silently overwrite each other.
 */
export function createPersistedHyperagentToolCaller(options: {
  db: DbClient;
  credentialKey: AgentCredentialKey;
  serverUrl: string;
  /** Tests replace the network transport; production uses the MCP SDK. */
  createToolCaller?: typeof createHyperagentToolCaller;
}): HyperagentToolCaller {
  const createToolCaller = options.createToolCaller ?? createHyperagentToolCaller;
  return async (name, args) => {
    let loaded: LoadedProviderCredentials = await loadConnection(options.db, options.credentialKey);
    if (loaded.serverUrl !== options.serverUrl) {
      throw new AgentProviderError(
        "provider_misconfigured",
        "HYPERAGENT_MCP_URL does not match the server the platform connection was authorized for.",
      );
    }
    const initialState = readHyperagentOAuthState(loaded.credentials);
    if (!initialState.redirectUrl || !initialState.tokens) {
      throw new AgentProviderError(
        "provider_reauth_required",
        "The platform Hyperagent connection has no usable OAuth session.",
        { requiresReauth: true },
      );
    }

    const authProvider = new QosOAuthClientProvider({
      redirectUrl: initialState.redirectUrl,
      initialState,
      onStateChanged: async (state) => {
        const write = (expectedVersion: number) =>
          replaceAgentProviderCredentials(options.db, {
            connectionId: loaded.connectionId,
            provider: "hyperagent",
            expectedVersion,
            credentials: state,
            credentialKey: options.credentialKey,
          });

        if (await write(loaded.version)) {
          loaded = { ...loaded, version: loaded.version + 1 };
          return;
        }
        // Another replica wrote first. These tokens were just issued, so they
        // are the freshest; write them over the reloaded version once.
        loaded = await loadConnection(options.db, options.credentialKey);
        if (await write(loaded.version)) {
          loaded = { ...loaded, version: loaded.version + 1 };
        }
      },
    });

    const callTool = createToolCaller({
      serverUrl: options.serverUrl,
      authProvider,
    });

    try {
      return await callTool(name, args);
    } catch (error) {
      if (error instanceof AgentProviderError && error.requiresReauth) {
        await markAgentProviderConnectionStatus(options.db, "hyperagent", {
          status: "needs_reauth",
          errorCode: error.code,
        });
      }
      throw error;
    }
  };
}

export function createHyperagentRuntimeProvider(options: {
  db: DbClient;
  credentialKey: AgentCredentialKey;
  serverUrl: string;
}) {
  return new HyperagentProvider(createPersistedHyperagentToolCaller(options));
}
