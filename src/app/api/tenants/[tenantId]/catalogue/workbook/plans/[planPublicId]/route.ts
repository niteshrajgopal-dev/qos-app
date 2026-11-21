import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { workbookErrorResponse } from "@/lib/workbook/http";
import { getWorkbookPlan, isPlanPublicId, WorkbookReviewError } from "@/lib/workbook/validation";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; planPublicId: string }>;
};

/* QOS-194: a stored review plan, checked against the current records. A
   changed record marks the plan stale (the only write on read) so the
   operator revalidates before relying on it. Another tenant's plan is 404. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, planPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireBranchContextMembership(db, tenantId, identity.subject);
    if (!isPlanPublicId(planPublicId)) {
      throw new WorkbookReviewError("plan_not_found", "Review plan not found.", 404);
    }
    const result = await getWorkbookPlan(db, tenantId, membership, planPublicId);
    return NextResponse.json(result, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
