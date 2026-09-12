import { NextResponse } from "next/server";

import { db } from "@/db";
import { basketPrivateCacheControl } from "@/lib/basket/anonymous-basket";
import { previewBasketMerge } from "@/lib/basket/basket-merge";
import { parseBasketContractVersion } from "@/lib/basket/basket-contract";
import { basketErrorResponse } from "@/lib/basket/http";
import { readAnonymousSessionCookies } from "@/lib/basket/session-cookies";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const { sessionToken } = readAnonymousSessionCookies(request);
    const preview = await previewBasketMerge(db, request, sessionToken);

    return NextResponse.json(
      { preview },
      { headers: basketPrivateCacheControl() },
    );
  } catch (error) {
    return basketErrorResponse(error);
  }
}
