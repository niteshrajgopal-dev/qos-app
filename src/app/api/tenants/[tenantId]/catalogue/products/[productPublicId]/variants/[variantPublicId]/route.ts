import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { updateProductVariant } from "@/lib/catalogue/variants";
import {
  requireActiveStaffMembership,
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

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId, variantPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<
      typeof updateProductVariant
    >[5];

    const view = await updateProductVariant(
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
