import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { setReferenceCost } from "@/lib/inventory/reference-costs";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; itemPublicId: string }>;
};

/** Sets the item's reference cost: the first version, or a new dated version that closes the current one. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, itemPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(
      await setReferenceCost(db, tenantId, membership, identity.subject, itemPublicId, body),
    );
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
