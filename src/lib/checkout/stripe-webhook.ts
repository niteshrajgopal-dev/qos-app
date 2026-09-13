import Stripe from "stripe";

import type { DbClient } from "@/db/client";
import {
  assertSandboxStripeRuntimeReady,
  readCheckoutPaymentConfig,
} from "@/lib/checkout/payment-config";
import {
  CheckoutWebhookError,
  processVerifiedStripeCheckoutEvent,
} from "@/lib/checkout/checkout-payment-outcome";

export async function handleStripeCheckoutWebhook(
  db: DbClient,
  rawBody: string,
  signatureHeader: string | null,
) {
  const config = readCheckoutPaymentConfig();

  if (!config.stripeWebhookSecret) {
    throw new CheckoutWebhookError(
      "Stripe webhook secret is not configured.",
      503,
    );
  }

  if (!signatureHeader) {
    throw new CheckoutWebhookError("Missing Stripe-Signature header.", 400);
  }

  assertSandboxStripeRuntimeReady(config);

  let event: Stripe.Event;
  try {
    event = Stripe.webhooks.constructEvent(
      rawBody,
      signatureHeader,
      config.stripeWebhookSecret,
    );
  } catch {
    throw new CheckoutWebhookError("Invalid Stripe webhook signature.", 400);
  }

  return processVerifiedStripeCheckoutEvent(db, event);
}
