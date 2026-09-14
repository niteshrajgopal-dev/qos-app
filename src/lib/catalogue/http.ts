import { NextResponse } from "next/server";

import {
  MenuConflictError,
  MenuError,
} from "@/lib/catalogue/menus";
import {
  CatalogueProductConflictError,
  CatalogueProductError,
} from "@/lib/catalogue/products";
import {
  CatalogueCategoryConflictError,
  CatalogueCategoryError,
} from "@/lib/catalogue/categories";
import {
  CatalogueModifierConflictError,
  CatalogueModifierError,
} from "@/lib/catalogue/modifiers";
import {
  CatalogueVariantConflictError,
  CatalogueVariantError,
} from "@/lib/catalogue/variants";
import { LocationPriceOverrideError } from "@/lib/catalogue/location-price-overrides";
import { LocationAvailabilityError } from "@/lib/catalogue/location-availability";
import { CatalogueImportError } from "@/lib/catalogue/catalogue-import";
import { CatalogueImportParseError } from "@/lib/catalogue/catalogue-import-parser";
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

  if (error instanceof CatalogueCategoryConflictError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof CatalogueCategoryError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof CatalogueModifierConflictError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof CatalogueModifierError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof CatalogueVariantConflictError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof CatalogueVariantError) {
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

  if (error instanceof LocationAvailabilityError) {
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

  if (error instanceof CatalogueImportError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: error.statusCode },
    );
  }

  if (error instanceof CatalogueImportParseError) {
    return NextResponse.json(
      { error: error.message, field: error.field },
      { status: 400 },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}
