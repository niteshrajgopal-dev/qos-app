import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { getStaffProductRemovedPrimaryPhotoHistory } from "@/lib/media/ai-photos/staff-media-provenance";
import {
  requireActiveStaffMembership,
  requireAdministratorMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";
import { staffPrivateCacheControl } from "@/lib/staff/session";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireAdministratorMembership(db, tenantId, identity.subject);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const removedHistory = await getStaffProductRemovedPrimaryPhotoHistory(
      db,
      tenantId,
      membership,
      productPublicId,
    );

    return NextResponse.json({ removedHistory }, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
