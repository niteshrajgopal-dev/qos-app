import { NextResponse } from "next/server";

import { db } from "@/db";
import { storefrontErrorResponse } from "@/lib/storefront/http";
import { publishStorefrontReleaseAsAdministrator } from "@/lib/storefront/storefront-publish";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; storefrontPublicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, storefrontPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);

    const result = await publishStorefrontReleaseAsAdministrator(
      db,
      tenantId,
      identity.subject,
      storefrontPublicId,
    );

    return NextResponse.json({ publish: result });
  } catch (error) {
    return storefrontErrorResponse(error);
  }
}
