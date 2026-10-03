import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const TABLES = ["ai_spend_platform_counters", "ai_spend_reservations", "ai_spend_tenant_counters"];

integrationDescribe("0041 AI spend admission migration", () => {
  let connection: Awaited<ReturnType<typeof resetAndMigrate>>;

  beforeAll(async () => {
    connection = await resetAndMigrate();
  }, 120_000);

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 });
  });

  it("forces row-level security and grants the app role no DELETE", async () => {
    const { sql } = connection;
    const security = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'qos'::regnamespace AND relname IN ${sql(TABLES)}
      ORDER BY relname`;
    expect(security).toEqual(
      TABLES.map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true })),
    );

    for (const table of TABLES) {
      const grants = await sql`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'qos_app' AND table_schema = 'qos' AND table_name = ${table}
        ORDER BY privilege_type`;
      expect(grants.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT", "UPDATE"]);
    }
  });

  it("keeps the platform counters free of tenant data", async () => {
    const columns = await connection.sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'qos' AND table_name = 'ai_spend_platform_counters'
      ORDER BY ordinal_position`;
    expect(columns.map((row) => row.column_name)).toEqual(["scope_key", "window_start", "units"]);
  });
});
