import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

type Journal = { entries: Array<{ idx: number; when: number; tag: string }> };

describe("workbook import plans migration journal (0055)", () => {
  it("records 0055 after 0053 with strictly increasing idx and when", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const entry = journal.entries.find((candidate) => candidate.tag === "0055_workbook_import_plans");
    expect(entry).toMatchObject({ idx: 55, when: 1792800000000 });
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
    const sql = readFileSync(path.join(process.cwd(), "drizzle/0055_workbook_import_plans.sql"), "utf8");
    expect(sql).toMatch(/^-- MANUAL \(Nitesh\)/);
    expect(sql).toContain('DROP TABLE IF EXISTS "qos"."workbook_import_plan_rows"');
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/);
  });
});

integrationDescribe("workbook import plans migration (0055)", () => {
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

  it("creates both tables with forced row level security, isolation policies and no DELETE grant", async () => {
    for (const table of ["workbook_import_plans", "workbook_import_plan_rows"]) {
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
  });

  async function insertPlan(tenantId: string, brandId: string, publicId: string) {
    const [plan] = await sql`
      INSERT INTO qos.workbook_import_plans (
        tenant_id, public_id, status, source_profile, template_version, brand_id, source_namespace, keys_verified,
        file_name, file_fingerprint, snapshot_hash, plan_hash, engine_version, created_by_subject, created_by_role,
        reviewed_by_subject, branch_scope, context, counts, idempotency_key
      ) VALUES (
        ${tenantId}, ${publicId}, 'review_ready', 'qos_extended_v1', '1.0', ${brandId}, 'qos:t', true,
        'w.xlsx', 'f', 's', 'h', 'qos194.1', 'alice', 'administrator', 'alice', '"all"'::jsonb, '{}'::jsonb, '{}'::jsonb, ${publicId}
      ) RETURNING id`;
    return plan!.id as string;
  }

  it("refuses unknown classifications and statuses, and isolates tenants for qos_app (fail closed without context)", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const planId = await insertPlan(quotes.tenant.id, quotes.brand.id, "wbp_aaaaaaaaaaaaaaaa");
    await insertPlan(flowers.tenant.id, flowers.brand.id, "wbp_bbbbbbbbbbbbbbbb");

    await expect(
      sql`INSERT INTO qos.workbook_import_plan_rows (tenant_id, plan_id, sheet, row_number, entity_key, requested_action, classification, "values")
          VALUES (${quotes.tenant.id}, ${planId}, 'Products', 7, 'p', 'create', 'applied', '{}'::jsonb)`,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(sql`UPDATE qos.workbook_import_plans SET status = 'bogus' WHERE id = ${planId}`).rejects.toMatchObject({ code: "23514" });
    await sql`INSERT INTO qos.workbook_import_plan_rows (tenant_id, plan_id, sheet, row_number, entity_key, requested_action, classification, "values")
              VALUES (${quotes.tenant.id}, ${planId}, 'Products', 7, 'p', 'create', 'create', '{}'::jsonb)`;

    await runAsRole(sql, "qos_app", async () => {
      const none = await sql`SELECT public_id FROM qos.workbook_import_plans`;
      expect(none).toEqual([]);
      const visible = await sql.begin(async (tx) => {
        await tx`SELECT set_config('qos.current_tenant_id', ${quotes.tenant.id}, true)`;
        return {
          plans: await tx`SELECT public_id FROM qos.workbook_import_plans`,
          rows: await tx`SELECT entity_key FROM qos.workbook_import_plan_rows`,
        };
      });
      expect(visible.plans.map((row) => row.public_id)).toEqual(["wbp_aaaaaaaaaaaaaaaa"]);
      expect(visible.rows.map((row) => row.entity_key)).toEqual(["p"]);
      const foreign = await sql.begin(async (tx) => {
        await tx`SELECT set_config('qos.current_tenant_id', ${flowers.tenant.id}, true)`;
        return tx`SELECT entity_key FROM qos.workbook_import_plan_rows`;
      });
      expect(foreign).toEqual([]);
      await expect(sql`DELETE FROM qos.workbook_import_plans`).rejects.toMatchObject({ code: "42501" });
    });
  });
});
