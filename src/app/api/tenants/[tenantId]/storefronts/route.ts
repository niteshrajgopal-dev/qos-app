import { NextResponse } from "next/server";

import { db } from "@/db";
import { storefrontErrorResponse } from "@/lib/storefront/http";
import { listStorefrontsForStaff } from "@/lib/storefront/storefront-publish";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);

    const storefronts = await listStorefrontsForStaff(
      db,
      tenantId,
      identity.subject,
    );

    return NextResponse.json({ storefronts });
  } catch (error) {
    return storefrontErrorResponse(error);
  }
}
