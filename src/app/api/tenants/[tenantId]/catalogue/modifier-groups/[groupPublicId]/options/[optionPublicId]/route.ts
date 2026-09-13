import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { updateModifierOption } from "@/lib/catalogue/modifiers";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    groupPublicId: string;
    optionPublicId: string;
  }>;
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, groupPublicId, optionPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<
      typeof updateModifierOption
    >[4];

    const group = await updateModifierOption(
      db,
      tenantId,
      groupPublicId,
      optionPublicId,
      body,
      identity.subject,
      membership,
    );

    return NextResponse.json({ group });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
