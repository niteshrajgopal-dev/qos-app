import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { agentPlatformAdminSetting } from "@/db/schema";
import { createIntegrationDb, grantRoleMembership, hasIntegrationDatabase, runAsRole } from "@/db/test-utils";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("0040 agent run pinning migration", () => {
  let connection: Awaited<ReturnType<typeof createIntegrationDb>>;
  let previousFolder: string;

  beforeAll(async () => {
    connection = await createIntegrationDb();
    previousFolder = await mkdtemp(path.join(os.tmpdir(), "qos-drizzle-0039-"));
    await cp(path.join(process.cwd(), "drizzle"), previousFolder, { recursive: true });

    const journalPath = path.join(previousFolder, "meta", "_journal.json");
    const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const cutoff = journal.entries.findIndex((entry) => entry.tag === "0040_agent_run_pinning");
    journal.entries = journal.entries.slice(0, cutoff);
    await writeFile(journalPath, JSON.stringify(journal));
  }, 60_000);

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 });
    await rm(previousFolder, { recursive: true, force: true });
  });

  it("applies forward, leaves existing runs unpinned and locks pinned inputs down", async () => {
    const { db, sql } = connection;
    await sql`DROP SCHEMA IF EXISTS qos CASCADE`;
    await sql`DROP SCHEMA IF EXISTS drizzle CASCADE`;

    await migrate(db, { migrationsFolder: previousFolder });
    const before = await sql`SELECT to_regclass('qos.agent_run_inputs') AS t`;
    expect(before[0]!.t).toBeNull();

    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const [binding] = await sql.begin(async (tx) => {
      await tx`SELECT set_config(${agentPlatformAdminSetting}, 'true', true)`;
      return tx`
        INSERT INTO qos.tenant_agent_bindings
          (tenant_id, public_id, capability, provider, provider_agent_id, enabled, approved_by_subject)
        VALUES (${tenantId}, 'agb_legacy', 'menu_manager', 'hyperagent', 'agent_legacy', true, 'operator:platform')
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
      RETURNING *`;

    await migrate(db, { migrationsFolder: path.join(process.cwd(), "drizzle") });

    const [after] = await sql`SELECT * FROM qos.agent_runs WHERE id = ${legacy!.id}`;
    expect(after).toMatchObject({
      ...legacy,
      definition_key: null,
      definition_version: null,
      execution_identity: null,
      run_config: null,
    });

    // A legacy run cannot gain pins or have its request summary rewritten.
    await expect(
      sql`UPDATE qos.agent_runs SET definition_key = 'menu_manager' WHERE id = ${legacy!.id}`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      sql`UPDATE qos.agent_runs SET request_summary = '{}'::jsonb WHERE id = ${legacy!.id}`,
    ).rejects.toMatchObject({ code: "42501" });
    // Partial pins are rejected outright.
    await expect(
      sql`
        INSERT INTO qos.agent_runs
          (tenant_id, public_id, binding_id, capability, provider, provider_agent_id, status, subject_type,
           subject_public_id, requested_by_subject, requested_by_actor_class, idempotency_key, correlation_id,
           request_summary, deadline_at, definition_key)
        VALUES (${tenantId}, 'run_partial', ${binding!.id}, 'menu_manager', 'hyperagent', 'agent_legacy', 'failed',
                'menu', 'men_lunch', 'admin.quotes@test', 'staff_administrator', 'idem-partial-0001',
                gen_random_uuid(), '{}'::jsonb, now(), 'menu_manager')`,
    ).rejects.toMatchObject({ code: "23514" });

    const [security] = await sql`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relnamespace = 'qos'::regnamespace AND relname = 'agent_run_inputs'`;
    expect(security).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const grants = await sql`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'qos_app' AND table_schema = 'qos' AND table_name = 'agent_run_inputs'
      ORDER BY privilege_type`;
    expect(grants.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);

    const payload = '{"schema":"test.input.v1"}';
    const sha = createHash("sha256").update(payload).digest("hex");
    await sql`
      INSERT INTO qos.agent_run_inputs (run_id, tenant_id, input_schema, payload, payload_sha256)
      VALUES (${legacy!.id}, ${tenantId}, 'test.input.v1', ${payload}, ${sha})`;
    await expect(
      sql`UPDATE qos.agent_run_inputs SET payload = '{}' WHERE run_id = ${legacy!.id}`,
    ).rejects.toMatchObject({ code: "42501" });

    await grantRoleMembership(sql, "qos", "qos_app");
    const visible = await runAsRole(sql, "qos_app", async () => {
      await sql`SELECT set_config('qos.current_tenant_id', '', false)`;
      const withoutTenant = await sql`SELECT run_id FROM qos.agent_run_inputs`;
      await sql`SELECT set_config('qos.current_tenant_id', ${tenantId}, false)`;
      const withTenant = await sql`SELECT run_id FROM qos.agent_run_inputs`;
      await expect(sql`DELETE FROM qos.agent_run_inputs`).rejects.toMatchObject({ code: "42501" });
      await sql`SELECT set_config('qos.current_tenant_id', '', false)`;
      return { withoutTenant: withoutTenant.length, withTenant: withTenant.length };
    });
    expect(visible).toEqual({ withoutTenant: 0, withTenant: 1 });
  }, 120_000);
});
