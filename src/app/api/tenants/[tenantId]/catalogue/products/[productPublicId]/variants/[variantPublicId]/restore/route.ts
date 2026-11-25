import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { restoreArchivedVariant } from "@/lib/catalogue/variants";
import {
  requireAdministratorMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    productPublicId: string;
    variantPublicId: string;
  }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId, variantPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireAdministratorMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json().catch(() => ({}))) as Parameters<
      typeof restoreArchivedVariant
    >[5];

    const view = await restoreArchivedVariant(
      db,
      tenantId,
      membership,
      productPublicId,
      variantPublicId,
      body,
      identity.subject,
    );

    return NextResponse.json(view);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
