import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  createSalesChannel,
  listSalesChannels,
  type CreateSalesChannelInput,
} from "@/lib/catalogue/sales-channels";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );

    const salesChannels = await listSalesChannels(db, tenantId, membership);

    return NextResponse.json({ salesChannels });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as CreateSalesChannelInput;

    const channel = await createSalesChannel(
      db,
      tenantId,
      membership,
      identity.subject,
      body,
    );

    return NextResponse.json({ channel }, { status: 201 });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
