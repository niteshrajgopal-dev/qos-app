import type { DbClient } from "@/db/client";
import {
  getAgentProviderConnectionStatus,
  markAgentProviderConnectionStatus,
} from "@/lib/agents/provider-connections";
import { isNativeModelConfigured } from "@/lib/agents/native/native-model-config";
import type { AgentConnectionStatus, AgentProviderKind } from "@/lib/agents/types";

/**
 * Executor used when no tenant binding names one. This is the Hyperagent
 * connection lookup, not the Menu Manager admission default (that is native).
 */
export const DEFAULT_AGENT_PROVIDER: AgentProviderKind = "hyperagent";

export type AgentExecutorReadiness = {
  provider: AgentProviderKind;
  ready: boolean;
  /** Status of the operator-owned platform connection the executor needs. */
  connection: { status: AgentConnectionStatus; lastCheckedAt: string | null };
};

type ReadinessAdapter = {
  check(db: DbClient): Promise<AgentExecutorReadiness>;
  reportReauthRequired(db: DbClient, errorCode: string): Promise<void>;
};

/**
 * Per-executor readiness. Only executors that depend on an external platform
 * connection consult `agent_provider_connections`; this module deliberately
 * does not import adapter code.
 */
const READINESS: Record<AgentProviderKind, ReadinessAdapter> = {
  hyperagent: {
    async check(db) {
      const connection = await getAgentProviderConnectionStatus(db, "hyperagent");
      return {
        provider: "hyperagent",
        ready: connection.status === "connected",
        connection: { status: connection.status, lastCheckedAt: connection.lastCheckedAt },
      };
    },
    async reportReauthRequired(db, errorCode) {
      await markAgentProviderConnectionStatus(db, "hyperagent", {
        status: "needs_reauth",
        errorCode,
      });
    },
  },
  agents_sdk: {
    async check() {
      const ready = isNativeModelConfigured();
      return {
        provider: "agents_sdk",
        ready,
        connection: { status: ready ? "connected" : "disconnected", lastCheckedAt: null },
      };
    },
    async reportReauthRequired() {
      // Native uses an operator-owned API key, not a reconnectable OAuth connection.
    },
  },
};

export function getAgentExecutorReadiness(db: DbClient, provider: AgentProviderKind) {
  return READINESS[provider].check(db);
}

export function reportAgentExecutorReauthRequired(
  db: DbClient,
  provider: AgentProviderKind,
  errorCode: string,
) {
  return READINESS[provider].reportReauthRequired(db, errorCode);
}
