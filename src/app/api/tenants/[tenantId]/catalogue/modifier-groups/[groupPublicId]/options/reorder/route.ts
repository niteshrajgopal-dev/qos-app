import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { reorderModifierOptions } from "@/lib/catalogue/modifiers";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; groupPublicId: string }>;
};

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
      typeof reorderModifierOptions
    >[3];

    const group = await reorderModifierOptions(
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
