/**
 * QOS-30 provider-backed verification helper.
 * Never prints secret values. Safe to run in CI without Stripe credentials.
 */

import Stripe from "stripe";

import {
  CheckoutPaymentConfigError,
  describeCheckoutPaymentConfig,
  readCheckoutPaymentConfig,
} from "../src/lib/checkout/payment-config";

type VerificationResult = {
  name: string;
  ok: boolean;
  detail: string;
};

const DEFAULT_WEBHOOK_URL =
  "https://ca-qos-dev-api.gentleplant-cc8574e8.uaenorth.azurecontainerapps.io/api/webhooks/stripe/checkout";

function record(
  results: VerificationResult[],
  name: string,
  ok: boolean,
  detail: string,
) {
  results.push({ name, ok, detail });
  const prefix = ok ? "PASS" : "FAIL";
  console.log(`${prefix} ${name}: ${detail}`);
}

async function verifyRuntimeConfig(results: VerificationResult[]) {
  try {
    const config = readCheckoutPaymentConfig();
    const summary = describeCheckoutPaymentConfig(config);
    record(
      results,
      "runtime-config",
      true,
      `provider=${summary.provider} mode=${summary.mode} currency=${summary.currency} apiVersion=${summary.stripeApiVersion} serverUrls=${summary.usesServerChosenCheckoutUrls} hasSecretKey=${summary.hasStripeSecretKey} hasWebhookSecret=${summary.hasStripeWebhookSecret}`,
    );
    return config;
  } catch (error) {
    const message =
      error instanceof CheckoutPaymentConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : "Unknown config error";
    record(results, "runtime-config", false, message);
    return null;
  }
}

async function verifyStripeConnectivity(
  results: VerificationResult[],
  config: NonNullable<Awaited<ReturnType<typeof verifyRuntimeConfig>>>,
) {
  if (!config.stripeSecretKey) {
    record(
      results,
      "stripe-connectivity",
      true,
      "Skipped — STRIPE_SECRET_KEY not configured (fixture mode).",
    );
    return;
  }

  try {
    const stripe = new Stripe(config.stripeSecretKey, {
      apiVersion: config.stripeApiVersion as Stripe.LatestApiVersion,
    });
    const balance = await stripe.balance.retrieve();

    record(
      results,
      "stripe-connectivity",
      !balance.livemode,
      balance.livemode
        ? "Stripe account responded in live mode."
        : "Stripe sandbox account reachable (livemode=false).",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Stripe request failed";
    record(results, "stripe-connectivity", false, message);
  }
}

async function verifyWebhookEndpoint(results: VerificationResult[]) {
  const webhookUrl = process.env.STRIPE_WEBHOOK_VERIFY_URL?.trim() || DEFAULT_WEBHOOK_URL;

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await response.text();

    if (response.status === 404) {
      record(
        results,
        "webhook-endpoint",
        false,
        `HTTP 404 — deploy latest API image before treating this as a signature-validation test. URL=${webhookUrl}`,
      );
      return;
    }

    const expectsSignatureFailure =
      response.status === 400 && body.includes("Stripe webhook signature");

    record(
      results,
      "webhook-endpoint",
      expectsSignatureFailure,
      expectsSignatureFailure
        ? `HTTP 400 signature validation reached handler. URL=${webhookUrl}`
        : `Unexpected HTTP ${response.status} from webhook endpoint. URL=${webhookUrl}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Webhook request failed";
    record(results, "webhook-endpoint", false, message);
  }
}

async function main() {
  const results: VerificationResult[] = [];
  const config = await verifyRuntimeConfig(results);

  if (config) {
    await verifyStripeConnectivity(results, config);
  }

  await verifyWebhookEndpoint(results);

  const failed = results.filter((result) => !result.ok);
  if (failed.length > 0) {
    console.error(`\nVerification finished with ${failed.length} failing check(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("\nVerification finished successfully.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
