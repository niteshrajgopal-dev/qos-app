import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { getLatestTenantMenuExtractionReview } from "@/lib/catalogue/menu-extraction/service";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    await requireStaffIdentity(request);
    const review = await getLatestTenantMenuExtractionReview(db, tenantId);
    return NextResponse.json({ review });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
