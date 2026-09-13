import { NextResponse } from "next/server";

import { db } from "@/db";
import type { CreateStopSaleInput } from "@/lib/catalogue/availability-validation";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  createLocationStopSale,
  listLocationStopSales,
} from "@/lib/catalogue/location-availability";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; locationPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, locationPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const url = new URL(request.url);
    const includeCleared = url.searchParams.get("includeCleared") === "true";
    const stopSales = await listLocationStopSales(
      db,
      tenantId,
      identity.subject,
      locationPublicId,
      includeCleared,
    );

    return NextResponse.json(stopSales);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, locationPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const body = (await request.json()) as CreateStopSaleInput;
    const stopSale = await createLocationStopSale(
      db,
      tenantId,
      identity.subject,
      locationPublicId,
      body,
    );

    return NextResponse.json({ stopSale });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
