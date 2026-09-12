import { NextResponse } from "next/server";

import { BasketContractError } from "@/lib/basket/basket-contract";
import {
  AnonymousBasketError,
} from "@/lib/basket/anonymous-basket";
import { AnonymousBasketAuthError } from "@/lib/basket/session-cookies";
import { BasketMenuEligibilityError } from "@/lib/basket/menu-eligibility";
import { CustomerAuthError } from "@/lib/customer/session";

export function mapBasketRouteError(error: unknown) {
  if (error instanceof BasketContractError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
        field: error.field,
        supportedContractVersions: error.supportedContractVersions,
      },
    };
  }

  if (error instanceof AnonymousBasketAuthError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof AnonymousBasketError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof CustomerAuthError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof BasketMenuEligibilityError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 500,
      body: { error: error.message },
    };
  }

  return {
    statusCode: 500,
    body: { error: "Unexpected error." },
  };
}

export function basketErrorResponse(error: unknown) {
  const mapped = mapBasketRouteError(error);
  return NextResponse.json(mapped.body, { status: mapped.statusCode });
}
