import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { createDraftFromVersion } from "@/lib/recipes/versions";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; recipePublicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, recipePublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(await createDraftFromVersion(db, tenantId, membership, identity.subject, recipePublicId, body), {
      status: 201,
    });
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
