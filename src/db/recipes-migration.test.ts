import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const TAG = "0063_recipes_and_sellable_links";
const TABLES = [
  "recipes",
  "recipe_versions",
  "recipe_version_lines",
  "recipe_version_steps",
  "recipe_version_snapshots",
  "recipe_sellable_links",
] as const;

type Journal = { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };

describe("recipes and sellable links migration journal (0063)", () => {
  it("is journalled as idx 63 directly after 0062, with every idx and when strictly increasing", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === TAG);
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toEqual({ idx: 63, version: "7", when: 1793600000000, tag: TAG, breakpoints: true });
    expect(journal.entries[position - 1]).toEqual({
      idx: 62,
      version: "7",
      when: 1793500000000,
      tag: "0062_inventory_categories_reference_costs",
      breakpoints: true,
    });
    expect(journal.entries.filter((entry) => entry.idx === 63)).toHaveLength(1);
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
  });

  it("creates six tables with forced RLS, tenant policies, restricted grants, the partial indexes and no DELETE grant or seed rows", () => {
    const sql = readFileSync(path.join(process.cwd(), `drizzle/${TAG}.sql`), "utf8");
    for (const table of TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "qos"."${table}"`);
      expect(sql).toContain(`ALTER TABLE "qos"."${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE "qos"."${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`REVOKE ALL ON TABLE "qos"."${table}" FROM qos_app`);
      expect(sql).toContain(`CREATE POLICY "${table}_tenant_isolation"`);
    }
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."recipes" TO qos_app');
    for (const table of ["recipe_versions", "recipe_version_lines", "recipe_version_steps", "recipe_version_snapshots", "recipe_sellable_links"]) {
      expect(sql).toContain(`GRANT SELECT, INSERT ON TABLE "qos"."${table}" TO qos_app`);
      expect(sql).not.toContain(`GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."${table}"`);
    }
    expect(sql).not.toMatch(/GRANT UPDATE[^;]*"recipe_version_snapshots"/);
    expect(sql).toContain('GRANT UPDATE ("effective_to") ON TABLE "qos"."recipe_sellable_links" TO qos_app');
    expect(sql).toContain(`"recipe_versions_open_draft_unique" ON "qos"."recipe_versions" USING btree ("tenant_id", "recipe_id") WHERE "status" = 'draft'`);
    expect(sql).toContain(
      `"recipe_versions_current_approved_unique" ON "qos"."recipe_versions" USING btree ("tenant_id", "recipe_id") WHERE "status" = 'approved' AND "effective_to" IS NULL`,
    );
    expect(sql).toContain(`"recipe_sellable_links_current_unique" ON "qos"."recipe_sellable_links" USING btree ("tenant_id", "variant_id") WHERE "effective_to" IS NULL`);
    expect(sql).toContain(`"recipes_active_output_item_unique" ON "qos"."recipes" USING btree ("tenant_id", "output_item_id") WHERE "status" = 'active'`);
    expect(sql).toContain(
      '"recipe_sellable_links_variant_fk" FOREIGN KEY ("tenant_id", "variant_id") REFERENCES "qos"."catalogue_variants"("tenant_id", "id")',
    );
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/);
    expect(sql).not.toMatch(/^\s*INSERT INTO/m);
    expect(sql).not.toMatch(/^\s*(UPDATE|DELETE)\b/m);
    // Additive only: no existing table is altered and nothing posts stock.
    expect(sql).not.toMatch(/ALTER TABLE "qos"\."(?!recipe)/);
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");
    // "direct_stock" is a link kind; no stock, ledger or production table or column is created.
    expect(statements).not.toMatch(/(?<![a-z_])stock|ledger|production/i);
  });
});

integrationDescribe("recipes and sellable links migration (0063)", () => {
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

  it("records 0063 in the journal after 0062", async () => {
    const rows = await sql<{ created_at: string }[]>`
      SELECT created_at::text FROM drizzle.__drizzle_migrations
      WHERE created_at <= 1793600000000 ORDER BY created_at DESC LIMIT 2`;
    expect(rows.map((row) => row.created_at)).toEqual(["1793600000000", "1793500000000"]);
  });

  it("forces RLS with one tenant policy per table and grants only the planned columns", async () => {
    for (const table of TABLES) {
      const [rls] = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${`qos.${table}`}::regclass`;
      expect(rls, table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const policies = await sql<{ policyname: string }[]>`SELECT policyname FROM pg_policies WHERE schemaname = 'qos' AND tablename = ${table}`;
      expect(policies.map((row) => row.policyname)).toEqual([`${table}_tenant_isolation`]);
    }
    const tableGrants = async (table: string) =>
      (
        await sql<{ privilege_type: string }[]>`
          SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'qos' AND table_name = ${table} AND grantee = 'qos_app' ORDER BY privilege_type`
      ).map((row) => row.privilege_type);
    expect(await tableGrants("recipes")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    for (const table of TABLES.filter((name) => name !== "recipes")) {
      expect(await tableGrants(table), table).toEqual(["INSERT", "SELECT"]);
    }
    const updatable = async (table: string) =>
      (
        await sql<{ column_name: string }[]>`
          SELECT column_name FROM information_schema.column_privileges
          WHERE table_schema = 'qos' AND table_name = ${table} AND grantee = 'qos_app' AND privilege_type = 'UPDATE'
          ORDER BY column_name`
      ).map((row) => row.column_name);
    expect(await updatable("recipe_versions")).toEqual(
      ["approved_at", "approved_by_subject", "effective_from", "effective_to", "notes", "status", "updated_at", "updated_by_subject", "version", "yield_quantity_micros", "yield_unit_id"],
    );
    expect(await updatable("recipe_version_lines")).toEqual(
      ["item_id", "label_ar", "label_en", "position", "quantity_micros", "status", "unit_id", "updated_at", "updated_by_subject"],
    );
    expect(await updatable("recipe_version_steps")).toEqual(["position", "status", "text_ar", "text_en", "updated_at", "updated_by_subject"]);
    expect(await updatable("recipe_version_snapshots")).toEqual([]);
    expect(await updatable("recipe_sellable_links")).toEqual(["effective_to"]);
  });

  it("enforces shapes, one draft, one open approved version, one open link, one active output family, tenant FKs and isolation", async () => {
    const tenantA = (await createTenantHierarchy(db, quotesTenantFixture())).tenant;
    const tenantB = (await createTenantHierarchy(db, flowerTenantFixture())).tenant;
    const unit = async (tenantId: string, publicId: string) =>
      (
        await sql<{ id: string }[]>`
          INSERT INTO qos.inventory_units (tenant_id, public_id, code, name_en, name_ar, quantity_kind, standard_code, decimal_places, provenance)
          VALUES (${tenantId}, ${publicId}, 'l', 'Litre', 'لتر', 'volume', 'l', 3, 'operator_entered') RETURNING id`
      )[0]!.id;
    const item = async (tenantId: string, publicId: string, kind: string) =>
      (
        await sql<{ id: string }[]>`
          INSERT INTO qos.inventory_items (tenant_id, public_id, name_en, kind, provenance)
          VALUES (${tenantId}, ${publicId}, ${publicId}, ${kind}, 'operator_entered') RETURNING id`
      )[0]!.id;
    const unitA = await unit(tenantA.id, "unit_l_a");
    const unitB = await unit(tenantB.id, "unit_l_b");
    const milkA = await item(tenantA.id, "item_milk_a", "purchased");
    const syrupA = await item(tenantA.id, "item_syrup_a", "prepared");
    const milkB = await item(tenantB.id, "item_milk_b", "purchased");

    const recipe = (tenantId: string, publicId: string, kind: string, outputItemId: string | null, status = "active") =>
      sql<{ id: string }[]>`
        INSERT INTO qos.recipes (tenant_id, public_id, name_en, kind, output_item_id, status, provenance)
        VALUES (${tenantId}, ${publicId}, 'Recipe', ${kind}, ${outputItemId}, ${status}, 'operator_entered') RETURNING id`;
    const [latte] = await recipe(tenantA.id, "rec_latte", "sellable", null);
    await expect(recipe(tenantA.id, "rec_bad", "sellable", syrupA)).rejects.toThrow(/recipes_output_item_check/);
    await expect(recipe(tenantA.id, "rec_bad", "prepared", null)).rejects.toThrow(/recipes_output_item_check/);
    await recipe(tenantA.id, "rec_syrup", "prepared", syrupA);
    await expect(recipe(tenantA.id, "rec_syrup_2", "prepared", syrupA)).rejects.toThrow(/recipes_active_output_item_unique/);
    await recipe(tenantA.id, "rec_syrup_old", "prepared", syrupA, "archived");
    await expect(recipe(tenantA.id, "rec_cross", "prepared", milkB)).rejects.toThrow(/recipes_output_item_fk/);

    const version = (values: { publicId: string; number: number; status: string; from?: string | null; to?: string | null; yieldMicros?: number | null; approvedAt?: string | null }) =>
      sql<{ id: string }[]>`
        INSERT INTO qos.recipe_versions (tenant_id, public_id, recipe_id, version_number, status, effective_from, effective_to,
          yield_quantity_micros, yield_unit_id, approved_at, provenance)
        VALUES (${tenantA.id}, ${values.publicId}, ${latte!.id}, ${values.number}, ${values.status}, ${values.from ?? null}, ${values.to ?? null},
          ${values.yieldMicros === undefined ? 4000000 : values.yieldMicros}, ${unitA}, ${values.approvedAt ?? null}, 'operator_entered') RETURNING id`;
    const [v1] = await version({ publicId: "recv_1", number: 1, status: "approved", from: "2026-11-01", to: "2026-12-01", approvedAt: "2026-11-01T00:00:00Z" });
    await expect(version({ publicId: "recv_x", number: 9, status: "approved", from: "2026-11-01", yieldMicros: null, approvedAt: "2026-11-01T00:00:00Z" })).rejects.toThrow(
      /recipe_versions_approved_check/,
    );
    await expect(version({ publicId: "recv_x", number: 9, status: "draft", from: "2026-11-01" })).rejects.toThrow(/recipe_versions_unapproved_dates_check/);
    await expect(version({ publicId: "recv_x", number: 9, status: "approved", from: "2026-11-01", to: "2026-11-01", approvedAt: "2026-11-01T00:00:00Z" })).rejects.toThrow(
      /recipe_versions_dates_check/,
    );
    await expect(version({ publicId: "recv_x", number: 9, status: "draft", yieldMicros: 0 })).rejects.toThrow(/recipe_versions_yield_check/);
    await version({ publicId: "recv_2", number: 2, status: "approved", from: "2026-12-01", approvedAt: "2026-11-10T00:00:00Z" });
    await expect(version({ publicId: "recv_3", number: 3, status: "approved", from: "2027-01-01", approvedAt: "2026-11-10T00:00:00Z" })).rejects.toThrow(
      /recipe_versions_current_approved_unique/,
    );
    const [draft] = await version({ publicId: "recv_3", number: 3, status: "draft" });
    await expect(version({ publicId: "recv_4", number: 4, status: "draft" })).rejects.toThrow(/recipe_versions_open_draft_unique/);
    await expect(version({ publicId: "recv_5", number: 3, status: "discarded" })).rejects.toThrow(/recipe_versions_number_unique/);

    const line = (publicId: string, versionId: string, itemId: string, status = "active", unitId = unitA) =>
      sql`INSERT INTO qos.recipe_version_lines (tenant_id, public_id, recipe_version_id, item_id, unit_id, quantity_micros, position, status)
          VALUES (${tenantA.id}, ${publicId}, ${versionId}, ${itemId}, ${unitId}, 250000, 0, ${status})`;
    await line("recl_1", draft!.id, milkA);
    await expect(line("recl_2", draft!.id, milkA)).rejects.toThrow(/recipe_version_lines_active_item_unique/);
    await line("recl_3", draft!.id, milkA, "removed");
    await expect(line("recl_4", draft!.id, milkB)).rejects.toThrow(/recipe_version_lines_item_fk/);
    await expect(line("recl_5", draft!.id, syrupA, "active", unitB)).rejects.toThrow(/recipe_version_lines_unit_fk/);
    await line("recl_6", v1!.id, milkA);
    await sql`INSERT INTO qos.recipe_version_steps (tenant_id, public_id, recipe_version_id, position, text_en)
              VALUES (${tenantA.id}, 'recs_1', ${v1!.id}, 0, 'Pour.')`;
    await sql`INSERT INTO qos.recipe_version_snapshots (tenant_id, recipe_version_id, snapshot) VALUES (${tenantA.id}, ${v1!.id}, '{"schema":1}')`;
    await expect(sql`INSERT INTO qos.recipe_version_snapshots (tenant_id, recipe_version_id, snapshot) VALUES (${tenantA.id}, ${v1!.id}, '{}')`).rejects.toThrow(
      /recipe_version_snapshots_version_unique/,
    );

    const [variantA] = await sql<{ id: string }[]>`
      WITH brand AS (SELECT id FROM qos.brands WHERE tenant_id = ${tenantA.id} LIMIT 1),
      product AS (
        INSERT INTO qos.catalogue_products (tenant_id, brand_id, public_id, internal_name, provenance)
        SELECT ${tenantA.id}, brand.id, 'prod_latte', 'latte', 'operator_entered' FROM brand RETURNING id)
      INSERT INTO qos.catalogue_variants (tenant_id, product_id, public_id, is_default)
      SELECT ${tenantA.id}, product.id, 'var_latte', true FROM product RETURNING id`;
    const link = (values: { publicId: string; kind: string; recipeId?: string | null; itemId?: string | null; quantity?: number | null; unitId?: string | null; revision: number; to?: string | null }) =>
      sql`INSERT INTO qos.recipe_sellable_links (tenant_id, public_id, variant_id, kind, recipe_id, item_id, quantity_micros, unit_id, effective_from, effective_to, revision, provenance)
          VALUES (${tenantA.id}, ${values.publicId}, ${variantA!.id}, ${values.kind}, ${values.recipeId ?? null}, ${values.itemId ?? null}, ${values.quantity ?? null},
                  ${values.unitId ?? null}, '2026-11-01', ${values.to ?? null}, ${values.revision}, 'operator_entered')`;
    await expect(link({ publicId: "link_bad", kind: "recipe", recipeId: latte!.id, itemId: milkA, revision: 1 })).rejects.toThrow(/recipe_sellable_links_shape_check/);
    await expect(link({ publicId: "link_bad", kind: "direct_stock", itemId: milkA, revision: 1 })).rejects.toThrow(/recipe_sellable_links_shape_check/);
    await link({ publicId: "link_1", kind: "recipe", recipeId: latte!.id, revision: 1, to: "2026-11-05" });
    await link({ publicId: "link_2", kind: "direct_stock", itemId: milkA, quantity: 250000000, unitId: unitA, revision: 2 });
    // One open link per variant: a recipe link and a direct-stock link cannot both be open.
    await expect(link({ publicId: "link_3", kind: "recipe", recipeId: latte!.id, revision: 3 })).rejects.toThrow(/recipe_sellable_links_current_unique/);

    const asApp = (tenantId: string, statement: (tx: typeof sql) => Promise<unknown>) =>
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE qos_app");
        await tx`SELECT set_config('qos.current_tenant_id', ${tenantId}, true)`;
        return statement(tx as unknown as typeof sql);
      });
    for (const table of TABLES) {
      const hidden = (await asApp(tenantB.id, (tx) => tx.unsafe(`SELECT id FROM qos.${table} WHERE tenant_id = '${tenantA.id}'`))) as unknown[];
      expect(hidden, table).toHaveLength(0);
      const visible = (await asApp(tenantA.id, (tx) => tx.unsafe(`SELECT id FROM qos.${table}`))) as unknown[];
      expect(visible.length, table).toBeGreaterThan(0);
      await expect(asApp(tenantA.id, (tx) => tx.unsafe(`DELETE FROM qos.${table}`)), table).rejects.toThrow(/permission denied/);
    }
    // Identity columns, a line's version, snapshot content and a link's target are never rewritten by the application role.
    for (const statement of [
      "UPDATE qos.recipe_versions SET version_number = 7 WHERE public_id = 'recv_1'",
      "UPDATE qos.recipe_versions SET recipe_id = recipe_id WHERE public_id = 'recv_1'",
      "UPDATE qos.recipe_versions SET public_id = 'recv_z' WHERE public_id = 'recv_1'",
      "UPDATE qos.recipe_version_lines SET recipe_version_id = recipe_version_id WHERE public_id = 'recl_6'",
      "UPDATE qos.recipe_version_steps SET recipe_version_id = recipe_version_id WHERE public_id = 'recs_1'",
      "UPDATE qos.recipe_version_snapshots SET snapshot = '{}'",
      "UPDATE qos.recipe_sellable_links SET quantity_micros = 1 WHERE public_id = 'link_2'",
      "UPDATE qos.recipe_sellable_links SET recipe_id = NULL WHERE public_id = 'link_2'",
      "UPDATE qos.recipe_sellable_links SET effective_from = '2026-10-01' WHERE public_id = 'link_2'",
    ]) {
      await expect(asApp(tenantA.id, (tx) => tx.unsafe(statement)), statement).rejects.toThrow(/permission denied/);
    }
    const ended = (await asApp(tenantA.id, (tx) =>
      tx`UPDATE qos.recipe_sellable_links SET effective_to = '2026-11-20' WHERE public_id = 'link_2' RETURNING public_id`,
    )) as unknown[];
    expect(ended).toHaveLength(1);
    await expect(
      asApp(tenantB.id, (tx) =>
        tx`INSERT INTO qos.recipes (tenant_id, public_id, name_en, kind, provenance) VALUES (${tenantA.id}, 'rec_sneak', 'Sneak', 'sellable', 'operator_entered')`,
      ),
    ).rejects.toThrow(/row-level security/);
    const renamedFromB = (await asApp(tenantB.id, (tx) => tx`UPDATE qos.recipes SET name_en = 'Taken' WHERE public_id = 'rec_latte' RETURNING id`)) as unknown[];
    expect(renamedFromB).toHaveLength(0);
  });
});
