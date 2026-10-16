import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  confirmMenuExtraction,
  confirmMenuExtractionBodySchema,
} from "@/lib/catalogue/menu-extraction/service";
import { requireActiveStaffMembership, requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ tenantId: string; sourcePublicId: string }> };

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, sourcePublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const membership = await requireActiveStaffMembership(db, tenantId, identity.subject);
    const body = confirmMenuExtractionBodySchema.parse(await request.json());
    const result = await confirmMenuExtraction(
      db,
      { tenantId, subject: identity.subject, membership },
      sourcePublicId,
      body,
    );
    return NextResponse.json(result);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
