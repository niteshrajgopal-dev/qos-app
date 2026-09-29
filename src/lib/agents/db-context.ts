import { sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  agentCredentialAccessSetting,
  agentPlatformAdminSetting,
} from "@/db/schema";
import { setTenantContext, type DbTransaction } from "@/lib/tenant/context";

/**
 * Opens a transaction that can read and update the encrypted provider
 * credentials. Keep the callback to credential handling only.
 */
export async function withAgentCredentialAccess<T>(
  db: DbClient,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config(${agentCredentialAccessSetting}, 'true', true)`,
    );
    return fn(tx);
  });
}

/**
 * Platform operator context: create or replace the provider connection and
 * approve provider agents for tenant capabilities. Only operator tooling may
 * use this; it is never reachable from a tenant request.
 */
export async function withAgentPlatformAdmin<T>(
  db: DbClient,
  fn: (tx: DbTransaction) => Promise<T>,
  options: { tenantId?: string } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config(${agentPlatformAdminSetting}, 'true', true)`,
    );
    if (options.tenantId) {
      await setTenantContext(tx, options.tenantId);
    }
    return fn(tx);
  });
}
