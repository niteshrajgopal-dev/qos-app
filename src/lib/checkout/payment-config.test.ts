import { describe, expect, it } from "vitest";

import {
  assertSandboxStripeRuntimeReady,
  assertStripeSecretKeyIsSandboxOnly,
  CheckoutPaymentConfigError,
  describeCheckoutPaymentConfig,
  readAllowedCheckoutReturnOrigins,
  readCheckoutPaymentConfig,
  resolveCheckoutRedirectUrls,
} from "@/lib/checkout/payment-config";

describe("checkout payment config", () => {
  it("defaults to stripe sandbox AED", () => {
    const config = readCheckoutPaymentConfig({});

    expect(config.provider).toBe("stripe");
    expect(config.mode).toBe("sandbox");
    expect(config.currency).toBe("AED");
    expect(config.usesServerChosenCheckoutUrls).toBe(false);
  });

  it("rejects unsupported providers and live mode", () => {
    expect(() =>
      readCheckoutPaymentConfig({ PAYMENTS_PROVIDER: "paypal" }),
    ).toThrow(CheckoutPaymentConfigError);

    expect(() =>
      readCheckoutPaymentConfig({ PAYMENTS_MODE: "live" }),
    ).toThrow(/Live payment mode/);

    expect(() =>
      readCheckoutPaymentConfig({ STRIPE_CURRENCY: "GBP" }),
    ).toThrow(/Only AED/);
  });

  it("requires checkout success and cancel URLs together", () => {
    expect(() =>
      readCheckoutPaymentConfig({
        STRIPE_CHECKOUT_SUCCESS_URL:
          "https://storefront.example/checkout/success?session_id={CHECKOUT_SESSION_ID}",
      }),
    ).toThrow(/configured together/);
  });

  it("prefers server-chosen Stripe redirect URLs when configured", () => {
    const config = readCheckoutPaymentConfig({
      PAYMENTS_PROVIDER: "stripe",
      PAYMENTS_MODE: "sandbox",
      STRIPE_CURRENCY: "AED",
      STRIPE_CHECKOUT_SUCCESS_URL:
        "https://storefront.example/checkout/success?session_id={CHECKOUT_SESSION_ID}",
      STRIPE_CHECKOUT_CANCEL_URL: "https://storefront.example/checkout/cancelled",
    });

    const urls = resolveCheckoutRedirectUrls(
      config,
      "/checkout/ignored-success",
      "/checkout/ignored-cancel",
    );

    expect(urls.returnUrl).toBe(config.stripeCheckoutSuccessUrl);
    expect(urls.cancelUrl).toBe(config.stripeCheckoutCancelUrl);
    expect(config.usesServerChosenCheckoutUrls).toBe(true);
  });

  it("includes configured storefront origins in the allowlist", () => {
    const origins = readAllowedCheckoutReturnOrigins({
      STRIPE_CHECKOUT_SUCCESS_URL:
        "https://ca-qos-dev-storefront.example/checkout/success?session_id={CHECKOUT_SESSION_ID}",
      STRIPE_CHECKOUT_CANCEL_URL:
        "https://ca-qos-dev-storefront.example/checkout/cancelled",
    });

    expect(origins).toContain("https://ca-qos-dev-storefront.example");
  });

  it("rejects live Stripe keys and requires webhook secret with sandbox key", () => {
    expect(() =>
      assertStripeSecretKeyIsSandboxOnly("sk_live_example"),
    ).toThrow(/Live Stripe/);

    expect(() =>
      assertSandboxStripeRuntimeReady(
        readCheckoutPaymentConfig({
          PAYMENTS_PROVIDER: "stripe",
          PAYMENTS_MODE: "sandbox",
          STRIPE_SECRET_KEY: "sk_test_example",
        }),
      ),
    ).toThrow(/STRIPE_WEBHOOK_SECRET/);

    expect(() =>
      assertSandboxStripeRuntimeReady(
        readCheckoutPaymentConfig({
          PAYMENTS_PROVIDER: "stripe",
          PAYMENTS_MODE: "sandbox",
          STRIPE_SECRET_KEY: "sk_test_example",
          STRIPE_WEBHOOK_SECRET: "whsec_example",
        }),
      ),
    ).not.toThrow();
  });

  it("describes config without exposing secret values", () => {
    const summary = describeCheckoutPaymentConfig(
      readCheckoutPaymentConfig({
        STRIPE_SECRET_KEY: "sk_test_example",
        STRIPE_WEBHOOK_SECRET: "whsec_example",
      }),
    );

    expect(summary.hasStripeSecretKey).toBe(true);
    expect(summary.hasStripeWebhookSecret).toBe(true);
    expect(JSON.stringify(summary)).not.toContain("sk_test_example");
    expect(JSON.stringify(summary)).not.toContain("whsec_example");
  });
});
