import { NextResponse } from "next/server";

import { db } from "@/db";
import { getModifierGroupChannelPrices } from "@/lib/catalogue/channel-prices";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; groupPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, groupPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );

    const channelPrices = await getModifierGroupChannelPrices(
      db,
      tenantId,
      membership,
      groupPublicId,
    );

    return NextResponse.json({ channelPrices });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
