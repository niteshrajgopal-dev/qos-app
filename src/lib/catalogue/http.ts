import { NextResponse } from "next/server";

import {
  MenuConflictError,
  MenuError,
} from "@/lib/catalogue/menus";
import {
  CatalogueProductConflictError,
  CatalogueProductError,
} from "@/lib/catalogue/products";
import { LocationPriceOverrideError } from "@/lib/catalogue/location-price-overrides";
import {
  TranslationApprovalConflictError,
  TranslationApprovalError,
} from "@/lib/catalogue/translation-approval";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { StaffAuthError } from "@/lib/staff/session";

export function catalogueErrorResponse(error: unknown) {
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

  if (error instanceof MenuConflictError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof MenuError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof CatalogueProductConflictError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof CatalogueProductError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof TranslationApprovalConflictError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof TranslationApprovalError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof LocationPriceOverrideError) {
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
