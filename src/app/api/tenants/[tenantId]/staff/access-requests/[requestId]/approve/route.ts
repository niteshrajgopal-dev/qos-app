import { NextResponse } from "next/server";

import { db } from "@/db";
import { approveAccessRequest } from "@/lib/staff/access-requests";
import { requireAdministratorMembership, requireStaffIdentity } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; requestId: string }>;
};

type ApproveBody = {
  expectedVersion?: number;
  role?: "administrator" | "user";
  locationIds?: string[];
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, requestId } = await context.params;
    const identity = requireStaffIdentity(request.headers);
    await requireAdministratorMembership(db, tenantId, identity.subject);

    const body = (await request.json()) as ApproveBody;
    const expectedVersion = Number(body.expectedVersion);
    const role = body.role;
    const locationIds = body.locationIds ?? [];

    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json(
        { error: "expectedVersion is required." },
        { status: 400 },
      );
    }

    if (role !== "administrator" && role !== "user") {
      return NextResponse.json({ error: "role is required." }, { status: 400 });
    }

    const result = await approveAccessRequest(db, {
      tenantId,
      requestId,
      adminSubject: identity.subject,
      expectedVersion,
      role,
      locationIds,
    });

    return NextResponse.json(result);
  } catch (error) {
    return staffErrorResponse(error);
  }
}
