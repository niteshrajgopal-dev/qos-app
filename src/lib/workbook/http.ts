import { NextResponse } from "next/server";

import { StaffAuthorizationError } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";
import { StaffAuthError, staffPrivateCacheControl } from "@/lib/staff/session";
import { mapTenantInactiveRouteError } from "@/lib/tenant/tenant-status";
import { WorkbookParseError } from "@/lib/workbook/errors";
import { WorkbookExportError } from "@/lib/workbook/export";

/* Workbook routes answer with a stable `code` the staff UI translates.
   Authentication and membership errors keep the shared staff semantics
   (401, 403, 404, tenant_inactive). Anything unexpected is a 500 without
   internal detail. */
export function workbookErrorResponse(error: unknown) {
  const headers = staffPrivateCacheControl();

  if (error instanceof WorkbookParseError) {
    return NextResponse.json(
      { error: error.message, code: error.code, params: error.params },
      { status: error.code === "file_too_large" ? 413 : 400, headers },
    );
  }

  if (error instanceof WorkbookExportError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.statusCode, headers },
    );
  }

  if (
    error instanceof StaffAuthError ||
    error instanceof StaffAuthorizationError ||
    mapTenantInactiveRouteError(error)
  ) {
    return staffErrorResponse(error);
  }

  console.error("Workbook route failed", error);
  return NextResponse.json({ error: "Unexpected error." }, { status: 500, headers });
}
