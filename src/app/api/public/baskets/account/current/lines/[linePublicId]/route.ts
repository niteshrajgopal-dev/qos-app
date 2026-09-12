import { NextResponse } from "next/server";

import { db } from "@/db";
import { readAccountBasketContextFromRequest } from "@/lib/basket/account-context";
import { basketPrivateCacheControl } from "@/lib/basket/anonymous-basket";
import { parseBasketContractVersion } from "@/lib/basket/basket-contract";
import { removeCustomerAccountBasketLine } from "@/lib/basket/customer-basket";
import { basketErrorResponse } from "@/lib/basket/http";

export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ linePublicId: string }> },
) {
  try {
    const url = new URL(request.url);
    parseBasketContractVersion(url.searchParams.get("contractVersion"));

    const { linePublicId } = await context.params;
    const basketContext = readAccountBasketContextFromRequest(request);
    const body = (await request.json()) as {
      expectedVersion: number;
      mutationId?: string;
    };

    const basket = await removeCustomerAccountBasketLine(
      db,
      request,
      linePublicId,
      {
        ...basketContext,
        ...body,
      },
    );

    return NextResponse.json(
      { basket },
      { headers: basketPrivateCacheControl() },
    );
  } catch (error) {
    return basketErrorResponse(error);
  }
}
