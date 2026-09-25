import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { createProductVideoUploadGrant } from "@/lib/media/product-videos";
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
    const body = (await request.json()) as {
      byteSize: number;
      contentType: string;
    };

    const grant = await createProductVideoUploadGrant(
      db,
      tenantId,
      membership,
      productPublicId,
      body,
    );

    return NextResponse.json({ grant }, { status: 201 });
  } catch (error) {
    return productMediaErrorResponse(error);
  }
}
