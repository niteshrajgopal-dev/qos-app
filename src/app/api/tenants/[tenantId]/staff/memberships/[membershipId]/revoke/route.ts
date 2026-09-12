import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  requireAdministratorMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { revokeStaffMembership } from "@/lib/staff/memberships";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; membershipId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, membershipId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const actor = await requireAdministratorMembership(
      db,
      tenantId,
      identity.subject,
    );

    const result = await revokeStaffMembership(
      db,
      tenantId,
      membershipId,
      actor,
    );

    return NextResponse.json({ revocation: result });
  } catch (error) {
    return staffErrorResponse(error);
  }
}
