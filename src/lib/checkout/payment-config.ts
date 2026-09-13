import type { EnvSource } from "@/lib/env";

export type PaymentsProvider = "stripe";
export type PaymentsMode = "sandbox";

export type CheckoutPaymentConfig = {
  provider: PaymentsProvider;
  mode: PaymentsMode;
  currency: string;
  returnBaseUrl: string;
  stripeCheckoutSuccessUrl?: string;
  stripeCheckoutCancelUrl?: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  stripeApiVersion: string;
  fixtureWebhookSecret?: string;
  usesServerChosenCheckoutUrls: boolean;
};

export class CheckoutPaymentConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CheckoutPaymentConfigError";
  }
}

function parseOriginList(value: string | undefined, fallback: string[]) {
  if (!value?.trim()) {
    return fallback;
  }

  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function tryParseOrigin(value: string) {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

function parseProvider(source: EnvSource): PaymentsProvider {
  const value = source.PAYMENTS_PROVIDER?.trim();
  if (!value || value === "stripe") {
    return "stripe";
  }

  throw new CheckoutPaymentConfigError(
    `Unsupported PAYMENTS_PROVIDER "${value}". Only stripe is permitted in Phase 1.`,
  );
}

function parseMode(source: EnvSource): PaymentsMode {
  const value = source.PAYMENTS_MODE?.trim();
  if (!value || value === "sandbox") {
    return "sandbox";
  }

  if (value === "live" || value === "production") {
    throw new CheckoutPaymentConfigError(
      "Live payment mode is not permitted in Phase 1.",
    );
  }

  throw new CheckoutPaymentConfigError(
    `Unsupported PAYMENTS_MODE "${value}". Only sandbox is permitted in Phase 1.`,
  );
}

function parseCurrency(source: EnvSource): string {
  const value = (source.STRIPE_CURRENCY?.trim() || "AED").toUpperCase();
  if (value !== "AED") {
    throw new CheckoutPaymentConfigError(
      `Unsupported STRIPE_CURRENCY "${value}". Only AED is permitted in Phase 1.`,
    );
  }

  return value;
}

export function buildCheckoutReturnUrl(baseUrl: string, path: string) {
  return new URL(path, `${baseUrl.replace(/\/+$/, "")}/`).toString();
}

export function readCheckoutPaymentConfig(
  source: EnvSource = process.env,
): CheckoutPaymentConfig {
  const provider = parseProvider(source);
  const mode = parseMode(source);
  const currency = parseCurrency(source);

  const returnBaseUrl =
    source.CHECKOUT_PAYMENT_RETURN_BASE_URL?.trim() ||
    source.BETTER_AUTH_URL?.trim() ||
    "http://localhost:3000";

  const stripeCheckoutSuccessUrl =
    source.STRIPE_CHECKOUT_SUCCESS_URL?.trim() || undefined;
  const stripeCheckoutCancelUrl =
    source.STRIPE_CHECKOUT_CANCEL_URL?.trim() || undefined;

  if (
    (stripeCheckoutSuccessUrl && !stripeCheckoutCancelUrl) ||
    (!stripeCheckoutSuccessUrl && stripeCheckoutCancelUrl)
  ) {
    throw new CheckoutPaymentConfigError(
      "STRIPE_CHECKOUT_SUCCESS_URL and STRIPE_CHECKOUT_CANCEL_URL must be configured together.",
    );
  }

  return {
    provider,
    mode,
    currency,
    returnBaseUrl: returnBaseUrl.replace(/\/+$/, ""),
    stripeCheckoutSuccessUrl,
    stripeCheckoutCancelUrl,
    stripeSecretKey: source.STRIPE_SECRET_KEY?.trim() || undefined,
    stripeWebhookSecret: source.STRIPE_WEBHOOK_SECRET?.trim() || undefined,
    stripeApiVersion: source.STRIPE_API_VERSION?.trim() || "2024-11-20.acacia",
    fixtureWebhookSecret:
      source.CHECKOUT_FIXTURE_WEBHOOK_SECRET?.trim() || undefined,
    usesServerChosenCheckoutUrls: Boolean(
      stripeCheckoutSuccessUrl && stripeCheckoutCancelUrl,
    ),
  };
}

export function resolveCheckoutRedirectUrls(
  config: CheckoutPaymentConfig,
  returnPath: string,
  cancelPath: string,
) {
  if (config.usesServerChosenCheckoutUrls) {
    return {
      returnUrl: config.stripeCheckoutSuccessUrl!,
      cancelUrl: config.stripeCheckoutCancelUrl!,
    };
  }

  return {
    returnUrl: buildCheckoutReturnUrl(config.returnBaseUrl, returnPath),
    cancelUrl: buildCheckoutReturnUrl(config.returnBaseUrl, cancelPath),
  };
}

export function readAllowedCheckoutReturnOrigins(
  source: EnvSource = process.env,
): string[] {
  const config = readCheckoutPaymentConfig(source);
  const fallback = ["http://localhost:3000", "http://127.0.0.1:3000"];

  const configured = parseOriginList(
    source.CHECKOUT_PAYMENT_ALLOWED_RETURN_ORIGINS,
    fallback,
  );

  const origins = new Set(configured);
  const baseOrigin = tryParseOrigin(config.returnBaseUrl);
  if (baseOrigin) {
    origins.add(baseOrigin);
  }

  if (config.stripeCheckoutSuccessUrl) {
    const successOrigin = tryParseOrigin(config.stripeCheckoutSuccessUrl);
    if (successOrigin) {
      origins.add(successOrigin);
    }
  }

  if (config.stripeCheckoutCancelUrl) {
    const cancelOrigin = tryParseOrigin(config.stripeCheckoutCancelUrl);
    if (cancelOrigin) {
      origins.add(cancelOrigin);
    }
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

export function assertSandboxStripeRuntimeReady(config: CheckoutPaymentConfig) {
  if (config.provider !== "stripe" || config.mode !== "sandbox") {
    throw new CheckoutPaymentConfigError(
      "Stripe sandbox runtime is misconfigured.",
    );
  }

  if (!config.stripeSecretKey) {
    return;
  }

  assertStripeSecretKeyIsSandboxOnly(config.stripeSecretKey);

  if (!config.stripeWebhookSecret) {
    throw new CheckoutPaymentConfigError(
      "STRIPE_WEBHOOK_SECRET is required when STRIPE_SECRET_KEY is configured.",
    );
  }
}

export function describeCheckoutPaymentConfig(config: CheckoutPaymentConfig) {
  return {
    provider: config.provider,
    mode: config.mode,
    currency: config.currency,
    stripeApiVersion: config.stripeApiVersion,
    usesServerChosenCheckoutUrls: config.usesServerChosenCheckoutUrls,
    hasStripeSecretKey: Boolean(config.stripeSecretKey),
    hasStripeWebhookSecret: Boolean(config.stripeWebhookSecret),
    hasFixtureWebhookSecret: Boolean(config.fixtureWebhookSecret),
  };
}
