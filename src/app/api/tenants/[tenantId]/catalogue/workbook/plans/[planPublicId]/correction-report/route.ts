import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { workbookErrorResponse } from "@/lib/workbook/http";
import { XLSX_CONTENT_TYPE } from "@/lib/workbook/template";
import {
  buildCorrectionReport,
  correctionReportFileName,
  loadWorkbookPlanForReport,
  isPlanPublicId,
  WorkbookReviewError,
} from "@/lib/workbook/validation";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; planPublicId: string }>;
};

/* QOS-194: the correction report of a stored plan as XLSX, one row per
   error or warning with the cell to correct. Read only. `locale=ar` writes
   the messages in Arabic; the default is English. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId, planPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireBranchContextMembership(db, tenantId, identity.subject);
    if (!isPlanPublicId(planPublicId)) {
      throw new WorkbookReviewError("plan_not_found", "Review plan not found.", 404);
    }
    const locale = new URL(request.url).searchParams.get("locale") === "ar" ? "ar" : "en";
    const result = await loadWorkbookPlanForReport(db, tenantId, planPublicId);
    const bytes = await buildCorrectionReport(result, locale);
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...staffPrivateCacheControl(),
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${correctionReportFileName(result)}"`,
      },
    });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
