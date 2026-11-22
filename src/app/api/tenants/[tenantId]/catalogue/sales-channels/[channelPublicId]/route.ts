import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  updateSalesChannel,
  type UpdateSalesChannelInput,
} from "@/lib/catalogue/sales-channels";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; channelPublicId: string }>;
};

/** Updates or archives a channel. Channels are never hard-deleted. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, channelPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as UpdateSalesChannelInput;

    const channel = await updateSalesChannel(
      db,
      tenantId,
      membership,
      identity.subject,
      channelPublicId,
      body,
    );

    return NextResponse.json({ channel });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
