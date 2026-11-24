import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { createWarehouse, listWarehouses } from "@/lib/inventory/warehouses";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    return NextResponse.json(await listWarehouses(db, tenantId, membership));
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    const warehouse = await createWarehouse(db, tenantId, membership, identity.subject, body);
    return NextResponse.json({ warehouse });
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
