import { NextResponse } from "next/server";

import { db } from "@/db";
import { readAccountBasketContextFromRequest } from "@/lib/basket/account-context";
import { basketErrorResponse } from "@/lib/basket/http";
import { CustomerBasketError } from "@/lib/basket/customer-basket";
import { CustomerAuthError } from "@/lib/customer/session";
import { parseCheckoutPaymentOutcomeContractVersion } from "@/lib/checkout/checkout-payment-outcome-contract";
import {
  checkoutPaymentOutcomePrivateCacheControl,
  getAuthenticatedPaymentOutcome,
} from "@/lib/checkout/checkout-payment-outcome";
import { checkoutErrorResponse } from "@/lib/checkout/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ paymentAttemptPublicId: string }>;
};

function mapRouteError(error: unknown) {
  if (error instanceof CustomerBasketError || error instanceof CustomerAuthError) {
    return basketErrorResponse(error);
  }

  return checkoutErrorResponse(error);
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const url = new URL(request.url);
    parseCheckoutPaymentOutcomeContractVersion(url.searchParams.get("contractVersion"));

    const { paymentAttemptPublicId } = await context.params;
    const basketContext = readAccountBasketContextFromRequest(request);

    const outcome = await getAuthenticatedPaymentOutcome(
      db,
      request,
      basketContext,
      paymentAttemptPublicId,
    );

    return NextResponse.json(
      { outcome },
      { headers: checkoutPaymentOutcomePrivateCacheControl() },
    );
  } catch (error) {
    return mapRouteError(error);
  }
}
