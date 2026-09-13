import { NextResponse } from "next/server";

import { db } from "@/db";
import type { ScheduleExceptionInput } from "@/lib/catalogue/availability-validation";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { upsertLocationScheduleException } from "@/lib/catalogue/location-availability";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; locationPublicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, locationPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const body = (await request.json()) as ScheduleExceptionInput;
    const schedule = await upsertLocationScheduleException(
      db,
      tenantId,
      identity.subject,
      locationPublicId,
      body,
    );

    return NextResponse.json({ schedule });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
