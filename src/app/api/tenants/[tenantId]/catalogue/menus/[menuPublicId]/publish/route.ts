import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

type PublishBody = {
  locationIds?: string[];
  operationId?: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const body = (await request.json()) as PublishBody;
    const locationIds = body.locationIds ?? [];

    if (!Array.isArray(locationIds) || locationIds.length === 0) {
      return NextResponse.json(
        { error: "At least one locationId must be selected explicitly." },
        { status: 400 },
      );
    }

    const result = await publishDraftMenuToLocations(
      db,
      tenantId,
      identity.subject,
      menuPublicId,
      {
        locationIds,
        operationId: body.operationId,
      },
    );

    return NextResponse.json({ publish: result });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
