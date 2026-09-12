import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  getDraftProduct,
  updateDraftProduct,
} from "@/lib/catalogue/products";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(_request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const product = await getDraftProduct(
      db,
      tenantId,
      membership,
      productPublicId,
    );

    return NextResponse.json({ product });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<
      typeof updateDraftProduct
    >[4];

    const product = await updateDraftProduct(
      db,
      tenantId,
      membership,
      productPublicId,
      body,
    );

    return NextResponse.json({ product });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
