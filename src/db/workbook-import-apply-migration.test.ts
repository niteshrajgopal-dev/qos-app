import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

type Journal = { entries: Array<{ idx: number; when: number; tag: string }> };

describe("workbook import apply migration journal (0058)", () => {
  it("records 0058 after 0057 (QOS-214) with strictly increasing idx and when", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((candidate) => candidate.tag === "0058_workbook_import_apply");
    expect(journal.entries[position]).toMatchObject({ idx: 58, when: 1793100000000 });
    expect(journal.entries[position - 1]).toMatchObject({ idx: 57, when: 1793000000000, tag: "0057_catalogue_selling_attributes" });
    expect(journal.entries[position - 2]).toMatchObject({ idx: 56, tag: "0056_sales_channel_prices" });
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
    const sql = readFileSync(path.join(process.cwd(), "drizzle/0058_workbook_import_apply.sql"), "utf8");
    expect(sql).toMatch(/^-- MANUAL \(Nitesh\)/);
    expect(sql).toContain("DROP TABLE IF EXISTS \"qos\".\"workbook_source_links\"");
    expect(sql).toContain("DROP TABLE IF EXISTS \"qos\".\"workbook_import_applies\"");
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/);
  });
});

integrationDescribe("workbook import apply migration (0058)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sql: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sql = connection.sql;
    await grantRoleMembership(sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("creates apply tables with forced RLS, isolation policies and no DELETE grant, and widens plan status", async () => {
    for (const table of ["workbook_import_applies", "workbook_source_links"]) {
      const [exists] = await sql`SELECT to_regclass(${`qos.${table}`}) AS t`;
      expect(String(exists?.t ?? "")).toContain(table);
      const [security] = await sql`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class
        WHERE oid = ${`qos.${table}`}::regclass`;
      expect(security).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const policies = await sql`SELECT policyname FROM pg_policies WHERE schemaname = 'qos' AND tablename = ${table}`;
      expect(policies.map((row) => row.policyname)).toEqual([`${table}_tenant_isolation`]);
      const grants = await sql`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'qos' AND table_name = ${table} AND grantee = 'qos_app'
        ORDER BY privilege_type`;
      expect(grants.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT", "UPDATE"]);
    }

    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const [plan] = await sql`
      INSERT INTO qos.workbook_import_plans (
        tenant_id, public_id, status, source_profile, template_version, brand_id, source_namespace, keys_verified,
        file_name, file_fingerprint, snapshot_hash, plan_hash, engine_version, created_by_subject, created_by_role,
        reviewed_by_subject, branch_scope, context, counts, idempotency_key
      ) VALUES (
        ${quotes.tenant.id}, 'wbp_cccccccccccccccc', 'review_ready', 'qos_extended_v1', '1.0', ${quotes.brand.id}, 'qos:t', true,
        'w.xlsx', 'f', 's', 'h', 'qos217.1', 'alice', 'administrator', 'alice', '"all"'::jsonb, '{}'::jsonb, '{}'::jsonb, 'k-0058-a'
      ) RETURNING id`;
    const planId = plan!.id as string;

    await sql`UPDATE qos.workbook_import_plans SET status = 'applying' WHERE id = ${planId}`;
    await sql`UPDATE qos.workbook_import_plans SET status = 'applied' WHERE id = ${planId}`;
    await sql`UPDATE qos.workbook_import_plans SET status = 'apply_failed' WHERE id = ${planId}`;
    await sql`UPDATE qos.workbook_import_plans SET status = 'review_ready' WHERE id = ${planId}`;
    await expect(sql`UPDATE qos.workbook_import_plans SET status = 'foo' WHERE id = ${planId}`).rejects.toMatchObject({ code: "23514" });

    await expect(
      sql`UPDATE qos.workbook_import_plan_rows SET apply_state = 'bogus' WHERE false`,
    ).resolves.toBeTruthy();
    await sql`INSERT INTO qos.workbook_import_plan_rows (tenant_id, plan_id, sheet, row_number, entity_key, requested_action, classification, "values", apply_state)
              VALUES (${quotes.tenant.id}, ${planId}, 'Products', 7, 'p', 'create', 'create', '{}'::jsonb, 'applied')`;
    await expect(
      sql`INSERT INTO qos.workbook_import_plan_rows (tenant_id, plan_id, sheet, row_number, entity_key, requested_action, classification, "values", apply_state)
          VALUES (${quotes.tenant.id}, ${planId}, 'Products', 8, 'q', 'create', 'create', '{}'::jsonb, 'bogus')`,
    ).rejects.toMatchObject({ code: "23514" });

    const applyValues = {
      tenant_id: quotes.tenant.id,
      plan_id: planId,
      public_id: "wba_aaaaaaaaaaaaaaaa",
      status: "applying",
      idempotency_key: "apply-1",
      plan_revision: 1,
      plan_hash: "h",
      snapshot_hash: "s",
      engine_version: "qos217.1",
      source_profile: "qos_extended_v1",
      source_namespace: "qos:t",
      template_version: "1.0",
      branch_scope: '"all"',
      actor_subject: "alice",
      actor_role: "administrator",
    };

    await sql`
      INSERT INTO qos.workbook_import_applies (
        tenant_id, plan_id, public_id, status, idempotency_key, plan_revision, plan_hash, snapshot_hash,
        engine_version, source_profile, source_namespace, template_version, branch_scope, actor_subject, actor_role
      ) VALUES (
        ${applyValues.tenant_id}, ${applyValues.plan_id}, ${applyValues.public_id}, ${applyValues.status},
        ${applyValues.idempotency_key}, ${applyValues.plan_revision}, ${applyValues.plan_hash}, ${applyValues.snapshot_hash},
        ${applyValues.engine_version}, ${applyValues.source_profile}, ${applyValues.source_namespace},
        ${applyValues.template_version}, ${applyValues.branch_scope}::jsonb, ${applyValues.actor_subject}, ${applyValues.actor_role}
      )`;
    await expect(
      sql`
        INSERT INTO qos.workbook_import_applies (
          tenant_id, plan_id, public_id, status, idempotency_key, plan_revision, plan_hash, snapshot_hash,
          engine_version, source_profile, source_namespace, template_version, branch_scope, actor_subject, actor_role
        ) VALUES (
          ${applyValues.tenant_id}, ${applyValues.plan_id}, 'wba_bbbbbbbbbbbbbbbb', 'applying',
          'apply-2', 1, 'h', 's', 'qos217.1', 'qos_extended_v1', 'qos:t', '1.0', '"all"'::jsonb, 'alice', 'administrator'
        )`,
    ).rejects.toMatchObject({ code: "23505" });
    await sql`UPDATE qos.workbook_import_applies SET status = 'completed' WHERE public_id = 'wba_aaaaaaaaaaaaaaaa'`;
    await sql`
      INSERT INTO qos.workbook_import_applies (
        tenant_id, plan_id, public_id, status, idempotency_key, plan_revision, plan_hash, snapshot_hash,
        engine_version, source_profile, source_namespace, template_version, branch_scope, actor_subject, actor_role
      ) VALUES (
        ${applyValues.tenant_id}, ${applyValues.plan_id}, 'wba_bbbbbbbbbbbbbbbb', 'completed',
        'apply-2', 1, 'h', 's', 'qos217.1', 'qos_extended_v1', 'qos:t', '1.0', '"all"'::jsonb, 'alice', 'administrator'
      )`;

    await sql`
      INSERT INTO qos.workbook_source_links (
        tenant_id, source_namespace, entity_type, source_key, target_public_id, created_by_subject
      ) VALUES (
        ${quotes.tenant.id}, 'foodics-menu-v1:t', 'product', 'prd~flat-white', 'prd_new', 'alice'
      )`;
    const [flowersPlan] = await sql`
      INSERT INTO qos.workbook_import_plans (
        tenant_id, public_id, status, source_profile, template_version, brand_id, source_namespace, keys_verified,
        file_name, file_fingerprint, snapshot_hash, plan_hash, engine_version, created_by_subject, created_by_role,
        reviewed_by_subject, branch_scope, context, counts, idempotency_key
      ) VALUES (
        ${flowers.tenant.id}, 'wbp_dddddddddddddddd', 'review_ready', 'qos_extended_v1', '1.0', ${flowers.brand.id}, 'qos:f', true,
        'w.xlsx', 'f2', 's', 'h2', 'qos217.1', 'bob', 'administrator', 'bob', '"all"'::jsonb, '{}'::jsonb, '{}'::jsonb, 'k-0058-b'
      ) RETURNING id`;
    await sql`
      INSERT INTO qos.workbook_import_applies (
        tenant_id, plan_id, public_id, status, idempotency_key, plan_revision, plan_hash, snapshot_hash,
        engine_version, source_profile, source_namespace, template_version, branch_scope, actor_subject, actor_role
      ) VALUES (
        ${flowers.tenant.id}, ${flowersPlan!.id}, 'wba_ffffffffffffffff', 'completed',
        'flowers-1', 1, 'h2', 's', 'qos217.1', 'qos_extended_v1', 'qos:f', '1.0', '"all"'::jsonb, 'bob', 'administrator'
      )`;

    await runAsRole(sql, "qos_app", async () => {
      const none = await sql`SELECT public_id FROM qos.workbook_import_applies`;
      expect(none).toEqual([]);
      const visible = await sql.begin(async (tx) => {
        await tx`SELECT set_config('qos.current_tenant_id', ${quotes.tenant.id}, true)`;
        return {
          applies: await tx`SELECT public_id FROM qos.workbook_import_applies ORDER BY public_id`,
          links: await tx`SELECT source_key FROM qos.workbook_source_links`,
        };
      });
      expect(visible.applies.map((row) => row.public_id)).toEqual(["wba_aaaaaaaaaaaaaaaa", "wba_bbbbbbbbbbbbbbbb"]);
      expect(visible.links.map((row) => row.source_key)).toEqual(["prd~flat-white"]);
      const foreign = await sql.begin(async (tx) => {
        await tx`SELECT set_config('qos.current_tenant_id', ${flowers.tenant.id}, true)`;
        return {
          applies: await tx`SELECT public_id FROM qos.workbook_import_applies`,
          links: await tx`SELECT source_key FROM qos.workbook_source_links`,
        };
      });
      expect(foreign.applies.map((row) => row.public_id)).toEqual(["wba_ffffffffffffffff"]);
      expect(foreign.links).toEqual([]);
      await expect(sql`DELETE FROM qos.workbook_import_applies`).rejects.toMatchObject({ code: "42501" });
      await expect(sql`DELETE FROM qos.workbook_source_links`).rejects.toMatchObject({ code: "42501" });
    });
  });
});
