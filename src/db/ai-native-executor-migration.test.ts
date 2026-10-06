import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { agentPlatformAdminSetting } from "@/db/schema";
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

integrationDescribe("0045 AI native executor migration", () => {
  let connection: Awaited<ReturnType<typeof createIntegrationDb>>;
  let previousFolder: string;

  beforeAll(async () => {
    connection = await createIntegrationDb();
    previousFolder = await mkdtemp(path.join(os.tmpdir(), "qos-drizzle-0044-"));
    await cp(path.join(process.cwd(), "drizzle"), previousFolder, { recursive: true });

    const journalPath = path.join(previousFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const cutoff = journal.entries.findIndex((entry) => entry.tag === "0045_ai_native_executor");
    journal.entries = journal.entries.slice(0, cutoff);
    await writeFile(journalPath, JSON.stringify(journal));
  }, 60_000);

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 });
    await rm(previousFolder, { recursive: true, force: true });
  });

  it("adds agents_sdk, makes binding_id nullable, and leaves existing Hyperagent runs intact", async () => {
    const { db, sql } = connection;
    await sql`DROP SCHEMA IF EXISTS qos CASCADE`;
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;

    await migrate(db, { migrationsFolder: previousFolder });
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const [binding] = await sql.begin(async (tx) => {
      await tx`SELECT set_config(${agentPlatformAdminSetting}, 'true', true)`;
      return tx`
        INSERT INTO qos.tenant_agent_bindings
          (tenant_id, public_id, capability, provider, provider_agent_id, enabled, approved_by_subject)
        VALUES (${tenantId}, 'agb_hyperagent', 'menu_manager', 'hyperagent', 'agent_legacy', true, 'operator:platform')
        RETURNING id`;
    });
    const [legacy] = await sql`
      INSERT INTO qos.agent_runs
        (tenant_id, public_id, binding_id, capability, provider, provider_agent_id, provider_thread_id,
         status, subject_type, subject_public_id, subject_version, requested_by_subject,
         requested_by_actor_class, idempotency_key, correlation_id, request_summary, deadline_at, started_at)
      VALUES (${tenantId}, 'run_legacy', ${binding!.id}, 'menu_manager', 'hyperagent', 'agent_legacy', 'thread_legacy',
              'running', 'menu', 'men_breakfast', 3, 'admin.quotes@test',
              'staff_administrator', 'idem-legacy-0001', gen_random_uuid(), '{"productCount":2}'::jsonb,
              now() + interval '10 minutes', now())
      RETURNING id, binding_id, provider`;

    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

    const [after] = await sql`SELECT id, binding_id, provider FROM qos.agent_runs WHERE id = ${legacy!.id}`;
    expect(after).toEqual(legacy);

    const labels = await sql`
      SELECT enumlabel FROM pg_enum
      WHERE enumtypid = 'qos.agent_provider'::regtype
      ORDER BY enumsortorder`;
    expect(labels.map((row) => row.enumlabel)).toEqual(["hyperagent", "agents_sdk"]);

    const [bindingColumn] = await sql`
      SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = 'qos' AND table_name = 'agent_runs' AND column_name = 'binding_id'`;
    expect(bindingColumn).toEqual({ is_nullable: "YES" });

    await expect(
      sql`
        INSERT INTO qos.agent_runs
          (tenant_id, public_id, binding_id, capability, provider, provider_agent_id, status, subject_type,
           subject_public_id, requested_by_subject, requested_by_actor_class, idempotency_key, correlation_id,
           request_summary, deadline_at)
        VALUES (${tenantId}, 'run_hyperagent_unbound', NULL, 'menu_manager', 'hyperagent', 'agent_legacy', 'queued',
                'menu', 'men_unbound', 'admin.quotes@test', 'staff_administrator', 'idem-unbound-0001',
                gen_random_uuid(), '{}'::jsonb, now())`,
    ).rejects.toMatchObject({ code: "23514" });

    const [native] = await sql`
      INSERT INTO qos.agent_runs
        (tenant_id, public_id, binding_id, capability, provider, provider_agent_id, status, subject_type,
         subject_public_id, requested_by_subject, requested_by_actor_class, idempotency_key, correlation_id,
         request_summary, deadline_at)
      VALUES (${tenantId}, 'run_native', NULL, 'menu_manager', 'agents_sdk', 'qos.menu_manager', 'queued',
              'menu', 'men_native', 'admin.quotes@test', 'staff_administrator', 'idem-native-0001',
              gen_random_uuid(), '{}'::jsonb, now())
      RETURNING provider, binding_id`;
    expect(native).toEqual({ provider: "agents_sdk", binding_id: null });

    const deletable = await sql`
      SELECT table_name FROM information_schema.role_table_grants
      WHERE grantee = 'qos_app' AND privilege_type = 'DELETE'
        AND table_schema = 'qos' AND table_name = ANY(${AGENT_TABLES})`;
    expect(deletable.map((row) => row.table_name)).toEqual(["agent_provider_credentials"]);
  }, 120_000);
});
