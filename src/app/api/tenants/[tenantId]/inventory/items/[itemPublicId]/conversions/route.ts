import { NextResponse } from "next/server";

import { db } from "@/db";
import { createConversion } from "@/lib/inventory/conversions";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; itemPublicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, itemPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(
      await createConversion(db, tenantId, membership, identity.subject, itemPublicId, body),
    );
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
