import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  basketPrivateCacheControl,
  removeAnonymousBasketLine,
  updateAnonymousBasketLineQuantity,
} from "@/lib/basket/anonymous-basket";
import { parseBasketContractVersion } from "@/lib/basket/basket-contract";
import { basketErrorResponse } from "@/lib/basket/http";
import { readAnonymousSessionCookies } from "@/lib/basket/session-cookies";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ linePublicId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { linePublicId } = await context.params;
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const { sessionToken } = readAnonymousSessionCookies(request);
    const body = (await request.json()) as {
      quantity: number;
      expectedVersion: number;
      mutationId?: string;
    };

    const basket = await updateAnonymousBasketLineQuantity(
      db,
      request,
      sessionToken,
      linePublicId,
      body,
    );

    return NextResponse.json(
      { basket },
      { headers: basketPrivateCacheControl() },
    );
  } catch (error) {
    return basketErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { linePublicId } = await context.params;
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const { sessionToken } = readAnonymousSessionCookies(request);
    const body = (await request.json()) as {
      expectedVersion: number;
      mutationId?: string;
    };

    const basket = await removeAnonymousBasketLine(
      db,
      request,
      sessionToken,
      linePublicId,
      body,
    );

    return NextResponse.json(
      { basket },
      { headers: basketPrivateCacheControl() },
    );
  } catch (error) {
    return basketErrorResponse(error);
  }
}
