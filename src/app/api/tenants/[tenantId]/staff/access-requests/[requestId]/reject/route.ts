import { NextResponse } from "next/server";

import { db } from "@/db";
import { rejectAccessRequest } from "@/lib/staff/access-requests";
import { requireAdministratorMembership, requireStaffIdentity } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; requestId: string }>;
};

type RejectBody = {
  expectedVersion?: number;
  decisionNote?: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, requestId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireAdministratorMembership(db, tenantId, identity.subject);

    const body = (await request.json()) as RejectBody;
    const expectedVersion = Number(body.expectedVersion);

    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
      return NextResponse.json(
        { error: "expectedVersion is required." },
        { status: 400 },
      );
    }

    const result = await rejectAccessRequest(db, {
      tenantId,
      requestId,
      adminSubject: identity.subject,
      expectedVersion,
      decisionNote: body.decisionNote,
    });

    return NextResponse.json(result);
  } catch (error) {
    return staffErrorResponse(error);
  }
}
