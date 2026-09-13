import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  getModifierGroup,
  updateModifierGroup,
} from "@/lib/catalogue/modifiers";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; groupPublicId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId, groupPublicId } = await context.params;
    const identity = await requireStaffIdentity(_request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    const group = await getModifierGroup(db, tenantId, groupPublicId);

    return NextResponse.json({ group });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, groupPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<
      typeof updateModifierGroup
    >[3];

    const group = await updateModifierGroup(
      db,
      tenantId,
      groupPublicId,
      body,
      identity.subject,
      membership,
    );

    return NextResponse.json({ group });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
