import { NextResponse } from "next/server";

import { db } from "@/db";
import { listAccessRequestsForTenant } from "@/lib/staff/access-requests";
import {
  requireAdministratorMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = requireStaffIdentity(request.headers);
    await requireAdministratorMembership(db, tenantId, identity.subject);
    const requests = await listAccessRequestsForTenant(db, tenantId);

    return NextResponse.json({ requests });
  } catch (error) {
    return staffErrorResponse(error);
  }
}
