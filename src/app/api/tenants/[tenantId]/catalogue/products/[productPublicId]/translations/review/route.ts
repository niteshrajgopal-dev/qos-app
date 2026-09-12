import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { getProductTranslationReview } from "@/lib/catalogue/translation-approval";
import {
  requireActiveStaffMembership,
  requireStaffIdentity,
} from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId } = await context.params;
    const identity = requireStaffIdentity(_request.headers);
    await requireActiveStaffMembership(db, tenantId, identity.subject);

    const review = await getProductTranslationReview(
      db,
      tenantId,
      productPublicId,
    );

    if (!review) {
      return NextResponse.json({ error: "Product not found." }, { status: 404 });
    }

    return NextResponse.json({ review });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
