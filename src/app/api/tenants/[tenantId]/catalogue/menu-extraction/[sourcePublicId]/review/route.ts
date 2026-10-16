import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { getLatestMenuExtractionReview } from "@/lib/catalogue/menu-extraction/service";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ tenantId: string; sourcePublicId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, sourcePublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    const review = await getLatestMenuExtractionReview(db, tenantId, sourcePublicId);
    return NextResponse.json({ review });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
