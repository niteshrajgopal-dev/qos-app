import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { BRANCH_SEARCH_PARAM } from "@/lib/staff/branch-selection";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { buildCurrentRecordWorkbook, loadCurrentRecordExport } from "@/lib/workbook/export";
import { workbookErrorResponse } from "@/lib/workbook/http";
import { XLSX_CONTENT_TYPE } from "@/lib/workbook/template";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/* Current-record export of the supported catalogue sheets. Read only. A
   `branch` parameter narrows branch rows to one permitted branch (403 when
   it is not permitted); it never widens what the membership may see. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireBranchContextMembership(db, tenantId, identity.subject);

    const search = new URL(request.url).searchParams;
    const data = await loadCurrentRecordExport(db, tenantId, membership, {
      branch: search.get(BRANCH_SEARCH_PARAM),
      brand: search.get("brand"),
    });
    const bytes = await buildCurrentRecordWorkbook(data);

    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...staffPrivateCacheControl(),
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${data.fileName}"`,
      },
    });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
