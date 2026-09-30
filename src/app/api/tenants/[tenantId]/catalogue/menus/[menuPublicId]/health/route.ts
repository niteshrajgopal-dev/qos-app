import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { getMenuHealth } from "@/lib/catalogue/menu-health";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const health = await getMenuHealth(db, tenantId, membership, menuPublicId);

    return NextResponse.json(
      { health },
      { headers: staffPrivateCacheControl() },
    );
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
