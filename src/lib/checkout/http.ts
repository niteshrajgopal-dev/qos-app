import { NextResponse } from "next/server";

import { CheckoutPaymentContractError } from "@/lib/checkout/checkout-payment-contract";
import { CheckoutPaymentError } from "@/lib/checkout/checkout-payment-attempt";
import { CheckoutPaymentOutcomeContractError } from "@/lib/checkout/checkout-payment-outcome-contract";
import {
  CheckoutPaymentOutcomeError,
  CheckoutWebhookError,
} from "@/lib/checkout/checkout-payment-outcome";
import { CheckoutQuoteContractError } from "@/lib/checkout/checkout-quote-contract";
import { CheckoutQuoteError } from "@/lib/checkout/checkout-quote";
import { CheckoutPricingError } from "@/lib/checkout/pricing-arithmetic";
import { CheckoutPaymentConfigError } from "@/lib/checkout/payment-config";

export function mapCheckoutRouteError(error: unknown) {
  if (error instanceof CheckoutPaymentContractError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof CheckoutPaymentOutcomeContractError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof CheckoutPaymentOutcomeError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof CheckoutWebhookError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message },
    };
  }

  if (error instanceof CheckoutPaymentConfigError) {
    return {
      statusCode: 500,
      body: { error: error.message },
    };
  }

  if (error instanceof CheckoutPaymentError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
        field: error.field,
        lineValidations: error.lineValidations,
      },
    };
  }

  if (error instanceof CheckoutQuoteContractError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof CheckoutQuoteError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
        field: error.field,
        priceCorrections: error.priceCorrections,
      },
    };
  }

  if (error instanceof CheckoutPricingError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
        field: error.field,
        reason: error.reason,
      },
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

export function checkoutErrorResponse(error: unknown) {
  const mapped = mapCheckoutRouteError(error);
  return NextResponse.json(mapped.body, { status: mapped.statusCode });
}
