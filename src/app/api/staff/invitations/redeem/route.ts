import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { redeemStaffInvitation } from "@/lib/staff/invitations";
import { staffErrorResponse } from "@/lib/staff/http";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const identity = await requireStaffIdentity(request);
    const body = (await request.json()) as { token?: string };

    const result = await redeemStaffInvitation(db, {
      token: body.token ?? "",
      identity,
    });

    return NextResponse.json(
      { redemption: result },
      { headers: staffPrivateCacheControl() },
    );
  } catch (error) {
    return staffErrorResponse(error);
  }
}
