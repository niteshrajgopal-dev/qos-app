import { NextResponse } from "next/server";

import { db } from "@/db";
import {
  buildCatalogueImportSampleXlsx,
  CATALOGUE_IMPORT_SAMPLE_CSV,
} from "@/lib/catalogue/catalogue-import-sample";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    await requireActiveStaffMembership(db, tenantId, identity.subject);

    const format = new URL(request.url).searchParams.get("format")?.toLowerCase();

    if (format === "xlsx") {
      const bytes = buildCatalogueImportSampleXlsx();
      return new NextResponse(new Uint8Array(bytes), {
        status: 200,
        headers: {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition":
            'attachment; filename="qos-catalogue-import-sample.xlsx"',
        },
      });
    }

    return new NextResponse(CATALOGUE_IMPORT_SAMPLE_CSV, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="qos-catalogue-import-sample.csv"',
      },
    });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
