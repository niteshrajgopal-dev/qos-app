import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { clearLocationStopSale } from "@/lib/catalogue/location-availability";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    locationPublicId: string;
    stopSaleId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, locationPublicId, stopSaleId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const stopSale = await clearLocationStopSale(
      db,
      tenantId,
      identity.subject,
      locationPublicId,
      stopSaleId,
    );

    return NextResponse.json({ stopSale });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
