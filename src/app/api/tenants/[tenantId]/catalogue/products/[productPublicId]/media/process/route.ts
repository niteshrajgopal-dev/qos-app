import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { processProductImage } from "@/lib/media/product-images";
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
    const identity = requireStaffIdentity(request.headers);
    const membership = await requireAdministratorMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as { assetPublicId: string };

    const result = await processProductImage(
      db,
      tenantId,
      membership,
      productPublicId,
      body.assetPublicId,
      identity.subject,
    );

    return NextResponse.json({ media: result });
  } catch (error) {
    return productMediaErrorResponse(error);
  }
}
