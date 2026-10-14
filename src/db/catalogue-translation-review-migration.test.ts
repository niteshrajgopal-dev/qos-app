import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue translation review migration (0047)", () => {
  let sql: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    sql = connection.sql;
    await grantRoleMembership(sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("adds catalogue_translation capability and decisions table", async () => {
    const [enumRow] = await sql`
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'qos' AND t.typname = 'agent_capability' AND e.enumlabel = 'catalogue_translation'`;
    expect(enumRow).toBeTruthy();

    const [table] = await sql`SELECT to_regclass('qos.agent_run_catalogue_translation_decisions') AS t`;
    expect(String(table?.t ?? "")).toContain("agent_run_catalogue_translation_decisions");
  });
});
