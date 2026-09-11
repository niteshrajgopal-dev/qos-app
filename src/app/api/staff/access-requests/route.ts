import { NextResponse } from "next/server";

import { db } from "@/db";
import { submitAccessRequest } from "@/lib/staff/access-requests";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";

export const dynamic = "force-dynamic";

type SubmitAccessRequestBody = {
  tenantPublicId?: string;
};

export async function POST(request: Request) {
  try {
    const identity = requireStaffIdentity(request.headers);
    const body = (await request.json()) as SubmitAccessRequestBody;
    const result = await submitAccessRequest(db, {
      tenantPublicId: body.tenantPublicId ?? "",
      identity,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return staffErrorResponse(error);
  }
}
