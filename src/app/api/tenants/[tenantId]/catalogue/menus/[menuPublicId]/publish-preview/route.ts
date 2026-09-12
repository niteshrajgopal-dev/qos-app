import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { getMenuPublishPreview } from "@/lib/catalogue/menu-publish";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = requireStaffIdentity(request.headers);
    const url = new URL(request.url);
    const locationIds = url.searchParams.getAll("locationId");

    if (locationIds.length === 0) {
      return NextResponse.json(
        { error: "At least one locationId query parameter is required." },
        { status: 400 },
      );
    }

    const preview = await getMenuPublishPreview(
      db,
      tenantId,
      identity.subject,
      menuPublicId,
      locationIds,
    );

    return NextResponse.json({ preview });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
