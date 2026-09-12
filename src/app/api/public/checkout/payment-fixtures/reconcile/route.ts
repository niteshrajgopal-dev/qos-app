import { NextResponse } from "next/server";

import { db } from "@/db";
import { readAccountBasketContextFromRequest } from "@/lib/basket/account-context";
import { basketErrorResponse } from "@/lib/basket/http";
import { CustomerBasketError } from "@/lib/basket/customer-basket";
import { CustomerAuthError } from "@/lib/customer/session";
import {
  CheckoutPaymentOutcomeError,
  checkoutPaymentOutcomePrivateCacheControl,
  reconcileLabelledFixturePaymentOutcome,
  resolveTenantIdFromStorefrontPublicId,
} from "@/lib/checkout/checkout-payment-outcome";
import { readCheckoutPaymentConfig } from "@/lib/checkout/payment-config";
import { checkoutErrorResponse } from "@/lib/checkout/http";

export const dynamic = "force-dynamic";

function mapRouteError(error: unknown) {
  if (error instanceof CustomerBasketError || error instanceof CustomerAuthError) {
    return basketErrorResponse(error);
  }

  return checkoutErrorResponse(error);
}

export async function POST(request: Request) {
  try {
    const config = readCheckoutPaymentConfig();
    const fixtureSecret = request.headers.get("x-qos-fixture-webhook-secret");

    if (!config.fixtureWebhookSecret || fixtureSecret !== config.fixtureWebhookSecret) {
      throw new CheckoutPaymentOutcomeError(
        "Fixture webhook secret is missing or invalid.",
        403,
      );
    }

    const basketContext = readAccountBasketContextFromRequest(request);
    const body = (await request.json()) as {
      paymentAttemptPublicId?: string;
      outcome?: "succeeded" | "failed" | "cancelled";
    };

    if (!body.paymentAttemptPublicId?.trim()) {
      throw new CheckoutPaymentOutcomeError(
        "paymentAttemptPublicId is required.",
        400,
        "paymentAttemptPublicId",
      );
    }

    if (
      body.outcome !== "succeeded" &&
      body.outcome !== "failed" &&
      body.outcome !== "cancelled"
    ) {
      throw new CheckoutPaymentOutcomeError(
        "outcome must be succeeded, failed, or cancelled.",
        400,
        "outcome",
      );
    }

    const tenantId = await resolveTenantIdFromStorefrontPublicId(
      db,
      basketContext.storefrontPublicId,
    );

    const outcome = await reconcileLabelledFixturePaymentOutcome(db, {
      tenantId,
      paymentAttemptPublicId: body.paymentAttemptPublicId.trim(),
      outcome: body.outcome,
    });

    return NextResponse.json(
      { outcome },
      { headers: checkoutPaymentOutcomePrivateCacheControl() },
    );
  } catch (error) {
    return mapRouteError(error);
  }
}
