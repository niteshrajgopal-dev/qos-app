import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { getProductLocationPrices } from "@/lib/catalogue/location-price-overrides";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(_request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );

    const locationPrices = await getProductLocationPrices(
      db,
      tenantId,
      membership,
      productPublicId,
    );

    return NextResponse.json({ locationPrices });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
