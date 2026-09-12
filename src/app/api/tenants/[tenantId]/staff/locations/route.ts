import { NextResponse } from "next/server";

import { db } from "@/db";
import { listTenantLocationsForAdmin } from "@/lib/staff/access-requests";
import { requireAdministratorMembership, requireStaffIdentity } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireAdministratorMembership(db, tenantId, identity.subject);
    const locations = await listTenantLocationsForAdmin(db, tenantId);

    return NextResponse.json({ locations });
  } catch (error) {
    return staffErrorResponse(error);
  }
}
