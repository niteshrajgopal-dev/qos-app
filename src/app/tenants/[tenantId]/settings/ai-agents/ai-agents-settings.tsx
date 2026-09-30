"use client";

import { useCallback, useEffect, useState } from "react";

import {
  CONNECTION_STATUS_COPY,
  menuManagerStatusCopy,
} from "@/app/tenants/[tenantId]/settings/ai-agents/ai-agents-view";
import { Alert } from "@/components/Alert";
import { Badge } from "@/components/Badge";
import { Card } from "@/components/Card";
import { Switch } from "@/design-system/components/primitives/Switch";
import type { TenantAgentSettingsView } from "@/lib/agents/tenant-agent-settings";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type AiAgentsSettingsProps = {
  tenantId: string;
};

type SettingsPayload = { agents?: TenantAgentSettingsView; error?: string };

export function AiAgentsSettings({ tenantId }: AiAgentsSettingsProps) {
  const [agents, setAgents] = useState<TenantAgentSettingsView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await staffApiFetch(`/api/tenants/${tenantId}/agents`);
      const payload = (await response.json().catch(() => ({}))) as SettingsPayload;
      if (!response.ok || !payload.agents) {
        throw new Error(payload.error ?? "Unable to load agent settings.");
      }
      setAgents(payload.agents);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Unable to load agent settings.");
    }
  }, [tenantId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function setEnabled(enabled: boolean) {
    const binding = agents?.menuManager.binding;
    if (!binding) {
      return;
    }
    setSaving(true);
    try {
      const response = await staffApiFetch(`/api/tenants/${tenantId}/agents/bindings/menu_manager`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled, expectedVersion: binding.version }),
      });
      const payload = (await response.json().catch(() => ({}))) as SettingsPayload;
      if (!response.ok || !payload.agents) {
        throw new Error(payload.error ?? "Unable to update Menu Manager.");
      }
      setAgents(payload.agents);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to update Menu Manager.");
      await load();
    } finally {
      setSaving(false);
    }
  }

  if (!agents) {
    return error ? (
      <Alert tone="error" title="Agent settings unavailable">
        {error}
      </Alert>
    ) : (
      <p className="qos-card-sub">Loading agent settings…</p>
    );
  }

  const connection = CONNECTION_STATUS_COPY[agents.connection.status];
  const menuManager = menuManagerStatusCopy(agents);
  const binding = agents.menuManager.binding;

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 720 }}>
      {error ? (
        <Alert tone="error" title="Menu Manager">
          {error}
        </Alert>
      ) : null}

      <Card
        header="QOS agent service"
        subtitle="QOS connects and maintains this platform-wide. It cannot be connected or disconnected from here."
        actions={<Badge tone={connection.tone}>{connection.label}</Badge>}
      >
        <p className="qos-card-sub">
          {connection.description}
          {agents.connection.lastCheckedAt
            ? ` Last checked ${new Date(agents.connection.lastCheckedAt).toLocaleString()}.`
            : ""}
        </p>
      </Card>

      <Card
        header="Menu Manager"
        subtitle="Reviews draft menus for missing photos, descriptions, translations, prices, categories, modifiers, availability and duplicates."
        actions={<Badge tone={menuManager.tone}>{menuManager.label}</Badge>}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <p className="qos-card-sub">{menuManager.description}</p>

          {binding ? (
            <Switch
              label="Allow staff to ask Menu Manager"
              description={
                agents.canManage
                  ? "Staff with access to a menu's locations can ask for a review."
                  : "Only administrators can change this."
              }
              checked={binding.enabled}
              disabled={!agents.canManage || saving}
              onChange={(event) => void setEnabled(event.target.checked)}
            />
          ) : null}

          <Alert tone="info" title="What is shared">
            When someone asks for a review, QOS sends the approved agent a snapshot of that menu:
            item names, descriptions, prices, variants, modifier groups, categories, availability
            and QOS&apos;s own health checks. It uses public IDs only and never includes customer,
            payment or staff details. Suggestions come back as drafts; nothing is changed
            automatically.
          </Alert>
        </div>
      </Card>
    </div>
  );
}
