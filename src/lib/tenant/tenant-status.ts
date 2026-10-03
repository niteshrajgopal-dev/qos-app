import { and, eq } from "drizzle-orm";

import { tenants } from "@/db/schema";
import type { TenantDbExecutor } from "@/lib/tenant/context";

export class TenantInactiveError extends Error {
  readonly statusCode = 403;
  readonly code = "tenant_inactive";

  constructor() {
    super("This business is not active.");
    this.name = "TenantInactiveError";
  }
}

/**
 * Throws unless the tenant exists and is active. Must run inside the
 * tenant's context; a row hidden by RLS counts as inactive.
 */
export async function assertTenantActive(tx: TenantDbExecutor, tenantId: string) {
  const [row] = await tx
    .select({ status: tenants.status })
    .from(tenants)
    .where(and(eq(tenants.id, tenantId), eq(tenants.status, "active")))
    .limit(1);
  if (!row) {
    throw new TenantInactiveError();
  }
}
