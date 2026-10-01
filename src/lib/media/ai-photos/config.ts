import type { EnvSource } from "@/lib/env";

export const AI_PHOTO_QUALITIES = ["low", "medium", "high"] as const;
export type AiPhotoQuality = (typeof AI_PHOTO_QUALITIES)[number];

export type AiPhotoProviderKind = "openai" | "mock";

export type AiPhotoConfig = {
  /** Off by default: no paid provider call is made unless explicitly enabled. */
  enabled: boolean;
  /** "mock" renders a placeholder locally with no network call; refused in production. */
  provider: AiPhotoProviderKind;
  openAiApiKey: string | null;
  model: string;
  quality: AiPhotoQuality;
  /** Generation attempts (including failures) allowed per tenant per rolling 24 hours. */
  dailyLimitPerTenant: number;
  requestTimeoutMs: number;
};

export type AiPhotoUnavailableReason = "disabled" | "not_configured";

const DEFAULT_MODEL = "gpt-image-1";
/** Only the GPT Image family is supported: its request/response shape is what the adapter speaks. */
const APPROVED_MODEL_PATTERN = /^gpt-image-[a-z0-9][a-z0-9.-]{0,40}$/;

function parseFlag(value: string | undefined) {
  const normalized = value?.trim().toLowerCase();
  return normalized === "true" || normalized === "1";
}

function parseBoundedInt(
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

export function readAiPhotoConfig(source: EnvSource = process.env): AiPhotoConfig {
  const model = source.AI_PHOTO_MODEL?.trim() || DEFAULT_MODEL;
  if (!APPROVED_MODEL_PATTERN.test(model)) {
    throw new Error("AI_PHOTO_MODEL must be a gpt-image model id.");
  }

  const quality = (source.AI_PHOTO_QUALITY?.trim().toLowerCase() || "low") as AiPhotoQuality;
  if (!AI_PHOTO_QUALITIES.includes(quality)) {
    throw new Error(`AI_PHOTO_QUALITY must be one of ${AI_PHOTO_QUALITIES.join(", ")}.`);
  }

  const provider = (source.AI_PHOTO_PROVIDER?.trim().toLowerCase() || "openai") as AiPhotoProviderKind;
  if (provider !== "openai" && provider !== "mock") {
    throw new Error("AI_PHOTO_PROVIDER must be openai or mock.");
  }
  if (provider === "mock" && source.NODE_ENV === "production") {
    throw new Error("AI_PHOTO_PROVIDER=mock is for local development only.");
  }

  return {
    enabled: parseFlag(source.AI_PHOTOS_ENABLED),
    provider,
    openAiApiKey: source.OPENAI_API_KEY?.trim() || null,
    model,
    quality,
    dailyLimitPerTenant: parseBoundedInt(source.AI_PHOTO_DAILY_LIMIT_PER_TENANT, 20, {
      min: 1,
      max: 500,
    }),
    requestTimeoutMs: parseBoundedInt(source.AI_PHOTO_REQUEST_TIMEOUT_MS, 120_000, {
      min: 10_000,
      max: 180_000,
    }),
  };
}

export function aiPhotoUnavailableReason(
  config: AiPhotoConfig,
  options: { providerOverride?: boolean } = {},
): AiPhotoUnavailableReason | null {
  if (!config.enabled) {
    return "disabled";
  }
  if (config.provider === "openai" && !config.openAiApiKey && !options.providerOverride) {
    return "not_configured";
  }
  return null;
}
