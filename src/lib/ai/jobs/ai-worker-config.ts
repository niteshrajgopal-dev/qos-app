import type { EnvSource } from "@/lib/env";

/**
 * AI worker configuration. Concurrency caps have no defaults: they are owner
 * decisions (ADR-AI-02 owner decision 6) and the worker refuses to run until
 * they are set. Timings have conservative, bounded defaults.
 */
export type AiWorkerConfig = {
  enabled: boolean;
  concurrency: number | null;
  maxActiveGlobal: number | null;
  maxActivePerTenant: number | null;
  maxActivePerKind: number | null;
  leaseMs: number;
  pollIntervalMs: number;
};

export type AiWorkerReadiness =
  | {
      ready: true;
      limits: { concurrency: number; maxActiveGlobal: number; maxActivePerTenant: number; maxActivePerKind: number };
    }
  | { ready: false; missing: string[] };

const CAP_ENV = {
  concurrency: "AI_WORKER_CONCURRENCY",
  maxActiveGlobal: "AI_WORKER_MAX_ACTIVE_GLOBAL",
  maxActivePerTenant: "AI_WORKER_MAX_ACTIVE_PER_TENANT",
  maxActivePerKind: "AI_WORKER_MAX_ACTIVE_PER_KIND",
} as const;

function parseCap(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed || !/^\d+$/.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return parsed >= 1 && parsed <= 1_000 ? parsed : null;
}

function parseBounded(value: string | undefined, fallback: number, bounds: { min: number; max: number }) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return fallback;
  }
  if (!/^\d+$/.test(trimmed)) {
    throw new Error(`Invalid AI worker setting: ${trimmed}`);
  }
  return Math.min(Math.max(Number(trimmed), bounds.min), bounds.max);
}

export function readAiWorkerConfig(source: EnvSource = process.env): AiWorkerConfig {
  const flag = source.AI_WORKER_ENABLED?.trim().toLowerCase();
  return {
    enabled: flag === "true" || flag === "1",
    concurrency: parseCap(source[CAP_ENV.concurrency]),
    maxActiveGlobal: parseCap(source[CAP_ENV.maxActiveGlobal]),
    maxActivePerTenant: parseCap(source[CAP_ENV.maxActivePerTenant]),
    maxActivePerKind: parseCap(source[CAP_ENV.maxActivePerKind]),
    leaseMs: parseBounded(source.AI_WORKER_LEASE_MS, 60_000, { min: 15_000, max: 600_000 }),
    pollIntervalMs: parseBounded(source.AI_WORKER_POLL_INTERVAL_MS, 5_000, { min: 1_000, max: 60_000 }),
  };
}

export function aiWorkerReadiness(config: AiWorkerConfig): AiWorkerReadiness {
  const missing: string[] = [];
  if (!config.enabled) {
    missing.push("AI_WORKER_ENABLED");
  }
  for (const key of Object.keys(CAP_ENV) as (keyof typeof CAP_ENV)[]) {
    if (config[key] === null) {
      missing.push(CAP_ENV[key]);
    }
  }
  if (
    missing.length > 0 ||
    config.concurrency === null ||
    config.maxActiveGlobal === null ||
    config.maxActivePerTenant === null ||
    config.maxActivePerKind === null
  ) {
    return { ready: false, missing };
  }
  return {
    ready: true,
    limits: {
      concurrency: config.concurrency,
      maxActiveGlobal: config.maxActiveGlobal,
      maxActivePerTenant: config.maxActivePerTenant,
      maxActivePerKind: config.maxActivePerKind,
    },
  };
}
