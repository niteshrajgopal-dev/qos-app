import { NextResponse } from "next/server";

import { db } from "@/db";
import { CheckoutWebhookError } from "@/lib/checkout/checkout-payment-outcome";
import { handleStripeCheckoutWebhook } from "@/lib/checkout/stripe-webhook";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    const signature = request.headers.get("stripe-signature");
    const result = await handleStripeCheckoutWebhook(db, rawBody, signature);

    return NextResponse.json({ received: true, ...result });
  } catch (error) {
    if (error instanceof CheckoutWebhookError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.statusCode },
      );
    }

    if (error instanceof Error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
  }
}
