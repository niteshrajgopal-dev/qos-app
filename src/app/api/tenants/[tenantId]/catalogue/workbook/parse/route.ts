import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { WorkbookParseError } from "@/lib/workbook/errors";
import { loadWorkbookTenantIdentity } from "@/lib/workbook/export";
import { workbookErrorResponse } from "@/lib/workbook/http";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import { parseWorkbookUpload } from "@/lib/workbook/reader";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/* Room for the multipart envelope around the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function tooLarge(): never {
  throw new WorkbookParseError(
    "file_too_large",
    `The file exceeds the ${WORKBOOK_LIMITS.maxFileBytes}-byte limit.`,
    { maxBytes: WORKBOOK_LIMITS.maxFileBytes },
  );
}

/* Stateless parse of an uploaded workbook: nothing is stored, validated
   against the catalogue or applied. The response lists what was read. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireBranchContextMembership(db, tenantId, identity.subject);

    const contentLength = Number.parseInt(request.headers.get("content-length") ?? "", 10);
    if (Number.isFinite(contentLength) && contentLength > WORKBOOK_LIMITS.maxFileBytes + MULTIPART_OVERHEAD_BYTES) {
      tooLarge();
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "file is required.", code: "file_required", field: "file" },
        { status: 400, headers: staffPrivateCacheControl() },
      );
    }
    if (file.size > WORKBOOK_LIMITS.maxFileBytes) {
      tooLarge();
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const identityContext = await loadWorkbookTenantIdentity(db, tenantId);
    const result = await parseWorkbookUpload({ fileName: file.name, bytes }, identityContext);

    return NextResponse.json(result, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
