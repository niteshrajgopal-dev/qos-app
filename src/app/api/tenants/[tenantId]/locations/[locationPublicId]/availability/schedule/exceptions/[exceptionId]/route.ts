import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { deleteLocationScheduleException } from "@/lib/catalogue/location-availability";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    locationPublicId: string;
    exceptionId: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { tenantId, locationPublicId, exceptionId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const schedule = await deleteLocationScheduleException(
      db,
      tenantId,
      identity.subject,
      locationPublicId,
      exceptionId,
    );

    return NextResponse.json({ schedule });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
