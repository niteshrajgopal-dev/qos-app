import { NextResponse } from "next/server";

import {
  OperatorAuthorizationError,
  rejectTenantSelfServiceProvisioning,
  requireOperatorIdentity,
} from "@/lib/platform/operator-auth";
import { OnboardingValidationError } from "@/lib/onboarding/validation";

export function onboardingErrorResponse(error: unknown) {
  if (error instanceof OperatorAuthorizationError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  if (error instanceof OnboardingValidationError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}

export function authorizeOperatorRequest(headers: Headers) {
  rejectTenantSelfServiceProvisioning(headers);
  return requireOperatorIdentity(headers);
}
