import { NextResponse } from "next/server";

import {
  AccessRequestConflictError,
  AccessRequestError,
} from "@/lib/staff/access-requests";
import { StaffAuthorizationError } from "@/lib/staff/auth";

export function staffErrorResponse(error: unknown) {
  if (error instanceof StaffAuthorizationError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  if (error instanceof AccessRequestConflictError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  if (error instanceof AccessRequestError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}
