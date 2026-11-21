import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

describe("product modifier assignment policy migration file (0054)", () => {
  it("is journalled as idx 54 directly after 0053", () => {
    const journal = JSON.parse(
      readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8"),
    ) as { entries: Array<{ idx: number; tag: string; when: number }> };
    const entry = journal.entries.find((candidate) => candidate.idx === 54);
    expect(entry).toMatchObject({ tag: "0054_product_modifier_assignment_policy", when: 1792700000000 });
    expect(journal.entries.map((candidate) => candidate.idx)).toEqual(
      journal.entries.map((_, index) => index),
    );
  });
});

integrationDescribe("product modifier assignment policy migration (0054)", () => {
  let sql: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    sql = connection.sql;
    db = connection.db;
    await grantRoleMembership(sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("adds nullable overrides plus version and updated_at", async () => {
    const columns = await sql<
      Array<{ column_name: string; data_type: string; is_nullable: string; column_default: string | null }>
    >`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'qos' AND table_name = 'catalogue_product_modifier_groups'
        AND column_name IN ('min_selections', 'max_selections', 'repeat_allowed', 'selection_count_mode', 'version', 'updated_at')
      ORDER BY column_name`;

    expect(
      Object.fromEntries(columns.map((row) => [row.column_name, [row.data_type, row.is_nullable]])),
    ).toEqual({
      max_selections: ["integer", "YES"],
      min_selections: ["integer", "YES"],
      repeat_allowed: ["boolean", "YES"],
      selection_count_mode: ["text", "YES"],
      updated_at: ["timestamp with time zone", "NO"],
      version: ["integer", "NO"],
    });
    expect(columns.find((row) => row.column_name === "version")?.column_default).toBe("1");
  });

  it("adds the tenant-safe check constraints and keeps the unique link and RLS", async () => {
    const constraints = await sql<Array<{ conname: string }>>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'qos.catalogue_product_modifier_groups'::regclass
      ORDER BY conname`;
    expect(constraints.map((row) => row.conname)).toEqual(
      expect.arrayContaining([
        "catalogue_product_modifier_groups_bounds_check",
        "catalogue_product_modifier_groups_max_selections_check",
        "catalogue_product_modifier_groups_min_selections_check",
        "catalogue_product_modifier_groups_selection_count_mode_check",
        "catalogue_product_modifier_groups_unique",
        "catalogue_product_modifier_groups_version_check",
      ]),
    );

    const [rls] = await sql<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE oid = 'qos.catalogue_product_modifier_groups'::regclass`;
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
  });

  it("gives existing-shaped rows inherited overrides and version 1, and rejects invalid policies", async () => {
    const { tenant, brand } = await createTenantHierarchy(db, quotesTenantFixture());
    const [product] = await sql<Array<{ id: string }>>`
      INSERT INTO qos.catalogue_products (tenant_id, brand_id, public_id, internal_name, provenance)
      VALUES (${tenant.id}, ${brand.id}, 'prd_migration_0054', 'migration-0054', 'synthetic_fixture') RETURNING id`;
    const [group] = await sql<Array<{ id: string }>>`
      INSERT INTO qos.catalogue_modifier_groups (tenant_id, public_id, internal_name, provenance)
      VALUES (${tenant.id}, 'modgrp_migration_0054', 'Extras', 'synthetic_fixture') RETURNING id`;

    // The pre-0054 insert shape: no policy columns named.
    const [link] = await sql<
      Array<{
        min_selections: number | null;
        max_selections: number | null;
        repeat_allowed: boolean | null;
        selection_count_mode: string | null;
        version: number;
        updated_at: string;
      }>
    >`
      INSERT INTO qos.catalogue_product_modifier_groups (tenant_id, product_id, modifier_group_id, sort_order)
      VALUES (${tenant.id}, ${product!.id}, ${group!.id}, 0)
      RETURNING min_selections, max_selections, repeat_allowed, selection_count_mode, version, updated_at`;
    expect(link).toMatchObject({
      min_selections: null,
      max_selections: null,
      repeat_allowed: null,
      selection_count_mode: null,
      version: 1,
    });
    expect(link!.updated_at).toBeTruthy();

    const invalid = [
      sql`UPDATE qos.catalogue_product_modifier_groups SET min_selections = -1`,
      sql`UPDATE qos.catalogue_product_modifier_groups SET max_selections = -1`,
      sql`UPDATE qos.catalogue_product_modifier_groups SET min_selections = 3, max_selections = 2`,
      sql`UPDATE qos.catalogue_product_modifier_groups SET selection_count_mode = 'foodics_total'`,
      sql`UPDATE qos.catalogue_product_modifier_groups SET version = 0`,
    ];
    for (const statement of invalid) {
      await expect(statement).rejects.toMatchObject({ code: "23514" });
    }
  });
});
