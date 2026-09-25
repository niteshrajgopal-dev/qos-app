import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { queueProductVideoProcessing } from "@/lib/media/product-videos";
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
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as { assetPublicId: string };

    const result = await queueProductVideoProcessing(
      db,
      tenantId,
      membership,
      productPublicId,
      body.assetPublicId,
    );

    return NextResponse.json({ job: result });
  } catch (error) {
    return productMediaErrorResponse(error);
  }
}
