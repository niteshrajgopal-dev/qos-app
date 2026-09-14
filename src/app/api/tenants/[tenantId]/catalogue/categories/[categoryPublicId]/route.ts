import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { getCategory, updateCategory } from "@/lib/catalogue/categories";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; categoryPublicId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId, categoryPublicId } = await context.params;
    const identity = await requireStaffIdentity(_request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    const category = await getCategory(db, tenantId, categoryPublicId);

    return NextResponse.json({ category });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, categoryPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<typeof updateCategory>[3];
    const category = await updateCategory(
      db,
      tenantId,
      categoryPublicId,
      body,
      identity.subject,
      membership,
    );

    return NextResponse.json({ category });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
