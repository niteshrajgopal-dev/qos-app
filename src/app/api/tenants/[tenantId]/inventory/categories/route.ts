import { NextResponse } from "next/server";

import { db } from "@/db";
import { createCategory, listCategories } from "@/lib/inventory/categories";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    return NextResponse.json(await listCategories(db, tenantId));
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
    const category = await createCategory(db, tenantId, membership, identity.subject, body);
    return NextResponse.json({ category });
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
