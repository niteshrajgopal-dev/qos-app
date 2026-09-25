import { NextResponse } from "next/server";

import { db } from "@/db";
import { productMediaErrorResponse } from "@/lib/media/http";
import { getProductVideoJobStatus } from "@/lib/media/product-videos";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    productPublicId: string;
    correlationId: string;
  }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, correlationId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );

    const status = await getProductVideoJobStatus(
      db,
      tenantId,
      membership,
      correlationId,
    );

    return NextResponse.json({ job: status });
  } catch (error) {
    return productMediaErrorResponse(error);
  }
}
