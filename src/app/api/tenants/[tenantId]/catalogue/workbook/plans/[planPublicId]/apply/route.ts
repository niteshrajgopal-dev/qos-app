import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { applyWorkbookPlan, parseApplyBody } from "@/lib/workbook/apply";
import { WorkbookApplyError } from "@/lib/workbook/apply/errors";
import { workbookErrorResponse } from "@/lib/workbook/http";
import { isPlanPublicId, WorkbookReviewError } from "@/lib/workbook/validation";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; planPublicId: string }>;
};

/* QOS-217: apply a reviewed, non-stale workbook plan through the real
   catalogue services. Administrators only. The Idempotency-Key header is
   required so a retried request replays the same attempt instead of
   writing twice. Nothing is published, approved or posted. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, planPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireBranchContextMembership(db, tenantId, identity.subject);
    if (!isPlanPublicId(planPublicId)) {
      throw new WorkbookReviewError("plan_not_found", "Review plan not found.", 404);
    }

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new WorkbookApplyError("idempotency_key_required", "Idempotency-Key header is required.", 400);
    }

    const body = parseApplyBody(await request.json().catch(() => null));
    const result = await applyWorkbookPlan(db, tenantId, membership, identity.subject, planPublicId, {
      expectedPlanHash: body.expectedPlanHash,
      idempotencyKey,
    });
    return NextResponse.json(result, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
