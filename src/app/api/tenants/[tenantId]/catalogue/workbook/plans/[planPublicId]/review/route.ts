import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { withApplyView } from "@/lib/workbook/apply";
import { workbookErrorResponse } from "@/lib/workbook/http";
import { isPlanPublicId, parseReReviewBody, reReviewWorkbookPlan, WorkbookReviewError } from "@/lib/workbook/validation";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; planPublicId: string }>;
};

/* QOS-194: re-runs the review of a stored plan with the operator's decisions
   against the current records, from the plan hash the operator last saw.
   Only the plan's creator or an administrator may do this. Nothing is
   applied; the plan is revised in place. QOS-217 allows this from
   apply_failed (the retry path) and attaches the apply block so the
   operator can apply again. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, planPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireBranchContextMembership(db, tenantId, identity.subject);
    if (!isPlanPublicId(planPublicId)) {
      throw new WorkbookReviewError("plan_not_found", "Review plan not found.", 404);
    }
    const body = parseReReviewBody(await request.json().catch(() => null));
    const reviewed = await reReviewWorkbookPlan(db, tenantId, membership, identity.subject, planPublicId, body);
    const result = await withApplyView(db, tenantId, membership, reviewed);
    return NextResponse.json(result, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
