import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { getWarehouse, updateWarehouse } from "@/lib/inventory/warehouses";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; warehousePublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, warehousePublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    return NextResponse.json(await getWarehouse(db, tenantId, membership, warehousePublicId));
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, warehousePublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(
      await updateWarehouse(db, tenantId, membership, identity.subject, warehousePublicId, body),
    );
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
