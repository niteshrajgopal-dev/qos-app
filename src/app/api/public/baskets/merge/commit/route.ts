import { NextResponse } from "next/server";

import { db } from "@/db";
import { readOptionalAccountBasketContextFromRequest } from "@/lib/basket/account-context";
import { basketPrivateCacheControl } from "@/lib/basket/anonymous-basket";
import { commitBasketMerge } from "@/lib/basket/basket-merge";
import { parseBasketContractVersion } from "@/lib/basket/basket-contract";
import { basketErrorResponse } from "@/lib/basket/http";
import {
  buildAnonymousSessionClearCookieHeaders,
  readAnonymousSessionCookies,
} from "@/lib/basket/session-cookies";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const { sessionToken } = readAnonymousSessionCookies(request);
    const body = (await request.json()) as {
      decision: string;
      operationId: string;
      payloadHash: string;
      anonymousExpectedVersion: number;
      accountExpectedVersion: number;
    };

    const replayContext = readOptionalAccountBasketContextFromRequest(request);
    const result = await commitBasketMerge(
      db,
      request,
      sessionToken,
      body,
      replayContext,
    );
    const headers = new Headers(basketPrivateCacheControl());

    for (const cookie of buildAnonymousSessionClearCookieHeaders()) {
      headers.append("Set-Cookie", cookie);
    }

    return NextResponse.json({ merge: result }, { headers });
  } catch (error) {
    return basketErrorResponse(error);
  }
}
