import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { resetProductLocationPriceOverride } from "@/lib/catalogue/location-price-overrides";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    productPublicId: string;
    locationPublicId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId, locationPublicId } =
      await context.params;
    const identity = requireStaffIdentity(request.headers);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );

    const locationPrices = await resetProductLocationPriceOverride(
      db,
      tenantId,
      membership,
      identity.subject,
      productPublicId,
      locationPublicId,
    );

    return NextResponse.json({ locationPrices });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
