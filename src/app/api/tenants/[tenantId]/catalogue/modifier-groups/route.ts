import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  createModifierGroup,
  listModifierGroups,
} from "@/lib/catalogue/modifiers";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(_request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    const groups = await listModifierGroups(db, tenantId);

    return NextResponse.json({ groups });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<
      typeof createModifierGroup
    >[2];

    const group = await createModifierGroup(
      db,
      tenantId,
      body,
      identity.subject,
      membership,
    );

    return NextResponse.json({ group });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
