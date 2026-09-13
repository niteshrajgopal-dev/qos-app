import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  getStorefrontContentBlocksDraftForStaff,
  saveStorefrontContentBlocksDraftAsAdministrator,
} from "@/lib/storefront/storefront-content-blocks-draft";
import { storefrontErrorResponse } from "@/lib/storefront/http";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; storefrontPublicId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, storefrontPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);

    const contentBlocksDraft = await getStorefrontContentBlocksDraftForStaff(
      db,
      tenantId,
      identity.subject,
      storefrontPublicId,
    );

    return NextResponse.json({ contentBlocksDraft });
  } catch (error) {
    return storefrontErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, storefrontPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const body = (await request.json()) as Parameters<
      typeof saveStorefrontContentBlocksDraftAsAdministrator
    >[4];

    const result = await saveStorefrontContentBlocksDraftAsAdministrator(
      db,
      tenantId,
      identity.subject,
      storefrontPublicId,
      body,
    );

    return NextResponse.json({ contentBlocksDraft: result });
  } catch (error) {
    return storefrontErrorResponse(error);
  }
}
