import type { DbClient } from "@/db/client";
import { isMenuManagerAvailable, readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import {
  DEFAULT_AGENT_PROVIDER,
  getAgentExecutorReadiness,
} from "@/lib/agents/executor-readiness";
import { getTenantAgentBinding } from "@/lib/agents/tenant-agent-bindings";
import type { AgentConnectionStatus } from "@/lib/agents/types";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";

export type MenuManagerUnavailableReason =
  | "feature_off"
  | "not_configured"
  | "disabled"
  | "not_connected";

/**
 * What a tenant may see about its agents. Read-only facts about the platform
 * connection; no URLs, account details, agent IDs or credentials.
 */
export type TenantAgentSettingsView = {
  canManage: boolean;
  connection: { status: AgentConnectionStatus; lastCheckedAt: string | null };
  menuManager: {
    featureEnabled: boolean;
    binding: { publicId: string; enabled: boolean; version: number; approvedAt: string } | null;
    available: boolean;
    unavailableReason: MenuManagerUnavailableReason | null;
  };
};

function unavailableReason(
  featureEnabled: boolean,
  binding: TenantAgentSettingsView["menuManager"]["binding"],
  connection: AgentConnectionStatus,
): MenuManagerUnavailableReason | null {
  if (!featureEnabled) {
    return "feature_off";
  }
  if (!binding) {
    return "not_configured";
  }
  if (!binding.enabled) {
    return "disabled";
  }
  if (connection !== "connected") {
    return "not_connected";
  }
  return null;
}

export async function getTenantAgentSettings(
  db: DbClient,
  tenantId: string,
  membership: ActiveStaffMembership,
  options: { config?: AgentConfig } = {},
): Promise<TenantAgentSettingsView> {
  const config = options.config ?? readAgentConfig();
  const featureEnabled = isMenuManagerAvailable(config);
  const row = await withTenantContext(db, tenantId, (tx) =>
    getTenantAgentBinding(tx, tenantId, "menu_manager"),
  );
  const { connection } = await getAgentExecutorReadiness(
    db,
    row?.provider ?? DEFAULT_AGENT_PROVIDER,
  );

  const binding = row
    ? { publicId: row.publicId, enabled: row.enabled, version: row.version, approvedAt: row.approvedAt }
    : null;
  const reason = unavailableReason(featureEnabled, binding, connection.status);

  return {
    canManage: membership.role === "administrator",
    connection,
    menuManager: {
      featureEnabled,
      binding,
      available: reason === null,
      unavailableReason: reason,
    },
  };
}
