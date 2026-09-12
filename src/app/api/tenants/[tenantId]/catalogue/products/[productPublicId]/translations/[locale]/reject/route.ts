import { NextResponse } from "next/server";

import { db } from "@/db";
import { catalogueErrorResponse } from "@/lib/catalogue/http";
import { rejectProductTranslation } from "@/lib/catalogue/translation-approval";
import { requireStaffIdentity } from "@/lib/staff/auth";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    tenantId: string;
    productPublicId: string;
    locale: string;
  }>;
};

type RejectBody = {
  expectedTranslationVersion?: number;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const { tenantId, productPublicId, locale } = await context.params;
    const identity = await requireStaffIdentity(request);
    const body = (await request.json()) as RejectBody;
    const expectedTranslationVersion = Number(body.expectedTranslationVersion);

    if (
      !Number.isInteger(expectedTranslationVersion) ||
      expectedTranslationVersion < 1
    ) {
      return NextResponse.json(
        { error: "expectedTranslationVersion is required." },
        { status: 400 },
      );
    }

    const review = await rejectProductTranslation(
      db,
      tenantId,
      identity.subject,
      productPublicId,
      locale,
      { expectedTranslationVersion },
    );

    return NextResponse.json({ review });
  } catch (error) {
    return catalogueErrorResponse(error);
  }
}
