import { NextResponse } from "next/server";

import { db } from "@/db";
import { provisionBusiness } from "@/lib/onboarding/provision-business";
import {
  authorizeOperatorRequest,
  onboardingErrorResponse,
} from "@/lib/onboarding/http";
import type { ProvisionBusinessInput } from "@/lib/onboarding/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const operator = authorizeOperatorRequest(request.headers);
    const idempotencyKey = request.headers.get("idempotency-key") ?? "";
    const body = (await request.json()) as ProvisionBusinessInput;
    const result = await provisionBusiness(db, operator, idempotencyKey, body);

    return NextResponse.json(result, {
      status: result.idempotentReplay ? 200 : 201,
    });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}
