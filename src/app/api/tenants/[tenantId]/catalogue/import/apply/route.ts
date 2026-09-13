import { NextResponse } from "next/server";

import { db } from "@/db";
import { applyCatalogueImport } from "@/lib/catalogue/catalogue-import";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(
      db,
      tenantId,
      identity.subject,
    );

    const body = (await request.json()) as {
      operationPublicId?: string;
      previewHash?: string;
    };
    const idempotencyKey = request.headers.get("idempotency-key")?.trim() ?? "";

    if (!body.operationPublicId?.trim()) {
      return NextResponse.json(
        { error: "operationPublicId is required.", field: "operationPublicId" },
        { status: 400 },
      );
    }

    if (!body.previewHash?.trim()) {
      return NextResponse.json(
        { error: "previewHash is required.", field: "previewHash" },
        { status: 400 },
      );
    }

    if (!idempotencyKey) {
      return NextResponse.json(
        { error: "Idempotency-Key header is required.", field: "idempotencyKey" },
        { status: 400 },
      );
    }

    const result = await applyCatalogueImport(
      db,
      tenantId,
      membership,
      identity.subject,
      {
        operationPublicId: body.operationPublicId.trim(),
        previewHash: body.previewHash.trim(),
        idempotencyKey,
      },
    );

    return NextResponse.json(result);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
