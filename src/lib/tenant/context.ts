import { sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { tenantContextSetting } from "@/db/schema";

export type DbTransaction = Parameters<
  Parameters<DbClient["transaction"]>[0]
>[0];

export type TenantDbExecutor = DbClient | DbTransaction;

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

export async function setTenantContext(
  executor: TenantDbExecutor,
  tenantId: string,
) {
  await executor.execute(
    sql`select set_config(${tenantContextSetting}, ${tenantId}, true)`,
  );
}

export async function clearTenantContext(executor: TenantDbExecutor) {
  await executor.execute(
    sql`select set_config(${tenantContextSetting}, '', true)`,
  );
}

export async function withTenantContext<T>(
  db: DbClient,
  tenantId: string,
  fn: (tx: DbTransaction) => Promise<T>,
): Promise<T> {
  if (!tenantId) {
    throw new TenantContextError("Tenant context is required.");
  }

  return db.transaction(async (tx) => {
    await setTenantContext(tx, tenantId);
    return fn(tx);
  });
}

export async function readTenantContext(
  executor: TenantDbExecutor,
): Promise<string | null> {
  const result = await executor.execute<{ tenant_id: string | null }>(
    sql`select nullif(current_setting(${tenantContextSetting}, true), '') as tenant_id`,
  );

  const rows = result as { tenant_id: string | null }[];
  return rows[0]?.tenant_id ?? null;
}
