import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  basketPrivateCacheControl,
  upsertAnonymousBasketLine,
} from "@/lib/basket/anonymous-basket";
import { parseBasketContractVersion } from "@/lib/basket/basket-contract";
import { basketErrorResponse } from "@/lib/basket/http";
import { readAnonymousSessionCookies } from "@/lib/basket/session-cookies";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const { sessionToken } = readAnonymousSessionCookies(request);
    const body = (await request.json()) as {
      productPublicId: string;
      quantity: number;
      expectedVersion: number;
      mutationId?: string;
    };

    const basket = await upsertAnonymousBasketLine(db, request, sessionToken, body);

    return NextResponse.json(
      { basket },
      { headers: basketPrivateCacheControl() },
    );
  } catch (error) {
    return basketErrorResponse(error);
  }
}
