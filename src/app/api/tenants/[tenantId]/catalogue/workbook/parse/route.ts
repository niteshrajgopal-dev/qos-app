import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { loadWorkbookTenantIdentity, resolveWorkbookBrand } from "@/lib/workbook/export";
import { readWorkbookUploadForm, workbookErrorResponse } from "@/lib/workbook/http";
import { parseWorkbookUpload } from "@/lib/workbook/reader";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/* Stateless parse of an uploaded workbook: nothing is stored, validated
   against the catalogue or applied. The response lists what was read. The
   tenant's currency and brands come from the session's tenant, never from
   the file; an optional `brand` field selects one of the tenant's brands. */
export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireBranchContextMembership(db, tenantId, identity.subject);

    const upload = await readWorkbookUploadForm(request);
    if (upload instanceof NextResponse) {
      return upload;
    }

    const tenant = await loadWorkbookTenantIdentity(db, tenantId);
    const result = await parseWorkbookUpload(
      { fileName: upload.fileName, bytes: upload.bytes },
      {
        tenantPublicId: tenant.tenantPublicId,
        brandPublicIds: tenant.brandPublicIds,
        tenantCurrency: tenant.baseCurrency,
        brandPublicId: resolveWorkbookBrand(tenant, upload.brand),
        brandChoices: tenant.brands,
      },
    );

    return NextResponse.json(result, { headers: staffPrivateCacheControl() });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
