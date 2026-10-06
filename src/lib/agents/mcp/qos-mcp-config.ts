import type { EnvSource } from "@/lib/env";

export const QOS_MCP_APPROVED_CLIENT = "qos.operator.mcp.v1";

export type QosMcpConfig = {
  /** Off by default. Does not listen on a network when on. */
  enabled: boolean;
  /** Null until the one approved client name is set. */
  approvedClient: typeof QOS_MCP_APPROVED_CLIENT | null;
};

function parseFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function parseApprovedClient(value: string | undefined): QosMcpConfig["approvedClient"] {
  const normalized = value?.trim();
  if (!normalized) {
    return null;
  }
  if (normalized === QOS_MCP_APPROVED_CLIENT) {
    return QOS_MCP_APPROVED_CLIENT;
  }
  throw new Error(`AGENT_MCP_APPROVED_CLIENT must be ${QOS_MCP_APPROVED_CLIENT}.`);
}

export function readQosMcpConfig(source: EnvSource = process.env): QosMcpConfig {
  return {
    enabled: parseFlag(source.AGENT_MCP_ADAPTER_ENABLED),
    approvedClient: parseApprovedClient(source.AGENT_MCP_APPROVED_CLIENT),
  };
}