import type { EnvSource } from "@/lib/env";

export type QosMcpConfig = {
  /** Off by default. Does not listen on a network when on. */
  enabled: boolean;
};

function parseFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export function readQosMcpConfig(source: EnvSource = process.env): QosMcpConfig {
  return { enabled: parseFlag(source.AGENT_MCP_ADAPTER_ENABLED) };
}