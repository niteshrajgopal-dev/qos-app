import type { EnvSource } from "@/lib/env";

export type AnonymousBasketConfig = {
  sessionTtlSeconds: number;
  sessionIdleSeconds: number;
  maxLineQuantity: number;
  maxLines: number;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  if (!value?.trim()) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function readAnonymousBasketConfig(
  source: EnvSource = process.env,
): AnonymousBasketConfig {
  return {
    sessionTtlSeconds: parsePositiveInt(
      source.ANON_BASKET_SESSION_TTL_SECONDS,
      86_400,
    ),
    sessionIdleSeconds: parsePositiveInt(
      source.ANON_BASKET_SESSION_IDLE_SECONDS,
      3_600,
    ),
    maxLineQuantity: parsePositiveInt(source.ANON_BASKET_MAX_LINE_QUANTITY, 99),
    maxLines: parsePositiveInt(source.ANON_BASKET_MAX_LINES, 50),
  };
}
