import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { createDraftProduct } from "@/lib/catalogue/products";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = requireStaffIdentity(request.headers);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<
      typeof createDraftProduct
    >[3];

    const product = await createDraftProduct(
      db,
      tenantId,
      membership,
      body,
    );

    return NextResponse.json({ product }, { status: 201 });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
