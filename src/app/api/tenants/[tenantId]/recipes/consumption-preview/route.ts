import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { getConsumptionPreview } from "@/lib/recipes/resolution-service";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/** Read-only: what one sale (or `quantity` sales) of a variant uses on a business date. Nothing is posted. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    const search = new URL(request.url).searchParams;
    return NextResponse.json(
      await getConsumptionPreview(db, tenantId, {
        variantPublicId: search.get("variantPublicId"),
        date: search.get("date"),
        quantity: search.get("quantity"),
      }),
    );
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
