import { NextResponse } from "next/server";

import { CustomerContractError } from "@/lib/customer/customer-contract";
import { CustomerAssociationError } from "@/lib/customer/association";
import { CustomerAuthError } from "@/lib/customer/session";

export function mapCustomerRouteError(error: unknown) {
  if (error instanceof CustomerContractError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: error.message,
        field: error.field,
        supportedContractVersions: error.supportedContractVersions,
      },
    };
  }

  if (error instanceof CustomerAuthError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof CustomerAssociationError) {
    return {
      statusCode: error.statusCode,
      body: { error: error.message, field: error.field },
    };
  }

  if (error instanceof Error) {
    return {
      statusCode: 500,
      body: { error: error.message },
    };
  }

  return {
    statusCode: 500,
    body: { error: "Unexpected error." },
  };
}

export function customerErrorResponse(error: unknown) {
  const mapped = mapCustomerRouteError(error);
  return NextResponse.json(mapped.body, { status: mapped.statusCode });
}
