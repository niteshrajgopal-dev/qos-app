import type { EnvSource } from "@/lib/env";

export type CheckoutQuoteConfig = {
  quoteTtlSeconds: number;
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

export function readCheckoutQuoteConfig(
  source: EnvSource = process.env,
): CheckoutQuoteConfig {
  return {
    quoteTtlSeconds: parsePositiveInt(source.CHECKOUT_QUOTE_TTL_SECONDS, 900),
  };
}
