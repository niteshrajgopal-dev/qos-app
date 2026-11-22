import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  resetVariantChannelPrice,
  type ResetChannelPriceInput,
} from "@/lib/catalogue/channel-prices";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    productPublicId: string;
    variantPublicId: string;
    channelPublicId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId, variantPublicId, channelPublicId } =
      await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const raw = await request.text();
    const body = (raw.trim() ? JSON.parse(raw) : {}) as ResetChannelPriceInput;

    const channelPrices = await resetVariantChannelPrice(
      db,
      tenantId,
      membership,
      identity.subject,
      productPublicId,
      variantPublicId,
      channelPublicId,
      body,
    );

    return NextResponse.json({ channelPrices });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
