import Stripe from "stripe";

import type { CheckoutQuoteResponse } from "@/lib/checkout/checkout-quote-contract";
import type { CheckoutPaymentHandoffResponse } from "@/lib/checkout/checkout-payment-contract";
import {
  assertSandboxStripeRuntimeReady,
  assertStripeSecretKeyIsSandboxOnly,
  readCheckoutPaymentConfig,
} from "@/lib/checkout/payment-config";

export type StripeCheckoutSessionInput = {
  paymentAttemptPublicId: string;
  quotePublicId: string;
  tenantId: string;
  customerUserId: string;
  quote: CheckoutQuoteResponse;
  returnUrl: string;
  cancelUrl: string;
  idempotencyKey: string;
};

export type StripeCheckoutSessionResult = {
  providerMode: "sandbox" | "fixture";
  handoff: CheckoutPaymentHandoffResponse;
  providerReference: string;
};

function buildFixtureSession(input: StripeCheckoutSessionInput): StripeCheckoutSessionResult {
  const sessionId = `cs_fixture_${input.paymentAttemptPublicId}`;
  const url = `${input.returnUrl}?fixture=1&paymentAttemptPublicId=${encodeURIComponent(input.paymentAttemptPublicId)}&quotePublicId=${encodeURIComponent(input.quotePublicId)}&label=fixture-only`;

  return {
    providerMode: "fixture",
    providerReference: sessionId,
    handoff: {
      kind: "fixture",
      url,
      sessionId,
      isLabelledFixture: true,
    },
  };
}

export async function createStripeCheckoutSession(
  input: StripeCheckoutSessionInput,
): Promise<StripeCheckoutSessionResult> {
  const config = readCheckoutPaymentConfig();

  if (!config.stripeSecretKey) {
    return buildFixtureSession(input);
  }

  assertSandboxStripeRuntimeReady(config);
  assertStripeSecretKeyIsSandboxOnly(config.stripeSecretKey);

  if (input.quote.currency.toUpperCase() !== config.currency) {
    throw new Error(
      `Checkout quote currency must match configured Stripe currency (${config.currency}).`,
    );
  }

  const stripe = new Stripe(config.stripeSecretKey, {
    apiVersion: config.stripeApiVersion as Stripe.LatestApiVersion,
  });

  const session = await stripe.checkout.sessions.create(
    {
      mode: "payment",
      success_url: input.returnUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.paymentAttemptPublicId,
      metadata: {
        tenant_id: input.tenantId,
        customer_user_id: input.customerUserId,
        quote_public_id: input.quotePublicId,
        payment_attempt_public_id: input.paymentAttemptPublicId,
        is_test: "true",
      },
      line_items: [
        {
          price_data: {
            currency: input.quote.currency.toLowerCase(),
            product_data: {
              name: `Checkout ${input.quotePublicId}`,
            },
            unit_amount: input.quote.totalMinor,
          },
          quantity: 1,
        },
      ],
      payment_intent_data: {
        metadata: {
          tenant_id: input.tenantId,
          quote_public_id: input.quotePublicId,
          payment_attempt_public_id: input.paymentAttemptPublicId,
        },
      },
    },
    {
      idempotencyKey: input.idempotencyKey,
    },
  );

  if (!session.url) {
    throw new Error("Stripe checkout session did not return a hosted URL.");
  }

  return {
    providerMode: "sandbox",
    providerReference: session.id,
    handoff: {
      kind: "hosted_checkout_url",
      url: session.url,
      sessionId: session.id,
      isLabelledFixture: false,
    },
  };
}
