import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  acceptCatalogueDescription,
  acceptDescriptionBodySchema,
  resolveCaller,
} from "@/lib/catalogue/description-draft/service";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = await requireStaffIdentity(request);
    const caller = await resolveCaller(db, tenantId, identity.subject);
    const body = acceptDescriptionBodySchema.parse(await request.json());
    const result = await acceptCatalogueDescription(db, caller, productPublicId, body);
    return NextResponse.json({
      review: result.review,
      idempotentReplay: result.idempotentReplay,
    });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
