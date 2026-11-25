import { NextResponse } from "next/server";

import { db } from "@/db";
import { inventoryErrorResponse } from "@/lib/inventory/http";
import { getConfigurationPreview } from "@/lib/recipes/costing-service";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/**
 * Read-only: what one sale (or `quantity` sales) of a variant with the chosen
 * options (`option=opt_x:2`, repeatable; `defaults=auto|none`; optional
 * `channelPublicId`) uses on a business date, its current ingredient cost and
 * the ingredient margin. Nothing is posted.
 */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    const search = new URL(request.url).searchParams;
    return NextResponse.json(
      await getConfigurationPreview(db, tenantId, {
        variantPublicId: search.get("variantPublicId"),
        date: search.get("date"),
        quantity: search.get("quantity"),
        options: search.getAll("option"),
        defaults: search.get("defaults"),
        channelPublicId: search.get("channelPublicId"),
      }),
    );
  } catch (error) {
    return inventoryErrorResponse(error);
  }
}
