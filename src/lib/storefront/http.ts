import { NextResponse } from "next/server";

import { StaffAuthorizationError } from "@/lib/staff/auth";
import { StaffAuthError } from "@/lib/staff/session";
import {
  StorefrontConflictError,
  StorefrontError,
} from "@/lib/storefront/storefronts";
import { StorefrontPublishError } from "@/lib/storefront/storefront-publish";
import { StorefrontContentBlockValidationError } from "@/lib/storefront/storefront-content-blocks-schema";
import { StorefrontThemeValidationError } from "@/lib/storefront/storefront-theme-schema";

export function storefrontErrorResponse(error: unknown) {
  if (error instanceof StaffAuthError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof StaffAuthorizationError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  if (error instanceof StorefrontConflictError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof StorefrontPublishError) {
    return NextResponse.json(
      {
        error: error.message,
        field: error.field,
        issues: error.issues,
      },
      { status: error.statusCode },
    );
  }

  if (error instanceof StorefrontThemeValidationError) {
    return NextResponse.json(
      {
        error: error.message,
        field: error.field,
        issues: error.issues,
      },
      { status: 400 },
    );
  }

  if (error instanceof StorefrontContentBlockValidationError) {
    return NextResponse.json(
      {
        error: error.message,
        field: error.field,
        issues: error.issues,
      },
      { status: 400 },
    );
  }

  if (error instanceof StorefrontError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}
