import { NextResponse } from "next/server";

import { db } from "@/db";
import { readAccountBasketContextFromRequest } from "@/lib/basket/account-context";
import { basketErrorResponse } from "@/lib/basket/http";
import { CustomerBasketError } from "@/lib/basket/customer-basket";
import { CustomerAuthError } from "@/lib/customer/session";
import { parseCheckoutPaymentContractVersion } from "@/lib/checkout/checkout-payment-contract";
import {
  checkoutPaymentPrivateCacheControl,
  createAuthenticatedPaymentAttempt,
} from "@/lib/checkout/checkout-payment-attempt";
import { checkoutErrorResponse } from "@/lib/checkout/http";
import { BasketMenuEligibilityError } from "@/lib/basket/menu-eligibility";

export const dynamic = "force-dynamic";

function mapRouteError(error: unknown) {
  if (
    error instanceof CustomerBasketError ||
    error instanceof CustomerAuthError ||
    error instanceof BasketMenuEligibilityError
  ) {
    return basketErrorResponse(error);
  }

  return checkoutErrorResponse(error);
}

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    parseCheckoutPaymentContractVersion(url.searchParams.get("contractVersion"));

    const context = readAccountBasketContextFromRequest(request);
    const body = (await request.json()) as Record<string, unknown>;

    const paymentAttempt = await createAuthenticatedPaymentAttempt(
      db,
      request,
      context,
      body,
    );

    return NextResponse.json(
      { paymentAttempt },
      { headers: checkoutPaymentPrivateCacheControl() },
    );
  } catch (error) {
    return mapRouteError(error);
  }
}
