import { NextResponse } from "next/server";

import { db } from "@/db";
import { readAccountBasketContextFromRequest } from "@/lib/basket/account-context";
import { basketPrivateCacheControl } from "@/lib/basket/anonymous-basket";
import { parseBasketContractVersion } from "@/lib/basket/basket-contract";
import { upsertCustomerAccountBasketLine } from "@/lib/basket/customer-basket";
import { basketErrorResponse } from "@/lib/basket/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const context = readAccountBasketContextFromRequest(request);
    const body = (await request.json()) as {
      productPublicId: string;
      quantity: number;
      expectedVersion: number;
      mutationId?: string;
    };

    const basket = await upsertCustomerAccountBasketLine(db, request, {
      ...context,
      ...body,
    });

    return NextResponse.json(
      { basket },
      { headers: basketPrivateCacheControl() },
    );
  } catch (error) {
    return basketErrorResponse(error);
  }
}
