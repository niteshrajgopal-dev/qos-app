import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import {
  acceptCatalogueTranslation,
  acceptTranslationBodySchema,
  resolveCaller,
} from "@/lib/catalogue/translation-review/service";
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
    const body = acceptTranslationBodySchema.parse(await request.json());
    const result = await acceptCatalogueTranslation(db, caller, productPublicId, body);
    return NextResponse.json(result);
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
