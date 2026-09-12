import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { createProductImageUploadGrant } from "@/lib/media/product-images";
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
    const body = (await request.json()) as {
      expectedByteSize: number;
      expectedContentType: "image/jpeg" | "image/png";
      altTextEn?: string | null;
      altTextAr?: string | null;
    };

    const grant = await createProductImageUploadGrant(
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
