import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { getApprovedProductVideoUrls } from "@/lib/media/product-videos";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);

    const urls = await getApprovedProductVideoUrls(
      db,
      tenantId,
      productPublicId,
    );

    if (!urls) {
      return NextResponse.json({ video: null });
    }

    return NextResponse.json({ video: urls });
  } catch (error) {
    return productMediaErrorResponse(error);
  }
}
