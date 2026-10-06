import type { EnvSource } from "@/lib/env";

export type AgentConfig = {
  /** Master switch. Off by default so no provider call happens unless enabled. */
  enabled: boolean;
  menuManagerEnabled: boolean;
  hyperagentMcpUrl: string | null;
  /** Base64-encoded 32-byte AES-256-GCM key; null when not configured. */
  credentialEncryptionKey: string | null;
  pollIntervalMs: number;
  pollLeaseMs: number;
  runTimeoutMs: number;
  /** A queued run that never received a provider thread is failed after this. */
  queuedStaleMs: number;
  /**
   * How newly accepted Menu Manager runs execute. Unset follows the executor:
   * queued_worker for native, inline for Hyperagent. Existing runs keep the
   * mode they were accepted with.
   */
  menuManagerExecutionMode: "inline" | "queued_worker";
  /**
   * Which executor new Menu Manager runs are admitted with. Native by default;
   * Hyperagent is opt-in. Existing runs keep the executor they were accepted
   * with.
   */
  menuManagerExecutor: "hyperagent" | "native";
};

export type AgentConfigDescription = {
  enabled: boolean;
  menuManagerEnabled: boolean;
  hyperagentConfigured: boolean;
  credentialKeyConfigured: boolean;
  pollIntervalMs: number;
  runTimeoutMs: number;
  menuManagerExecutionMode: AgentConfig["menuManagerExecutionMode"];
  menuManagerExecutor: AgentConfig["menuManagerExecutor"];
};

const MIN_POLL_INTERVAL_MS = 2_000;
const MIN_POLL_LEASE_MS = 5_000;
const MAX_RUN_TIMEOUT_MS = 60 * 60_000;

function parseFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function parseDuration(
  value: string | undefined,
  fallback: number,
  bounds: { min: number; max: number },
) {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.max(parsed, bounds.min), bounds.max);
}

function parseHttpsUrl(value: string | undefined, name: string) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error(`${name} must be a valid https URL.`);
  }

  if (parsed.protocol !== "https:") {
    throw new Error(`${name} must use https.`);
  }

  return parsed.toString();
}

export function readAgentConfig(source: EnvSource = process.env): AgentConfig {
  const menuManagerExecutor = parseExecutor(source.AGENT_MENU_MANAGER_EXECUTOR);
  return {
    enabled: parseFlag(source.AGENTS_ENABLED),
    menuManagerEnabled: parseFlag(source.AGENT_MENU_MANAGER_ENABLED),
    hyperagentMcpUrl: parseHttpsUrl(source.HYPERAGENT_MCP_URL, "HYPERAGENT_MCP_URL"),
    credentialEncryptionKey: source.AGENT_CREDENTIAL_ENCRYPTION_KEY?.trim() || null,
    pollIntervalMs: parseDuration(source.AGENT_RUN_POLL_INTERVAL_MS, 5_000, {
      min: MIN_POLL_INTERVAL_MS,
      max: 60_000,
    }),
    pollLeaseMs: parseDuration(source.AGENT_RUN_POLL_LEASE_MS, 30_000, {
      min: MIN_POLL_LEASE_MS,
      max: 120_000,
    }),
    runTimeoutMs: parseDuration(source.AGENT_RUN_TIMEOUT_MS, 10 * 60_000, {
      min: 30_000,
      max: MAX_RUN_TIMEOUT_MS,
    }),
    queuedStaleMs: parseDuration(source.AGENT_RUN_QUEUED_STALE_MS, 2 * 60_000, {
      min: 30_000,
      max: 30 * 60_000,
    }),
    menuManagerExecutionMode: parseExecutionMode(
      source.AGENT_MENU_MANAGER_EXECUTION_MODE,
      menuManagerExecutor,
    ),
    menuManagerExecutor,
  };
}

function parseExecutionMode(
  value: string | undefined,
  executor: AgentConfig["menuManagerExecutor"],
): AgentConfig["menuManagerExecutionMode"] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return executor === "native" ? "queued_worker" : "inline";
  }
  if (normalized === "inline") {
    return "inline";
  }
  if (normalized === "queued_worker") {
    return "queued_worker";
  }
  throw new Error("AGENT_MENU_MANAGER_EXECUTION_MODE must be inline or queued_worker.");
}

function parseExecutor(value: string | undefined): AgentConfig["menuManagerExecutor"] {
  const normalized = value?.trim().toLowerCase();
  if (!normalized || normalized === "native") {
    return "native";
  }
  if (normalized === "hyperagent") {
    return "hyperagent";
  }
  throw new Error("AGENT_MENU_MANAGER_EXECUTOR must be hyperagent or native.");
}

export function isMenuManagerAvailable(config: AgentConfig) {
  return config.enabled && config.menuManagerEnabled;
}

/** Safe to expose: flags and timings only, never URLs or key material. */
export function describeAgentConfig(config: AgentConfig): AgentConfigDescription {
  return {
    enabled: config.enabled,
    menuManagerEnabled: config.menuManagerEnabled,
    hyperagentConfigured: config.hyperagentMcpUrl !== null,
    credentialKeyConfigured: config.credentialEncryptionKey !== null,
    pollIntervalMs: config.pollIntervalMs,
    runTimeoutMs: config.runTimeoutMs,
    menuManagerExecutionMode: config.menuManagerExecutionMode,
    menuManagerExecutor: config.menuManagerExecutor,
  };
}
