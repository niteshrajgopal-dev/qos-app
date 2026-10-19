import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { removeProductPrimaryPhoto } from "@/lib/media/product-images";
import {
  requireActiveStaffMembership,
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
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body = (await request.json()) as { expectedVersion?: number };

    if (!Number.isInteger(body.expectedVersion)) {
      return NextResponse.json(
        { error: "expectedVersion is required.", field: "expectedVersion" },
        { status: 400 },
      );
    }

    const result = await removeProductPrimaryPhoto(
      db,
      tenantId,
      membership,
      productPublicId,
      { expectedVersion: body.expectedVersion! },
      identity.subject,
    );

    return NextResponse.json({ result });
  } catch (error) {
    return productMediaErrorResponse(error);
  }
}
