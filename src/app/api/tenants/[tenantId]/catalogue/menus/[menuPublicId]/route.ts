import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { getDraftMenu, updateDraftMenu } from "@/lib/catalogue/menus";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; menuPublicId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = await requireStaffIdentity(_request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    const menu = await getDraftMenu(db, tenantId, menuPublicId);

    return NextResponse.json({ menu });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, menuPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<
      typeof updateDraftMenu
    >[4];

    const menu = await updateDraftMenu(
      db,
      tenantId,
      membership,
      menuPublicId,
      body,
    );

    return NextResponse.json({ menu });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
