import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { setProductLocationPriceOverride } from "@/lib/catalogue/location-price-overrides";
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

type PriceBody = {
  amountMinor?: number;
};

export async function PUT(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId, locationPublicId } =
      await context.params;
    const identity = requireStaffIdentity(request.headers);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as PriceBody;
    const amountMinor = Number(body.amountMinor);

    const locationPrices = await setProductLocationPriceOverride(
      db,
      tenantId,
      membership,
      identity.subject,
      productPublicId,
      locationPublicId,
      { amountMinor },
    );

    return NextResponse.json({ locationPrices });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
