import { NextResponse } from "next/server";

import { db } from "@/db";
import { addTenantLocation } from "@/lib/onboarding/add-location";
import {
  authorizeOperatorRequest,
  onboardingErrorResponse,
} from "@/lib/onboarding/http";

export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ tenantId: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  try {
    authorizeOperatorRequest(request.headers);
    const { tenantId } = await context.params;
    const body = (await request.json()) as {
      brandId?: string;
      name?: string;
      timezone?: string;
    };

    const location = await addTenantLocation(db, {
      tenantId,
      brandId: body.brandId ?? "",
      name: body.name ?? "",
      timezone: body.timezone ?? "",
    });

    return NextResponse.json({ location }, { status: 201 });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}
