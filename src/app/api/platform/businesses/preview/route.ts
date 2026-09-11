import { NextResponse } from "next/server";

import { previewProvisionBusiness } from "@/lib/onboarding/provision-business";
import {
  authorizeOperatorRequest,
  onboardingErrorResponse,
} from "@/lib/onboarding/http";
import type { ProvisionBusinessInput } from "@/lib/onboarding/validation";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    authorizeOperatorRequest(request.headers);
    const body = (await request.json()) as ProvisionBusinessInput;
    const preview = previewProvisionBusiness(body);

    return NextResponse.json({ preview });
  } catch (error) {
    return onboardingErrorResponse(error);
  }
}
