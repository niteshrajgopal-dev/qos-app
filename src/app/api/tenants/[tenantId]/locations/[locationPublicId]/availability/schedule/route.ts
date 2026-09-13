import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  getLocationScheduleView,
  replaceLocationWeeklySchedule,
} from "@/lib/catalogue/location-availability";
import type { WeeklyScheduleWindowInput } from "@/lib/catalogue/availability-validation";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; locationPublicId: string }>;
};

type ScheduleBody = {
  weeklyWindows?: WeeklyScheduleWindowInput[];
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId, locationPublicId } = await context.params;
    const identity = await requireStaffIdentity(_request);
    const schedule = await getLocationScheduleView(
      db,
      tenantId,
      identity.subject,
      locationPublicId,
    );

    return NextResponse.json({ schedule });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { tenantId, locationPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const body = (await request.json()) as ScheduleBody;
    const schedule = await replaceLocationWeeklySchedule(
      db,
      tenantId,
      identity.subject,
      locationPublicId,
      body.weeklyWindows ?? [],
    );

    return NextResponse.json({ schedule });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
