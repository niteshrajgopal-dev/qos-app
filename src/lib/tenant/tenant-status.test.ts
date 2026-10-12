import { describe, expect, it } from "vitest";

import {
  mapTenantInactiveRouteError,
  TenantInactiveError,
} from "@/lib/tenant/tenant-status";

describe("tenant status guard", () => {
  it("maps inactive tenant errors to a stable HTTP payload", () => {
    const error = new TenantInactiveError();

    expect(mapTenantInactiveRouteError(error)).toEqual({
      statusCode: 403,
      body: {
        error: "This business is not active.",
        code: "tenant_inactive",
      },
    });
    expect(mapTenantInactiveRouteError(new Error("other"))).toBeNull();
  });

  it("uses a 403 response with tenant_inactive code", () => {
    const error = new TenantInactiveError();
    expect(error.statusCode).toBe(403);
    expect(error.code).toBe("tenant_inactive");
  });
});
