import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { unassignProductFromCategory } from "@/lib/catalogue/categories";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    categoryPublicId: string;
    productPublicId: string;
  }>;
};

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { tenantId, categoryPublicId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(_request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const category = await unassignProductFromCategory(
      db,
      tenantId,
      categoryPublicId,
      productPublicId,
      identity.subject,
      membership,
    );

    return NextResponse.json({ category });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
