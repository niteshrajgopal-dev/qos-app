import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  detachModifierGroupFromProduct,
  updateProductModifierGroupPolicy,
} from "@/lib/catalogue/modifiers";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    productPublicId: string;
    groupPublicId: string;
  }>;
};

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId, groupPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as { expectedProductVersion: number };

    const view = await detachModifierGroupFromProduct(
      db,
      tenantId,
      productPublicId,
      groupPublicId,
      body.expectedProductVersion,
      identity.subject,
      membership,
    );

    return NextResponse.json(view);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

/** Product-specific selection and repeat policy for one attached group (QOS-212). */
export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId, groupPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<
      typeof updateProductModifierGroupPolicy
    >[4];

    const view = await updateProductModifierGroupPolicy(
      db,
      tenantId,
      productPublicId,
      groupPublicId,
      body,
      identity.subject,
      membership,
    );

    return NextResponse.json(view);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
