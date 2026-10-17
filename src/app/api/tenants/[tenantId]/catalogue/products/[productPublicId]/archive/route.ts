import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { archiveDraftProduct } from "@/lib/catalogue/products";
import {
  requireAdministratorMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireAdministratorMembership(db, tenantId, identity.subject);

    const product = await archiveDraftProduct(
      db,
      tenantId,
      productPublicId,
      identity.subject,
    );

    return NextResponse.json({ product });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
