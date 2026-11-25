import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { updateReferenceCost } from "@/lib/inventory/reference-costs";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; itemPublicId: string; costPublicId: string }>;
};

/** `{ operation: "close", ... }` ends the current cost; the item's cost is unknown again from that date. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, itemPublicId, costPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(
      await updateReferenceCost(db, tenantId, membership, identity.subject, itemPublicId, costPublicId, body),
    );
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
