import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  basketPrivateCacheControl,
  createAnonymousBasket,
} from "@/lib/basket/anonymous-basket";
import { parseBasketContractVersion } from "@/lib/basket/basket-contract";
import { basketErrorResponse } from "@/lib/basket/http";
import { buildAnonymousSessionCookieHeaders } from "@/lib/basket/session-cookies";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const body = (await request.json()) as {
      storefrontPublicId: string;
      locationPublicId: string;
      locale?: string | null;
    };

    const created = await createAnonymousBasket(db, body);
    const headers = new Headers(basketPrivateCacheControl());

    for (const cookie of buildAnonymousSessionCookieHeaders({
      sessionToken: created.sessionToken,
      csrfToken: created.csrfToken,
      maxAgeSeconds: created.maxAgeSeconds,
    })) {
      headers.append("Set-Cookie", cookie);
    }

    return NextResponse.json({ basket: created.basket }, { status: 201, headers });
  } catch (error) {
    return basketErrorResponse(error);
  }
}
