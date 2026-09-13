import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  getStorefrontThemeDraftForStaff,
  saveStorefrontThemeDraftAsAdministrator,
} from "@/lib/storefront/storefront-theme-draft";
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

    const themeDraft = await getStorefrontThemeDraftForStaff(
      db,
      tenantId,
      identity.subject,
      storefrontPublicId,
    );

    return NextResponse.json({ themeDraft });
  } catch (error) {
    return storefrontErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { tenantId, storefrontPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const body = (await request.json()) as Parameters<
      typeof saveStorefrontThemeDraftAsAdministrator
    >[4];

    const result = await saveStorefrontThemeDraftAsAdministrator(
      db,
      tenantId,
      identity.subject,
      storefrontPublicId,
      body,
    );

    return NextResponse.json({ themeDraft: result });
  } catch (error) {
    return storefrontErrorResponse(error);
  }
}
