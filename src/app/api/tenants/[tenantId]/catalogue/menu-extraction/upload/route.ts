import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { readMenuExtractionConfig } from "@/lib/catalogue/menu-extraction/config";
import {
  MenuExtractionUploadError,
  uploadMenuExtractionSource,
} from "@/lib/catalogue/menu-extraction/upload";
import { requireAdministratorMembership } from "@/lib/staff/auth";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ tenantId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    await requireAdministratorMembership(db, tenantId, identity.subject);

    const config = readMenuExtractionConfig();
    const contentLengthHeader = request.headers.get("content-length");
    if (contentLengthHeader) {
      const contentLength = Number.parseInt(contentLengthHeader, 10);
      if (Number.isFinite(contentLength) && contentLength > config.maxUploadBytes) {
        return NextResponse.json(
          { error: "Uploaded file exceeds the configured size limit.", field: "file" },
          { status: 413 },
        );
      }
    }

    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "file is required.", field: "file" }, { status: 400 });
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadMenuExtractionSource(
      db,
      tenantId,
      membership,
      identity.subject,
      {
        fileName: file.name,
        bytes,
        contentType: file.type,
      },
    );
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof MenuExtractionUploadError) {
      return NextResponse.json(
        { error: error.message, field: error.field },
        { status: error.statusCode },
      );
    }
    return catalogueErrorResponse(error);
  }
}
