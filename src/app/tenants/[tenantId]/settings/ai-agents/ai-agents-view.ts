import type { TenantAgentSettingsView } from "@/lib/agents/tenant-agent-settings";
import type { AgentConnectionStatus } from "@/lib/agents/types";

type BadgeTone = "info" | "success" | "warning" | "error" | "neutral";

type StatusCopy = { tone: BadgeTone; label: string; description: string };

export const CONNECTION_STATUS_COPY: Record<AgentConnectionStatus, StatusCopy> = {
  connected: {
    tone: "success",
    label: "Connected",
    description: "QOS can start agent reviews.",
  },
  needs_reauth: {
    tone: "warning",
    label: "Reconnecting",
    description: "QOS needs to renew its agent connection. Reviews are paused until it does.",
  },
  error: {
    tone: "error",
    label: "Unavailable",
    description: "QOS's agent service reported a problem. Reviews are paused.",
  },
  disconnected: {
    tone: "neutral",
    label: "Not connected",
    description: "QOS has not connected an agent service yet.",
  },
};

export function menuManagerStatusCopy(agents: TenantAgentSettingsView): StatusCopy {
  switch (agents.menuManager.unavailableReason) {
    case null:
      return {
        tone: "success",
        label: "On",
        description: "Staff can ask for a review from any draft menu's health panel.",
      };
    case "feature_off":
      return {
        tone: "neutral",
        label: "Not available",
        description: "AI agents are turned off in this QOS environment.",
      };
    case "not_configured":
      return {
        tone: "neutral",
        label: "Not set up",
        description: "QOS has not approved a Menu Manager for this business yet.",
      };
    case "disabled":
      return {
        tone: "neutral",
        label: "Off",
        description: "Menu Manager is approved for this business but turned off.",
      };
    case "not_connected":
      return {
        tone: "warning",
        label: "Paused",
        description: "Menu Manager is on, but QOS's agent service is not connected right now.",
      };
  }
}
