import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { readWorkbookUploadForm, workbookErrorResponse } from "@/lib/workbook/http";
import { withApplyView } from "@/lib/workbook/apply";
import { parseDecisionsField, previewWorkbook, WorkbookReviewError } from "@/lib/workbook/validation";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/* QOS-194: reviews an uploaded QOS or Foodics menu workbook against the
   tenant's current records and stores the result as a review plan. The plan
   tables are the only writes: no catalogue record, source link or audit
   event. Nothing is applied (QOS-217). An `Idempotency-Key` header is
   required; replaying it with the same file returns the stored plan. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireBranchContextMembership(db, tenantId, identity.subject);

    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new WorkbookReviewError("idempotency_key_required", "Idempotency-Key header is required.", 400);
    }

    const upload = await readWorkbookUploadForm(request);
    if (upload instanceof NextResponse) {
      return upload;
    }

    const previewed = await previewWorkbook(
      db,
      tenantId,
      membership,
      identity.subject,
      {
        fileName: upload.fileName,
        bytes: upload.bytes,
        brand: upload.brand,
        branch: upload.branch,
        decisions: parseDecisionsField(upload.decisions),
      },
      idempotencyKey,
    );
    const result = await withApplyView(db, tenantId, membership, previewed);
    return NextResponse.json(result, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
