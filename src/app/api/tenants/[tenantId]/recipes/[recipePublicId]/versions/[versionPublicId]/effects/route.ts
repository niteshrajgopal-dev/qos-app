import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { replaceDraftEffects } from "@/lib/recipes/effects-service";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; recipePublicId: string; versionPublicId: string }>;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { tenantId, recipePublicId, versionPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(await replaceDraftEffects(db, tenantId, membership, identity.subject, recipePublicId, versionPublicId, body));
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
