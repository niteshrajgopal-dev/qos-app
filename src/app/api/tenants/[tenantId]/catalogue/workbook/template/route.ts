import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { workbookErrorResponse } from "@/lib/workbook/http";
import {
  BLANK_TEMPLATE_FILE_NAME,
  buildBlankWorkbookTemplate,
  XLSX_CONTENT_TYPE,
} from "@/lib/workbook/template";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/* Blank 31-sheet workbook generated from the contract. It carries no
   tenant, brand, namespace, revision or export time. */
export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireBranchContextMembership(db, tenantId, identity.subject);

    const bytes = await buildBlankWorkbookTemplate();
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...staffPrivateCacheControl(),
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${BLANK_TEMPLATE_FILE_NAME}"`,
      },
    });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
