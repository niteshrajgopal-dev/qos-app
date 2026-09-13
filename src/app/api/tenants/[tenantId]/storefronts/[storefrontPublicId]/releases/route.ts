import { NextResponse } from "next/server";

import { db } from "@/db";
import { storefrontErrorResponse } from "@/lib/storefront/http";
import { listStorefrontReleasesForStaff } from "@/lib/storefront/storefront-publish";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; storefrontPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, storefrontPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);

    const releases = await listStorefrontReleasesForStaff(
      db,
      tenantId,
      identity.subject,
      storefrontPublicId,
    );

    return NextResponse.json({ releases });
  } catch (error) {
    return storefrontErrorResponse(error);
  }
}
