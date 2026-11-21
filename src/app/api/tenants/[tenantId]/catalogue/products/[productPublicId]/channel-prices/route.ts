import { NextResponse } from "next/server";

import { db } from "@/db";
import { getProductChannelPrices } from "@/lib/catalogue/channel-prices";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );

    const channelPrices = await getProductChannelPrices(
      db,
      tenantId,
      membership,
      productPublicId,
    );

    return NextResponse.json({ channelPrices });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
