import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { listActiveStaffMembershipsForSubject } from "@/lib/staff/memberships";
import { staffErrorResponse } from "@/lib/staff/http";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await requireStaffIdentity(request);
    const memberships = await listActiveStaffMembershipsForSubject(
      db,
      identity.subject,
    );

    return NextResponse.json(
      { memberships },
      { headers: staffPrivateCacheControl() },
    );
  } catch (error) {
    return staffErrorResponse(error);
  }
}
