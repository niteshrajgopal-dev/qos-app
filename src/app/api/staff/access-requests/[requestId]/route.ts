import { NextResponse } from "next/server";

import { db } from "@/db";
import { getRequesterAccessRequest } from "@/lib/staff/access-requests";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ requestId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const identity = requireStaffIdentity(request.headers);
    const { requestId } = await context.params;
    const result = await getRequesterAccessRequest(
      db,
      requestId,
      identity.subject,
    );

    return NextResponse.json(result);
  } catch (error) {
    return staffErrorResponse(error);
  }
}
