import type { EnvSource } from "@/lib/env";

export type CheckoutPaymentConfig = {
  returnBaseUrl: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripeApiVersion: string;
  fixtureWebhookSecret?: string;
};

function parseOriginList(value: string | undefined, fallback: string[]) {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function readCheckoutPaymentConfig(
  source: EnvSource = process.env,
): CheckoutPaymentConfig {
  const returnBaseUrl =
    source.CHECKOUT_PAYMENT_RETURN_BASE_URL?.trim() ||
    source.BETTER_AUTH_URL?.trim() ||
    "http://localhost:3000";

  return {
    returnBaseUrl: returnBaseUrl.replace(/\/+$/, ""),
    stripeSecretKey: source.STRIPE_SECRET_KEY?.trim() || undefined,
    stripeWebhookSecret: source.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    stripeApiVersion: source.STRIPE_API_VERSION?.trim() || "2024-11-20.acacia",
    fixtureWebhookSecret:
      source.CHECKOUT_FIXTURE_WEBHOOK_SECRET?.trim() || undefined,
  };
}

export function readAllowedCheckoutReturnOrigins(
  source: EnvSource = process.env,
): string[] {
  const fallback = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
  ];

  const configured = parseOriginList(
    source.CHECKOUT_PAYMENT_ALLOWED_RETURN_ORIGINS,
    fallback,
  );

  const baseOrigin = (() => {
    try {
      return new URL(readCheckoutPaymentConfig(source).returnBaseUrl).origin;
    } catch {
      return undefined;
    }
  })();

  const origins = new Set(configured);
  if (baseOrigin) {
    origins.add(baseOrigin);
  }

  return [...origins];
}

export function assertStripeSecretKeyIsSandboxOnly(secretKey: string) {
  if (secretKey.startsWith("sk_live_")) {
    throw new Error("Live Stripe secret keys are not permitted in Phase 1.");
  }

  if (!secretKey.startsWith("sk_test_")) {
    throw new Error("Stripe secret key must be a sandbox test key.");
  }
}
