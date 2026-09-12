import Stripe from "stripe";

import type { DbClient } from "@/db/client";
import {
  assertStripeSecretKeyIsSandboxOnly,
  readCheckoutPaymentConfig,
} from "@/lib/checkout/payment-config";
import {
  processVerifiedStripeCheckoutEvent,
} from "@/lib/checkout/checkout-payment-outcome";

function buildSyntheticCompletedEvent(
  session: Stripe.Checkout.Session,
): Stripe.Event {
  return {
    id: `evt_lookup_${session.id}`,
    object: "event",
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    data: { object: session },
    livemode: session.livemode,
    pending_webhooks: 0,
    request: null,
    type: "checkout.session.completed",
  };
}

function buildSyntheticExpiredEvent(
  session: Stripe.Checkout.Session,
): Stripe.Event {
  return {
    id: `evt_lookup_${session.id}_expired`,
    object: "event",
    api_version: null,
    created: Math.floor(Date.now() / 1000),
    data: { object: session },
    livemode: session.livemode,
    pending_webhooks: 0,
    request: null,
    type: "checkout.session.expired",
  };
}

export async function reconcilePaymentAttemptFromProviderSession(
  db: DbClient,
  tenantId: string,
  providerReference: string,
) {
  const config = readCheckoutPaymentConfig();

  if (!config.stripeSecretKey) {
    return null;
  }

  assertStripeSecretKeyIsSandboxOnly(config.stripeSecretKey);

  const stripe = new Stripe(config.stripeSecretKey, {
    apiVersion: config.stripeApiVersion as Stripe.LatestApiVersion,
  });

  const session = await stripe.checkout.sessions.retrieve(providerReference);

  if (session.livemode) {
    return null;
  }

  if (session.status === "expired") {
    return processVerifiedStripeCheckoutEvent(
      db,
      buildSyntheticExpiredEvent(session),
    );
  }

  if (session.status === "complete") {
    return processVerifiedStripeCheckoutEvent(
      db,
      buildSyntheticCompletedEvent(session),
    );
  }

  return null;
}
