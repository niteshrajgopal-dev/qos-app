import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { listPendingAiTranslationApprovals } from "@/lib/catalogue/translation-approval";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const list = await listPendingAiTranslationApprovals(
      db,
      tenantId,
      identity.subject,
    );

    return NextResponse.json(list);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
