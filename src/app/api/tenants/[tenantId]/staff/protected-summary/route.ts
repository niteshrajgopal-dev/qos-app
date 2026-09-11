import { NextResponse } from "next/server";

import { db } from "@/db";
import { getProtectedStaffSummary } from "@/lib/staff/access-requests";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = requireStaffIdentity(request.headers);
    const summary = await getProtectedStaffSummary(
      db,
      tenantId,
      identity.subject,
    );

    return NextResponse.json(summary);
  } catch (error) {
    return staffErrorResponse(error);
  }
}
