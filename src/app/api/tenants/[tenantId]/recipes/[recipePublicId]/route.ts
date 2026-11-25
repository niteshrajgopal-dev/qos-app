import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { getRecipe, updateRecipe } from "@/lib/recipes/recipes";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; recipePublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, recipePublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    return NextResponse.json(await getRecipe(db, tenantId, recipePublicId));
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, recipePublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body: unknown = await request.json();
    return NextResponse.json(await updateRecipe(db, tenantId, membership, identity.subject, recipePublicId, body));
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
