import type { EnvSource } from "@/lib/env";
import { readAiPhotoConfig } from "@/lib/media/ai-photos/config";

/**
 * Spend admission policy for new paid AI paths (ADR-AI-02 decision 16).
 *
 * There are deliberately no default values. A path is admissible only when it
 * is explicitly enabled and every limit it depends on is set; otherwise new
 * paid work on it is refused. All limits are application quotas and
 * concurrency bounds, never an external invoice ceiling.
 */

export const AI_SPEND_PATHS = ["ai_photo.async", "menu_manager.native"] as const;
export type AiSpendPath = (typeof AI_SPEND_PATHS)[number];

export const AI_SPEND_PROVIDERS = ["openai"] as const;
export type AiSpendProvider = (typeof AI_SPEND_PROVIDERS)[number];

export const AI_SPEND_PATH_LIMITS = [
  "maxUnitsPerRun",
  "tenantDailyUnits",
  "tenantMonthlyUnits",
  "tenantConcurrency",
  "platformDailyUnits",
  "platformMonthlyUnits",
  "unstartedExpiryMs",
] as const;
export type AiSpendPathLimit = (typeof AI_SPEND_PATH_LIMITS)[number];

export type AiSpendLimitValue =
  | { status: "set"; value: number }
  | { status: "unset" }
  | { status: "invalid" };

export type AiSpendPathPolicy = {
  enabled: boolean;
  limits: Record<AiSpendPathLimit, AiSpendLimitValue>;
};

export type AiSpendPolicy = {
  platformConcurrency: AiSpendLimitValue;
  providerConcurrency: Record<AiSpendProvider, AiSpendLimitValue>;
  paths: Record<AiSpendPath, AiSpendPathPolicy>;
};

export type AiSpendAdmissibleLimits = Record<AiSpendPathLimit, number> & {
  platformConcurrency: number;
  providerConcurrency: number;
};

export type AiSpendReadiness =
  | { admissible: true; limits: AiSpendAdmissibleLimits }
  | { admissible: false; missing: string[] };

const MAX_LIMIT = 1_000_000_000;
const MIN_UNSTARTED_EXPIRY_MS = 60_000;
const MAX_UNSTARTED_EXPIRY_MS = 7 * 24 * 60 * 60_000;

const LIMIT_SUFFIX: Record<AiSpendPathLimit, string> = {
  maxUnitsPerRun: "MAX_UNITS_PER_RUN",
  tenantDailyUnits: "TENANT_DAILY_UNITS",
  tenantMonthlyUnits: "TENANT_MONTHLY_UNITS",
  tenantConcurrency: "TENANT_CONCURRENCY",
  platformDailyUnits: "PLATFORM_DAILY_UNITS",
  platformMonthlyUnits: "PLATFORM_MONTHLY_UNITS",
  unstartedExpiryMs: "UNSTARTED_EXPIRY_MS",
};

function envPrefix(path: AiSpendPath) {
  return `AI_SPEND_${path.replace(/[^a-z0-9]+/gi, "_").toUpperCase()}_`;
}

export function aiSpendEnvName(path: AiSpendPath, limit: AiSpendPathLimit | "enabled") {
  return `${envPrefix(path)}${limit === "enabled" ? "ENABLED" : LIMIT_SUFFIX[limit]}`;
}

export function aiSpendProviderEnvName(provider: AiSpendProvider) {
  return `AI_SPEND_PROVIDER_${provider.toUpperCase()}_CONCURRENCY`;
}

export const AI_SPEND_PLATFORM_CONCURRENCY_ENV = "AI_SPEND_PLATFORM_CONCURRENCY";

/** Strict: anything but a plain positive integer in range is invalid, never clamped or defaulted. */
function parseLimit(
  value: string | undefined,
  bounds: { min: number; max: number } = { min: 1, max: MAX_LIMIT },
): AiSpendLimitValue {
  const trimmed = value?.trim();
  if (!trimmed) {
    return { status: "unset" };
  }
  if (!/^\d+$/.test(trimmed)) {
    return { status: "invalid" };
  }
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < bounds.min || parsed > bounds.max) {
    return { status: "invalid" };
  }
  return { status: "set", value: parsed };
}

function parseFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

export function readAiSpendPolicy(source: EnvSource = process.env): AiSpendPolicy {
  const paths = {} as Record<AiSpendPath, AiSpendPathPolicy>;
  for (const path of AI_SPEND_PATHS) {
    const limits = {} as Record<AiSpendPathLimit, AiSpendLimitValue>;
    for (const limit of AI_SPEND_PATH_LIMITS) {
      limits[limit] = parseLimit(
        source[aiSpendEnvName(path, limit)],
        limit === "unstartedExpiryMs"
          ? { min: MIN_UNSTARTED_EXPIRY_MS, max: MAX_UNSTARTED_EXPIRY_MS }
          : undefined,
      );
    }
    paths[path] = { enabled: parseFlag(source[aiSpendEnvName(path, "enabled")]), limits };
  }

  const providerConcurrency = {} as Record<AiSpendProvider, AiSpendLimitValue>;
  for (const provider of AI_SPEND_PROVIDERS) {
    providerConcurrency[provider] = parseLimit(source[aiSpendProviderEnvName(provider)]);
  }

  return {
    platformConcurrency: parseLimit(source[AI_SPEND_PLATFORM_CONCURRENCY_ENV]),
    providerConcurrency,
    paths,
  };
}

export function isAiSpendPath(value: string): value is AiSpendPath {
  return (AI_SPEND_PATHS as readonly string[]).includes(value);
}

export function isAiSpendProvider(value: string): value is AiSpendProvider {
  return (AI_SPEND_PROVIDERS as readonly string[]).includes(value);
}

/** Whether new paid work on a path and provider may be admitted at all. */
export function aiSpendReadiness(
  policy: AiSpendPolicy,
  path: AiSpendPath,
  provider: AiSpendProvider,
): AiSpendReadiness {
  const pathPolicy = policy.paths[path];
  const missing: string[] = [];
  if (!pathPolicy.enabled) {
    missing.push(aiSpendEnvName(path, "enabled"));
  }
  const values = {} as Record<AiSpendPathLimit, number>;
  for (const limit of AI_SPEND_PATH_LIMITS) {
    const entry = pathPolicy.limits[limit];
    if (entry.status === "set") {
      values[limit] = entry.value;
    } else {
      missing.push(aiSpendEnvName(path, limit));
    }
  }
  const platform = policy.platformConcurrency;
  if (platform.status !== "set") {
    missing.push(AI_SPEND_PLATFORM_CONCURRENCY_ENV);
  }
  const providerLimit = policy.providerConcurrency[provider];
  if (providerLimit.status !== "set") {
    missing.push(aiSpendProviderEnvName(provider));
  }

  if (missing.length > 0 || platform.status !== "set" || providerLimit.status !== "set") {
    return { admissible: false, missing };
  }
  return {
    admissible: true,
    limits: {
      ...values,
      platformConcurrency: platform.value,
      providerConcurrency: providerLimit.value,
    },
  };
}

export type AiSpendPolicyDescription = {
  quotaKind: "application_quota";
  platformConcurrency: AiSpendLimitValue;
  providerConcurrency: Record<AiSpendProvider, AiSpendLimitValue>;
  paths: Record<
    AiSpendPath,
    {
      enabled: boolean;
      admissibleProviders: AiSpendProvider[];
      limits: Record<AiSpendPathLimit, AiSpendLimitValue>;
    }
  >;
  existing: {
    interactiveAiPhotos: {
      dailyLimitPerTenant: number;
      source: "explicit" | "built_in_default";
      governance: "existing_setting_pending_review";
    };
  };
};

/**
 * The effective configuration, safe to show to operators: numbers and flags
 * only. The interactive AI photo limit is reported as-is; it predates this
 * policy and keeps working pending owner review.
 */
export function describeAiSpendPolicy(source: EnvSource = process.env): AiSpendPolicyDescription {
  const policy = readAiSpendPolicy(source);
  const paths = {} as AiSpendPolicyDescription["paths"];
  for (const path of AI_SPEND_PATHS) {
    paths[path] = {
      enabled: policy.paths[path].enabled,
      admissibleProviders: AI_SPEND_PROVIDERS.filter(
        (provider) => aiSpendReadiness(policy, path, provider).admissible,
      ),
      limits: policy.paths[path].limits,
    };
  }

  const explicitPhotoLimit = parseLimit(source.AI_PHOTO_DAILY_LIMIT_PER_TENANT);
  return {
    quotaKind: "application_quota",
    platformConcurrency: policy.platformConcurrency,
    providerConcurrency: policy.providerConcurrency,
    paths,
    existing: {
      interactiveAiPhotos: {
        dailyLimitPerTenant: readAiPhotoConfig(source).dailyLimitPerTenant,
        source: explicitPhotoLimit.status === "set" ? "explicit" : "built_in_default",
        governance: "existing_setting_pending_review",
      },
    },
  };
}
