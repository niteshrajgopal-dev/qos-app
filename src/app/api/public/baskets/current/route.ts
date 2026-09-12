import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  basketPrivateCacheControl,
  getAnonymousBasket,
} from "@/lib/basket/anonymous-basket";
import { parseBasketContractVersion } from "@/lib/basket/basket-contract";
import { basketErrorResponse } from "@/lib/basket/http";
import { readAnonymousSessionCookies } from "@/lib/basket/session-cookies";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const { sessionToken } = readAnonymousSessionCookies(request);
    const basket = await getAnonymousBasket(db, sessionToken);

    return NextResponse.json(
      { basket },
      { headers: basketPrivateCacheControl() },
    );
  } catch (error) {
    return basketErrorResponse(error);
  }
}
