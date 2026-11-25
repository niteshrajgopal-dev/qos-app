import { NextResponse } from "next/server";

import { InventoryDependencyError, InventoryDetailError, InventoryError } from "@/lib/inventory/errors";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { StaffAuthError } from "@/lib/staff/session";
import { mapTenantInactiveRouteError } from "@/lib/tenant/tenant-status";

/* QOS-195 route error mapping, mirroring catalogueErrorResponse: typed
   payloads `{ error, field, code }` with the service's status code. QOS-196
   adds `dependencies` when a 409 is explained by dependent records; QOS-198
   adds `detail` (for example a refused recipe cycle's item path). */
export function inventoryErrorResponse(error: unknown) {
  const tenantInactive = mapTenantInactiveRouteError(error);
  if (tenantInactive) {
    return NextResponse.json(tenantInactive.body, { status: tenantInactive.statusCode });
  }

  if (error instanceof InventoryDependencyError) {
    return NextResponse.json(
      { error: error.message, field: error.field, code: error.code, dependencies: error.dependencies },
      { status: error.statusCode },
    );
  }

  if (error instanceof InventoryDetailError) {
    return NextResponse.json(
      { error: error.message, field: error.field, code: error.code, detail: error.detail },
      { status: error.statusCode },
    );
  }

  if (error instanceof InventoryError) {
    return NextResponse.json(
      { error: error.message, field: error.field, code: error.code },
      { status: error.statusCode },
    );
  }

  if (error instanceof StaffAuthError) {
    return NextResponse.json({ error: error.message, field: error.field }, { status: error.statusCode });
  }

  if (error instanceof StaffAuthorizationError) {
    return NextResponse.json({ error: error.message }, { status: error.statusCode });
  }

  if (error instanceof Error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  return NextResponse.json({ error: "Unexpected error." }, { status: 500 });
}
