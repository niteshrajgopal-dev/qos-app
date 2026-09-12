import { NextResponse } from "next/server";

import { db } from "@/db";
import { readAccountBasketContextFromRequest } from "@/lib/basket/account-context";
import { basketErrorResponse } from "@/lib/basket/http";
import { CustomerBasketError } from "@/lib/basket/customer-basket";
import { CustomerAuthError } from "@/lib/customer/session";
import { parseCheckoutQuoteContractVersion } from "@/lib/checkout/checkout-quote-contract";
import {
  checkoutQuotePrivateCacheControl,
  issueAuthenticatedCheckoutQuote,
} from "@/lib/checkout/checkout-quote";
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
    parseCheckoutQuoteContractVersion(url.searchParams.get("contractVersion"));

    const context = readAccountBasketContextFromRequest(request);
    const body = (await request.json()) as {
      expectedBasketVersion: number;
      couponCode?: string | null;
      operationId?: string;
    };

    const quote = await issueAuthenticatedCheckoutQuote(db, request, context, body);

    return NextResponse.json(
      { quote },
      { headers: checkoutQuotePrivateCacheControl() },
    );
  } catch (error) {
    return mapRouteError(error);
  }
}
