import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { getItem, updateItem } from "@/lib/inventory/items";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; itemPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, itemPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    return NextResponse.json(await getItem(db, tenantId, itemPublicId));
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, itemPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(await updateItem(db, tenantId, membership, identity.subject, itemPublicId, body));
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
