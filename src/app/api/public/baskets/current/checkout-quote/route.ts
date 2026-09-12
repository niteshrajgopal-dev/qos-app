import { NextResponse } from "next/server";

import { db } from "@/db";
import { rejectAnonymousCheckoutQuote } from "@/lib/basket/anonymous-basket";
import { parseBasketContractVersion } from "@/lib/basket/basket-contract";
import { basketErrorResponse } from "@/lib/basket/http";
import { readAnonymousSessionCookies } from "@/lib/basket/session-cookies";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const { sessionToken } = readAnonymousSessionCookies(request);
    await rejectAnonymousCheckoutQuote(db, sessionToken, request);

    return NextResponse.json(
      { error: "Checkout quote is not yet available." },
      { status: 501 },
    );
  } catch (error) {
    return basketErrorResponse(error);
  }
}
