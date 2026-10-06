import type { EnvSource } from "@/lib/env";
import { isNativeModelConfigured, readNativeModelConfig } from "@/lib/agents/native/native-model-config";
import { aiSpendReadiness, readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";

export const NATIVE_SMOKE_EVENT = "native_menu_manager.smoke";

export type NativeSmokeArgs = {
  confirm: boolean;
  tenantId: string;
  menuPublicId: string;
  operator: string;
  databaseHost: string;
};

export type NativeSmokeReadiness =
  | { ready: true; provider: "openai"; modelId: string }
  | { ready: false; missing: string[] };

export type NativeSmokeEvidence = {
  event: typeof NATIVE_SMOKE_EVENT;
  authorized: true;
  ci: false;
  provider: "openai";
  modelId: string;
  executor: "native";
  executionMode: "queued_worker";
  definitionVersion: string;
  runStatus: string;
  jobResult: string;
  spendState: string | null;
  spendOutcome: string | null;
  reportedUsage: Record<string, number> | null;
  latencyMs: number;
  productCount: number;
  snapshotTruncated: boolean;
  toolsAllowed: string[];
};

const USAGE_KEY = /^[a-z][a-z0-9_]{0,63}$/;

function parseFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function requireFlag(argv: string[], name: string) {
  const index = argv.indexOf(`--${name}`);
  const value = index >= 0 ? argv[index + 1] : undefined;
  if (!value || value.startsWith("--")) {
    throw new Error(`--${name} is required.`);
  }
  return value;
}

/** Owner-gated real-provider smoke. Mock and unset spend never count as evidence. */
export function nativeSmokeReadiness(source: EnvSource): NativeSmokeReadiness {
  const missing: string[] = [];
  if (!parseFlag(source.AGENT_NATIVE_SMOKE)) {
    missing.push("AGENT_NATIVE_SMOKE");
  }
  if (!parseFlag(source.AGENTS_ENABLED)) {
    missing.push("AGENTS_ENABLED");
  }
  if (!parseFlag(source.AGENT_MENU_MANAGER_ENABLED)) {
    missing.push("AGENT_MENU_MANAGER_ENABLED");
  }

  try {
    const model = readNativeModelConfig(source);
    if (model.provider !== "openai") {
      missing.push("AGENT_NATIVE_MODEL_PROVIDER");
    } else if (!isNativeModelConfigured(source)) {
      missing.push("native_openai_key");
    }
  } catch {
    missing.push("AGENT_NATIVE_MODEL");
  }

  const spend = aiSpendReadiness(readAiSpendPolicy(source), "menu_manager.native", "openai");
  if (!spend.admissible) {
    missing.push(...spend.missing);
  }

  if (missing.length > 0) {
    return { ready: false, missing };
  }

  const model = readNativeModelConfig(source);
  return { ready: true, provider: "openai", modelId: model.modelId };
}

export function parseNativeSmokeArgs(argv: string[]): NativeSmokeArgs {
  if (!argv.includes("--confirm")) {
    throw new Error("--confirm is required. This command contacts the paid provider.");
  }
  return {
    confirm: true,
    tenantId: requireFlag(argv, "tenant"),
    menuPublicId: requireFlag(argv, "menu"),
    operator: requireFlag(argv, "operator"),
    databaseHost: requireFlag(argv, "database-host"),
  };
}

function integerUsage(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const usage: Record<string, number> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (USAGE_KEY.test(key) && Number.isInteger(entry) && (entry as number) >= 0) {
      usage[key] = entry as number;
    }
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** Allowlisted smoke evidence. Prompts, keys, snapshots and tool payloads are dropped. */
export function redactNativeSmokeEvidence(raw: Record<string, unknown>): NativeSmokeEvidence {
  return {
    event: NATIVE_SMOKE_EVENT,
    authorized: true,
    ci: false,
    provider: "openai",
    modelId: typeof raw.modelId === "string" ? raw.modelId : "",
    executor: "native",
    executionMode: "queued_worker",
    definitionVersion: typeof raw.definitionVersion === "string" ? raw.definitionVersion : "",
    runStatus: typeof raw.runStatus === "string" ? raw.runStatus : "",
    jobResult: typeof raw.jobResult === "string" ? raw.jobResult : "",
    spendState: typeof raw.spendState === "string" ? raw.spendState : null,
    spendOutcome: typeof raw.spendOutcome === "string" ? raw.spendOutcome : null,
    reportedUsage: integerUsage(raw.reportedUsage),
    latencyMs: Number.isInteger(raw.latencyMs) ? (raw.latencyMs as number) : 0,
    productCount: Number.isInteger(raw.productCount) ? (raw.productCount as number) : 0,
    snapshotTruncated: raw.snapshotTruncated === true,
    toolsAllowed: stringList(raw.toolsAllowed),
  };
}
