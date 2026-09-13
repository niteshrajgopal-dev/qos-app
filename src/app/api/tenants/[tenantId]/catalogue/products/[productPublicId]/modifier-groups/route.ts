import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  attachModifierGroupToProduct,
  listProductModifierGroups,
} from "@/lib/catalogue/modifiers";
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
    await requireActiveStaffMembership(db, tenantId, identity.subject);
    const view = await listProductModifierGroups(
      db,
      tenantId,
      productPublicId,
    );

    return NextResponse.json(view);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<
      typeof attachModifierGroupToProduct
    >[3];

    const view = await attachModifierGroupToProduct(
      db,
      tenantId,
      productPublicId,
      body,
      identity.subject,
      membership,
    );

    return NextResponse.json(view);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
