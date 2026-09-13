import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  createProductVariant,
  listProductVariants,
} from "@/lib/catalogue/variants";
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
    const view = await listProductVariants(
      db,
      tenantId,
      membership,
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
      typeof createProductVariant
    >[4];

    const view = await createProductVariant(
      db,
      tenantId,
      membership,
      productPublicId,
      body,
      identity.subject,
    );

    return NextResponse.json(view);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
