import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { listRecentApplies, parseHistoryLimit } from "@/lib/workbook/apply";
import { workbookErrorResponse } from "@/lib/workbook/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/* QOS-200 follow-up: the tenant's latest workbook applies (newest first,
   `?limit=` 1 to 50, default 20) with file name, status, counts and the
   actor's display name. Administrators only; another tenant's applies are
   never visible. Read only. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireBranchContextMembership(db, tenantId, identity.subject);
    const limit = parseHistoryLimit(new URL(request.url).searchParams.get("limit"));
    const result = await listRecentApplies(db, tenantId, membership, { limit });
    return NextResponse.json(result, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
