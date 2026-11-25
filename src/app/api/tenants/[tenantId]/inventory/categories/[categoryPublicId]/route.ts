import { NextResponse } from "next/server";

import { db } from "@/db";
import { getCategory, updateCategory } from "@/lib/inventory/categories";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; categoryPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, categoryPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    return NextResponse.json(await getCategory(db, tenantId, categoryPublicId));
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}

/** Renames, archives (refused while active items use it) or restores the category. */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, categoryPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(
      await updateCategory(db, tenantId, membership, identity.subject, categoryPublicId, body),
    );
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
