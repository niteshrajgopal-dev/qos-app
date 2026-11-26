import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const TAG = "0064_recipe_modifier_effects";
const TABLE = "recipe_version_modifier_effects";

type Journal = { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };

/* The earlier Phase 2 migrations are applied on dev already; 0064 must not change a byte of them. */
const APPLIED_HASHES: Record<string, string> = {
  "0054_product_modifier_assignment_policy.sql": "4c712e2d397dacabadaa0779c5daf09564578ea6fddc2997ddd242ce6cd8a6a9",
  "0055_workbook_import_plans.sql": "43016d9dde1a56bcde68df6c46281ab19e4a7f82073ff808dbad88c248313aae",
  "0056_sales_channel_prices.sql": "6ea71abb142a8119f733ce82b44a92bb712df8159717b45485529c575dd36c11",
  "0057_catalogue_selling_attributes.sql": "c5de7a4c34f9ac6f037dde56f506a86a9a2e3ada2094fd707b58a74dfcd3aa10",
  "0058_workbook_import_apply.sql": "648e6e7e67cdd39314361d0c12255b79c929e0adc763c99cb984d56f4b01d156",
  "0059_catalogue_selling_tax_and_reference_costs.sql": "3ff969fc17f5013ef4cbc4441fa7fb2e3fbb92d70249692af82c47e76a46997b",
  "0060_inventory_units_items_conversions.sql": "3f2d4f785ccad743eabff35f7f644b3b5c9e61a746232996935176f5196b8883",
  "0061_inventory_suppliers_warehouses.sql": "5153890c0396d4c2775ecfda473bc7f8911a49c545d32a411e8ae9cb4fea4c27",
  "0062_inventory_categories_reference_costs.sql": "57506f5945b874ed45aa331fddf99da8b785fe7828cc53ba8cac0fc999680b60",
  "0063_recipes_and_sellable_links.sql": "b411c76463ff3c14921f4e755f73264f8dc2b8e6d102ba5ee27c5a6264eb6fcd",
};

describe("recipe modifier effects migration journal (0064)", () => {
  it("is journalled as idx 64 directly after 0063, with every idx and when strictly increasing", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === TAG);
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toEqual({ idx: 64, version: "7", when: 1793700000000, tag: TAG, breakpoints: true });
    expect(journal.entries[position - 1]).toEqual({ idx: 63, version: "7", when: 1793600000000, tag: "0063_recipes_and_sellable_links", breakpoints: true });
    expect(journal.entries.filter((entry) => entry.idx === 64)).toHaveLength(1);
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
  });

  it("leaves 0054 to 0063 byte-identical", () => {
    for (const [file, hash] of Object.entries(APPLIED_HASHES)) {
      const actual = createHash("sha256").update(readFileSync(path.join(process.cwd(), "drizzle", file))).digest("hex");
      expect(actual, file).toBe(hash);
    }
  });

  it("adds one table with forced RLS, a tenant policy, no DELETE and column-limited UPDATE, plus one unique on lines", () => {
    const sql = readFileSync(path.join(process.cwd(), `drizzle/${TAG}.sql`), "utf8");
    expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "qos"."${TABLE}"`);
    expect(sql).toContain(`ALTER TABLE "qos"."${TABLE}" ENABLE ROW LEVEL SECURITY`);
    expect(sql).toContain(`ALTER TABLE "qos"."${TABLE}" FORCE ROW LEVEL SECURITY`);
    expect(sql).toContain(`REVOKE ALL ON TABLE "qos"."${TABLE}" FROM qos_app`);
    expect(sql).toContain(`GRANT SELECT, INSERT ON TABLE "qos"."${TABLE}" TO qos_app`);
    expect(sql).toContain(`CREATE POLICY "${TABLE}_tenant_isolation"`);
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/);
    expect(sql).not.toMatch(/GRANT UPDATE \([^)]*"(recipe_version_id|modifier_option_id|public_id|tenant_id)"/);
    expect(sql).not.toMatch(/^\s*INSERT INTO/m);
    expect(sql).not.toMatch(/^\s*(UPDATE|DELETE)\b/m);
    // The only change to an existing table is the composite unique the target-line FK needs.
    const alters = sql.match(/ALTER TABLE "qos"\."[a-z_]+" ADD [^;]*/g) ?? [];
    expect(alters).toEqual([
      'ALTER TABLE "qos"."recipe_version_lines" ADD CONSTRAINT "recipe_version_lines_tenant_version_id_unique" UNIQUE ("tenant_id", "recipe_version_id", "id")',
    ]);
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/stock|ledger|production/i);
  });
});

integrationDescribe("recipe modifier effects migration (0064)", () => {
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

  it("records 0064 in the journal after 0063", async () => {
    const rows = await sql<{ created_at: string }[]>`
      SELECT created_at::text FROM drizzle.__drizzle_migrations WHERE created_at <= 1793700000000 ORDER BY created_at DESC LIMIT 2`;
    expect(rows.map((row) => row.created_at)).toEqual(["1793700000000", "1793600000000"]);
  });

  it("forces RLS with one tenant policy and grants SELECT, INSERT and only the editable columns", async () => {
    const [rls] = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${`qos.${TABLE}`}::regclass`;
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    const policies = await sql<{ policyname: string }[]>`SELECT policyname FROM pg_policies WHERE schemaname = 'qos' AND tablename = ${TABLE}`;
    expect(policies.map((row) => row.policyname)).toEqual([`${TABLE}_tenant_isolation`]);
    const grants = await sql<{ privilege_type: string }[]>`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'qos' AND table_name = ${TABLE} AND grantee = 'qos_app' ORDER BY privilege_type`;
    expect(grants.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.column_privileges
      WHERE table_schema = 'qos' AND table_name = ${TABLE} AND grantee = 'qos_app' AND privilege_type = 'UPDATE' ORDER BY column_name`;
    expect(columns.map((row) => row.column_name)).toEqual([
      "effect_type",
      "item_id",
      "notes",
      "position",
      "quantity_micros",
      "status",
      "target_line_id",
      "unit_id",
      "updated_at",
      "updated_by_subject",
    ]);
  });

  it("enforces shapes, quantities, partial uniques, same-version target lines, tenant FKs and isolation", async () => {
    const tenantA = (await createTenantHierarchy(db, quotesTenantFixture())).tenant;
    const tenantB = (await createTenantHierarchy(db, flowerTenantFixture())).tenant;
    const unit = async (tenantId: string, publicId: string) =>
      (
        await sql<{ id: string }[]>`
          INSERT INTO qos.inventory_units (tenant_id, public_id, code, name_en, name_ar, quantity_kind, standard_code, decimal_places, provenance)
          VALUES (${tenantId}, ${publicId}, 'ml', 'Millilitre', 'مليلتر', 'volume', 'ml', 0, 'operator_entered') RETURNING id`
      )[0]!.id;
    const item = async (tenantId: string, publicId: string) =>
      (
        await sql<{ id: string }[]>`
          INSERT INTO qos.inventory_items (tenant_id, public_id, name_en, kind, provenance)
          VALUES (${tenantId}, ${publicId}, ${publicId}, 'purchased', 'operator_entered') RETURNING id`
      )[0]!.id;
    const option = async (tenantId: string, suffix: string) =>
      (
        await sql<{ id: string }[]>`
          WITH grp AS (
            INSERT INTO qos.catalogue_modifier_groups (tenant_id, public_id, internal_name, provenance)
            VALUES (${tenantId}, ${`modgrp_${suffix}`}, 'extras', 'operator_entered') RETURNING id)
          INSERT INTO qos.catalogue_modifier_options (tenant_id, modifier_group_id, public_id)
          SELECT ${tenantId}, grp.id, ${`modopt_${suffix}`} FROM grp RETURNING id`
      )[0]!.id;
    const unitA = await unit(tenantA.id, "unit_ml_a");
    const unitB = await unit(tenantB.id, "unit_ml_b");
    const milkA = await item(tenantA.id, "item_milk_a");
    const oatA = await item(tenantA.id, "item_oat_a");
    const milkB = await item(tenantB.id, "item_milk_b");
    const optionA = await option(tenantA.id, "a");
    const optionB = await option(tenantB.id, "b");
    const [recipe] = await sql<{ id: string }[]>`
      INSERT INTO qos.recipes (tenant_id, public_id, name_en, kind, provenance) VALUES (${tenantA.id}, 'rec_latte', 'Latte', 'sellable', 'operator_entered') RETURNING id`;
    const version = async (publicId: string, number: number) =>
      (
        await sql<{ id: string }[]>`
          INSERT INTO qos.recipe_versions (tenant_id, public_id, recipe_id, version_number, status, provenance)
          VALUES (${tenantA.id}, ${publicId}, ${recipe!.id}, ${number}, ${number === 1 ? "discarded" : "draft"}, 'operator_entered') RETURNING id`
      )[0]!.id;
    const v1 = await version("recv_1", 1);
    const v2 = await version("recv_2", 2);
    const line = async (publicId: string, versionId: string) =>
      (
        await sql<{ id: string }[]>`
          INSERT INTO qos.recipe_version_lines (tenant_id, public_id, recipe_version_id, item_id, unit_id, quantity_micros, position)
          VALUES (${tenantA.id}, ${publicId}, ${versionId}, ${milkA}, ${unitA}, 200000000, 0) RETURNING id`
      )[0]!.id;
    const lineV1 = await line("recl_v1", v1);
    const lineV2 = await line("recl_v2", v2);

    let position = 0;
    const effect = (values: { publicId: string; type: string; versionId?: string; optionId?: string; target?: string | null; itemId?: string | null; unitId?: string | null; quantity?: number | null; status?: string; notes?: string; tenantId?: string }) =>
      sql`INSERT INTO qos.recipe_version_modifier_effects (tenant_id, public_id, recipe_version_id, modifier_option_id, effect_type, target_line_id, item_id, unit_id, quantity_micros, notes, position, status)
          VALUES (${values.tenantId ?? tenantA.id}, ${values.publicId}, ${values.versionId ?? v2}, ${values.optionId ?? optionA}, ${values.type}, ${values.target ?? null},
                  ${values.itemId ?? null}, ${values.unitId ?? null}, ${values.quantity ?? null}, ${values.notes ?? null}, ${position++}, ${values.status ?? "active"})`;
    await effect({ publicId: "eff_add", type: "add", itemId: oatA, unitId: unitA, quantity: 9000000 });
    await effect({ publicId: "eff_replace", type: "replace", target: lineV2, itemId: oatA, unitId: unitA, quantity: 200000000 });
    await expect(effect({ publicId: "eff_bad", type: "add", target: lineV2, itemId: oatA, unitId: unitA, quantity: 1 })).rejects.toThrow(/shape_check/);
    await expect(effect({ publicId: "eff_bad", type: "remove", target: lineV2, itemId: oatA })).rejects.toThrow(/shape_check/);
    await expect(effect({ publicId: "eff_bad", type: "replace", target: lineV2, itemId: oatA, unitId: unitA })).rejects.toThrow(/shape_check/);
    await expect(effect({ publicId: "eff_bad", type: "swap", itemId: oatA, unitId: unitA, quantity: 1 })).rejects.toThrow(/(type|shape)_check/);
    await expect(effect({ publicId: "eff_bad", type: "add", itemId: milkA, unitId: unitA, quantity: 0 })).rejects.toThrow(/quantity_check/);
    await expect(effect({ publicId: "eff_bad", type: "add", itemId: milkA, unitId: unitA, quantity: 1, notes: "x".repeat(201) })).rejects.toThrow(/notes_check/);
    await expect(effect({ publicId: "bad_prefix", type: "add", itemId: milkA, unitId: unitA, quantity: 1 })).rejects.toThrow(/public_id_check/);
    // One remove or replace per option per line, one add per option per item, among active rows.
    await expect(effect({ publicId: "eff_dup_line", type: "remove", target: lineV2 })).rejects.toThrow(/active_target_unique/);
    await expect(effect({ publicId: "eff_dup_add", type: "add", itemId: oatA, unitId: unitA, quantity: 1 })).rejects.toThrow(/active_add_unique/);
    await effect({ publicId: "eff_old_add", type: "add", itemId: oatA, unitId: unitA, quantity: 1, status: "removed" });
    // A target line must belong to the same version.
    await expect(effect({ publicId: "eff_other_version", type: "remove", target: lineV1 })).rejects.toThrow(/target_line_fk/);
    await effect({ publicId: "eff_v1", type: "remove", versionId: v1, target: lineV1 });
    // Tenant composite FKs: another business's option, item or unit is refused.
    await expect(effect({ publicId: "eff_x1", type: "add", optionId: optionB, itemId: milkA, unitId: unitA, quantity: 1 })).rejects.toThrow(/option_fk/);
    await expect(effect({ publicId: "eff_x2", type: "add", itemId: milkB, unitId: unitA, quantity: 1 })).rejects.toThrow(/item_fk/);
    await expect(effect({ publicId: "eff_x3", type: "add", itemId: milkA, unitId: unitB, quantity: 1 })).rejects.toThrow(/unit_fk/);
    // A targeted line can never be deleted.
    await expect(sql`DELETE FROM qos.recipe_version_lines WHERE id = ${lineV2}`).rejects.toThrow(/target_line_fk/);

    const asApp = (tenantId: string, statement: (tx: typeof sql) => Promise<unknown>) =>
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE qos_app");
        await tx`SELECT set_config('qos.current_tenant_id', ${tenantId}, true)`;
        return statement(tx as unknown as typeof sql);
      });
    expect((await asApp(tenantB.id, (tx) => tx.unsafe(`SELECT id FROM qos.${TABLE}`))) as unknown[]).toHaveLength(0);
    expect(((await asApp(tenantA.id, (tx) => tx.unsafe(`SELECT id FROM qos.${TABLE}`))) as unknown[]).length).toBe(4);
    await expect(
      asApp(tenantB.id, (tx) =>
        tx`INSERT INTO qos.recipe_version_modifier_effects (tenant_id, public_id, recipe_version_id, modifier_option_id, effect_type, target_line_id, position)
           VALUES (${tenantA.id}, 'eff_cross', ${v2}, ${optionA}, 'remove', ${lineV2}, 9)`,
      ),
    ).rejects.toThrow(/row-level security/);
    for (const statement of [
      `DELETE FROM qos.${TABLE}`,
      `UPDATE qos.${TABLE} SET recipe_version_id = recipe_version_id`,
      `UPDATE qos.${TABLE} SET modifier_option_id = modifier_option_id`,
      `UPDATE qos.${TABLE} SET public_id = 'eff_z' WHERE public_id = 'eff_add'`,
    ]) {
      await expect(asApp(tenantA.id, (tx) => tx.unsafe(statement)), statement).rejects.toThrow(/permission denied/);
    }
    const updated = (await asApp(tenantA.id, (tx) => tx`UPDATE qos.recipe_version_modifier_effects SET status = 'removed', quantity_micros = 10000000 WHERE public_id = 'eff_add' RETURNING id`)) as unknown[];
    expect(updated).toHaveLength(1);
    // Another business cannot update a row it cannot see.
    const hidden = (await asApp(tenantB.id, (tx) => tx`UPDATE qos.recipe_version_modifier_effects SET notes = 'x' RETURNING id`)) as unknown[];
    expect(hidden).toHaveLength(0);
  });
});
