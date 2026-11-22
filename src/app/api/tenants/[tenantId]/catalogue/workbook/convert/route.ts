import { NextResponse } from "next/server";

import { db } from "@/db";
import { requireStaffIdentity } from "@/lib/staff/auth";
import { requireBranchContextMembership } from "@/lib/staff/branch-context";
import { staffPrivateCacheControl } from "@/lib/staff/session";
import { loadWorkbookTenantIdentity, resolveWorkbookBrand, WorkbookExportError } from "@/lib/workbook/export";
import { assertConvertible, buildConvertedWorkbook, convertedFileName } from "@/lib/workbook/foodics-menu/convert";
import { readWorkbookUploadForm, workbookErrorResponse } from "@/lib/workbook/http";
import { parseWorkbookUpload } from "@/lib/workbook/reader";
import { XLSX_CONTENT_TYPE } from "@/lib/workbook/template";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

/* QOS-216: converts an uploaded Foodics menu workbook into the canonical QOS
   workbook. Stateless and read only: it is the parse result written by the
   existing workbook builder; nothing is stored, audited, validated against
   the catalogue or applied. Row-level notes do not block the download; they
   travel in the workbook's Source Map. */
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
    const brandPublicId = resolveWorkbookBrand(tenant, upload.brand);
    const result = await parseWorkbookUpload(
      { fileName: upload.fileName, bytes: upload.bytes },
      {
        tenantPublicId: tenant.tenantPublicId,
        brandPublicIds: tenant.brandPublicIds,
        tenantCurrency: tenant.baseCurrency,
        brandPublicId,
        brandChoices: tenant.brands,
      },
    );
    assertConvertible(result);

    if (!brandPublicId) {
      if (tenant.brands.length === 0) {
        throw new WorkbookExportError("no_brand", "This business has no brand.", 409);
      }
      throw new WorkbookExportError("brand_required", "Choose the brand for this menu.", 400, { brands: tenant.brands });
    }

    const bytes = await buildConvertedWorkbook(result, { businessTimezone: tenant.defaultTimezone ?? "" });
    return new NextResponse(new Uint8Array(bytes), {
      status: 200,
      headers: {
        ...staffPrivateCacheControl(),
        "Content-Type": XLSX_CONTENT_TYPE,
        "Content-Disposition": `attachment; filename="${convertedFileName(result)}"`,
      },
    });
  } catch (error) {
    return workbookErrorResponse(error);
  }
}
