import { NextResponse } from "next/server";

import { StaffAuthorizationError } from "@/lib/staff/auth";
import { staffErrorResponse } from "@/lib/staff/http";
import { StaffAuthError, staffPrivateCacheControl } from "@/lib/staff/session";
import { mapTenantInactiveRouteError } from "@/lib/tenant/tenant-status";
import { WorkbookApplyError } from "@/lib/workbook/apply/errors";
import { WorkbookParseError } from "@/lib/workbook/errors";
import { WorkbookExportError } from "@/lib/workbook/export";
import { WORKBOOK_LIMITS } from "@/lib/workbook/limits";
import { WorkbookReviewError } from "@/lib/workbook/validation/errors";

/* Workbook routes answer with a stable `code` the staff UI translates.
   Authentication and membership errors keep the shared staff semantics
   (401, 403, 404, tenant_inactive). Anything unexpected is a 500 without
   internal detail. */
export function workbookErrorResponse(error: unknown) {
  const headers = staffPrivateCacheControl();

  if (error instanceof WorkbookParseError) {
    return NextResponse.json(
      { error: error.message, code: error.code, params: error.params },
      { status: error.code === "file_too_large" ? 413 : error.code === "convert_too_large" ? 422 : 400, headers },
    );
  }

  if (error instanceof WorkbookExportError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.statusCode, headers },
    );
  }

  if (error instanceof WorkbookApplyError) {
    return NextResponse.json(
      { error: error.message, code: error.code, ...error.details },
      { status: error.statusCode, headers },
    );
  }

  if (error instanceof WorkbookReviewError) {
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

/* Room for the multipart envelope around the file itself. */
const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

function tooLarge(): never {
  throw new WorkbookParseError(
    "file_too_large",
    `The file exceeds the ${WORKBOOK_LIMITS.maxFileBytes}-byte limit.`,
    { maxBytes: WORKBOOK_LIMITS.maxFileBytes },
  );
}

/**
 * Reads the multipart upload shared by parse, convert and preview: the `file`,
 * an optional `brand`, and for preview (QOS-194) an optional `branch` and
 * `decisions` (parse and convert ignore those two). Oversize bodies are
 * refused before and after reading. Returns a 400 response when no file was
 * sent.
 */
export async function readWorkbookUploadForm(
  request: Request,
): Promise<
  { fileName: string; bytes: Buffer; brand: string | null; branch: string | null; decisions: string | null } | NextResponse
> {
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
  const brand = formData.get("brand");
  const branch = formData.get("branch");
  const decisions = formData.get("decisions");
  return {
    fileName: file.name,
    bytes: Buffer.from(await file.arrayBuffer()),
    brand: typeof brand === "string" && brand.trim() ? brand.trim() : null,
    branch: typeof branch === "string" && branch.trim() ? branch.trim() : null,
    decisions: typeof decisions === "string" && decisions.trim() ? decisions : null,
  };
}
