import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";
import { getTenantOverview, listTenantOverviewBranches } from "@/lib/staff/overview";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);

    const [overview, branches] = await Promise.all([
      getTenantOverview(db, tenantId, {
        includeActivity: membership.role === "administrator",
      }),
      listTenantOverviewBranches(db, tenantId),
    ]);

    return NextResponse.json({ overview, branches, role: membership.role });
  } catch (error) {
    return staffErrorResponse(error);
  }
}
