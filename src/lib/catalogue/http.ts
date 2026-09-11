import { NextResponse } from "next/server";

import {
  CatalogueProductConflictError,
  CatalogueProductError,
} from "@/lib/catalogue/products";
import { StaffAuthorizationError } from "@/lib/staff/auth";

export function catalogueErrorResponse(error: unknown) {
  if (error instanceof StaffAuthorizationError) {
    return NextResponse.json(
      { error: error.message },
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

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}
