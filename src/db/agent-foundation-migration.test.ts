import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createIntegrationDb, hasIntegrationDatabase } from "@/db/test-utils";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const AGENT_TABLES = [
  "agent_provider_connections",
  "agent_provider_credentials",
  "tenant_agent_bindings",
  "agent_runs",
];

integrationDescribe("0038 agent platform foundation migration", () => {
  let connection: Awaited<ReturnType<typeof createIntegrationDb>>;
  let previousFolder: string;

  beforeAll(async () => {
    connection = await createIntegrationDb();
    const sourceFolder = path.join(process.cwd(), "drizzle");
    previousFolder = await mkdtemp(path.join(os.tmpdir(), "qos-drizzle-0037-"));
    await cp(sourceFolder, previousFolder, { recursive: true });

    const journalPath = path.join(previousFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    journal.entries = journal.entries.filter(
      (entry) => entry.tag !== "0038_agent_platform_foundation",
    );
    await writeFile(journalPath, JSON.stringify(journal));
  }, 60_000);

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 });
    await rm(previousFolder, { recursive: true, force: true });
  });

  it("applies forward from the current schema without touching existing data", async () => {
    const { db, sql } = connection;
    await sql`DROP SCHEMA IF EXISTS qos CASCADE`;
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;

    await migrate(db, { migrationsFolder: previousFolder });
    const before = await sql`SELECT to_regclass('qos.agent_runs') AS t`;
    expect(before[0]!.t).toBeNull();

    const quotes = await createTenantHierarchy(db, quotesTenantFixture());

    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

    const tenants = await sql`SELECT id FROM qos.tenants`;
    expect(tenants.map((row) => row.id)).toEqual([quotes.tenant.id]);

    const security = await sql`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relnamespace = 'qos'::regnamespace AND relname = ANY(${AGENT_TABLES})
      ORDER BY relname`;
    expect(security).toHaveLength(AGENT_TABLES.length);
    for (const table of security) {
      expect(table.relrowsecurity).toBe(true);
      expect(table.relforcerowsecurity).toBe(true);
    }

    const triggers = await sql`
      SELECT tgname FROM pg_trigger
      WHERE tgname IN ('tenant_agent_bindings_guard', 'agent_runs_transition_guard')
      ORDER BY tgname`;
    expect(triggers.map((row) => row.tgname)).toEqual([
      "agent_runs_transition_guard",
      "tenant_agent_bindings_guard",
    ]);

    const deletable = await sql`
      SELECT table_name FROM information_schema.role_table_grants
      WHERE grantee = 'qos_app' AND privilege_type = 'DELETE'
        AND table_schema = 'qos' AND table_name = ANY(${AGENT_TABLES})`;
    expect(deletable.map((row) => row.table_name)).toEqual(["agent_provider_credentials"]);
  }, 120_000);
});
