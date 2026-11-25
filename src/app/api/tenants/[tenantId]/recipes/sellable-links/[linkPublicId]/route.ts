import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { updateSellableLink } from "@/lib/recipes/links";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; linkPublicId: string }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, linkPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(await updateSellableLink(db, tenantId, membership, identity.subject, linkPublicId, body));
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
