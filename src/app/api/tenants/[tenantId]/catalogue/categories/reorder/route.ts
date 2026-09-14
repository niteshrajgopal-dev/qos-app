import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { reorderCategories } from "@/lib/catalogue/categories";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );
    const body = (await request.json()) as Parameters<typeof reorderCategories>[2];
    const categories = await reorderCategories(
      db,
      tenantId,
      body,
      identity.subject,
      membership,
    );

    return NextResponse.json({ categories });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
