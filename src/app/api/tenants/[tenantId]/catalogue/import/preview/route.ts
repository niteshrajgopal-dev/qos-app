import { NextResponse } from "next/server";

import { db } from "@/db";
import type { CatalogueImportColumnMapping } from "@/db/schema";
import { previewCatalogueImport } from "@/lib/catalogue/catalogue-import";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

function parseColumnMapping(raw: string | null): CatalogueImportColumnMapping | undefined {
  if (!raw?.trim()) {
    return undefined;
  }

  return JSON.parse(raw) as CatalogueImportColumnMapping;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );

    const formData = await request.formData();
    const file = formData.get("file");
    const connectionKey = String(formData.get("connectionKey") ?? "").trim();
    const idempotencyKey =
      request.headers.get("idempotency-key")?.trim() ||
      String(formData.get("idempotencyKey") ?? "").trim();

    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "file is required.", field: "file" },
        { status: 400 },
      );
    }

    if (!connectionKey) {
      return NextResponse.json(
        { error: "connectionKey is required.", field: "connectionKey" },
        { status: 400 },
      );
    }

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", field: "idempotencyKey" },
        { status: 400 },
      );
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const columnMapping = parseColumnMapping(
      String(formData.get("columnMapping") ?? ""),
    );

    const result = await previewCatalogueImport(
      db,
      tenantId,
      membership,
      identity.subject,
      {
        fileName: file.name,
        bytes,
        connectionKey,
        columnMapping,
        idempotencyKey,
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
