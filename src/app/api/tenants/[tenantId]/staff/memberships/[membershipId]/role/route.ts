import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  requireAdministratorMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { changeStaffMembershipRole } from "@/lib/staff/memberships";
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
    const body = (await request.json()) as { role?: "administrator" | "user" };

    if (body.role !== "administrator" && body.role !== "user") {
      return NextResponse.json(
        { error: "role must be administrator or user.", field: "role" },
        { status: 400 },
      );
    }

    const result = await changeStaffMembershipRole(
      db,
      tenantId,
      membershipId,
      body.role,
      actor,
    );

    return NextResponse.json({ roleChange: result });
  } catch (error) {
    return staffErrorResponse(error);
  }
}
