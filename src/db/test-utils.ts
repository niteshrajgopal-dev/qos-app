import { migrate } from "drizzle-orm/postgres-js/migrator";
import path from "node:path";

import { createDbClient } from "@/db/client";

export const integrationDatabaseUrl =
  process.env.INTEGRATION_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgresql://qos:qos@localhost:5432/qos";

export function hasIntegrationDatabase() {
  return Boolean(integrationDatabaseUrl);
}

export async function createIntegrationDb() {
  return createDbClient({
    DATABASE_URL: integrationDatabaseUrl,
    DB_POOL_MAX: "1",
  });
}

export async function resetAndMigrate() {
  const { db, sql: connection } = await createIntegrationDb();

  await connection`DROP SCHEMA IF EXISTS qos CASCADE`;
  await connection`DROP TABLE IF EXISTS drizzle.__drizzle_migrations CASCADE`;
  await connection`DROP SCHEMA IF EXISTS drizzle CASCADE`;

  await migrate(db, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });

  return { db, sql: connection };
}

export async function grantRoleMembership(
  sqlClient: ReturnType<typeof createDbClient>["sql"],
  member: string,
  role: string,
) {
  await sqlClient.unsafe(`GRANT ${role} TO ${member}`);
}

export async function runAsRole<T>(
  sqlClient: ReturnType<typeof createDbClient>["sql"],
  role: string,
  fn: () => Promise<T>,
): Promise<T> {
  await sqlClient.unsafe(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await sqlClient.unsafe("RESET ROLE");
  }
}

export async function tableCount(
  sqlClient: ReturnType<typeof createDbClient>["sql"],
  table: string,
) {
  const rows = await sqlClient.unsafe(
    `SELECT count(*)::int AS count FROM qos.${table}`,
  );
  const count = (rows[0] as { count?: number }).count;
  return Number(count ?? 0);
}
