import { NextResponse } from "next/server";

import { db } from "@/db";
import { updateConversion } from "@/lib/inventory/conversions";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; itemPublicId: string; conversionPublicId: string }>;
};

/** `{ operation: "revise", ... }` inserts the next dated version; `{ operation: "close", ... }` ends the rule. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, itemPublicId, conversionPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(
      await updateConversion(db, tenantId, membership, identity.subject, itemPublicId, conversionPublicId, body),
    );
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
