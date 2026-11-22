import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  setModifierOptionChannelPrice,
  type SetChannelPriceInput,
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
    groupPublicId: string;
    optionPublicId: string;
    channelPublicId: string;
  }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { tenantId, groupPublicId, optionPublicId, channelPublicId } =
      await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    // The body is passed through untouched: a blank or missing amount is refused, never read as 0.
    const body = (await request.json()) as SetChannelPriceInput;

    const channelPrices = await setModifierOptionChannelPrice(
      db,
      tenantId,
      membership,
      identity.subject,
      groupPublicId,
      optionPublicId,
      channelPublicId,
      body,
    );

    return NextResponse.json({ channelPrices });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
