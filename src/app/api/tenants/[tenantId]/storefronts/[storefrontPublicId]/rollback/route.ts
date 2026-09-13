import { NextResponse } from "next/server";

import { db } from "@/db";
import { storefrontErrorResponse } from "@/lib/storefront/http";
import { rollbackStorefrontReleaseAsAdministrator } from "@/lib/storefront/storefront-publish";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; storefrontPublicId: string }>;
};

type RollbackBody = {
  releasePublicId: string;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, storefrontPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const body = (await request.json()) as RollbackBody;

    if (!body.releasePublicId?.trim()) {
      return NextResponse.json(
        { error: "releasePublicId is required.", field: "releasePublicId" },
        { status: 400 },
      );
    }

    const result = await rollbackStorefrontReleaseAsAdministrator(
      db,
      tenantId,
      identity.subject,
      storefrontPublicId,
      body.releasePublicId.trim(),
    );

    return NextResponse.json({ rollback: result });
  } catch (error) {
    return storefrontErrorResponse(error);
  }
}
