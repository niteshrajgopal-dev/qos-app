import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  requireAdministratorMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { listTenantStaffMembers } from "@/lib/staff/memberships";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const actor = await requireAdministratorMembership(
      db,
      tenantId,
      identity.subject,
    );
    const members = await listTenantStaffMembers(db, tenantId);

    return NextResponse.json({
      members,
      currentMembershipId: actor.membershipId,
    });
  } catch (error) {
    return staffErrorResponse(error);
  }
}
