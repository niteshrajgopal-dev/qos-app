import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const TAG = "0062_inventory_categories_reference_costs";
const TABLES = ["inventory_categories", "inventory_item_reference_costs"] as const;

type Journal = { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };

describe("inventory categories and reference costs migration journal (0062)", () => {
  it("is journalled as idx 62 directly after 0061, with every idx and when strictly increasing", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === TAG);
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toEqual({ idx: 62, version: "7", when: 1793500000000, tag: TAG, breakpoints: true });
    expect(journal.entries[position - 1]).toEqual({
      idx: 61,
      version: "7",
      when: 1793400000000,
      tag: "0061_inventory_suppliers_warehouses",
      breakpoints: true,
    });
    expect(journal.entries.filter((entry) => entry.idx === 62)).toHaveLength(1);
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
  });

  it("creates both tables with forced RLS, the partial indexes and the item category FK, append-only cost grants and no DELETE grant or seed rows", () => {
    const sql = readFileSync(path.join(process.cwd(), `drizzle/${TAG}.sql`), "utf8");
    for (const table of TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "qos"."${table}"`);
      expect(sql).toContain(`ALTER TABLE "qos"."${table}" ENABLE ROW LEVEL SECURITY`);
      expect(sql).toContain(`ALTER TABLE "qos"."${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`CREATE POLICY "${table}_tenant_isolation"`);
    }
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."inventory_categories" TO qos_app');
    expect(sql).toContain('GRANT SELECT, INSERT ON TABLE "qos"."inventory_item_reference_costs" TO qos_app');
    expect(sql).toContain('GRANT UPDATE ("effective_to") ON TABLE "qos"."inventory_item_reference_costs" TO qos_app');
    expect(sql).not.toContain('GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."inventory_item_reference_costs"');
    expect(sql).toContain('"inventory_categories_active_name_unique"');
    expect(sql).toContain(`lower(btrim("name_en"))) WHERE "status" = 'active'`);
    expect(sql).toContain('"inventory_item_reference_costs_current_unique"');
    expect(sql).toContain(`("tenant_id", "item_id") WHERE "effective_to" IS NULL`);
    expect(sql).toContain(
      '"inventory_items_category_fk" FOREIGN KEY ("tenant_id", "category_id") REFERENCES "qos"."inventory_categories"("tenant_id", "id")',
    );
    expect(sql).toContain('"amount_micros" bigint NOT NULL');
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/);
    expect(sql).not.toMatch(/^\s*INSERT INTO/m);
    expect(sql).not.toMatch(/^\s*(UPDATE|DELETE)\b/m);
    expect(sql).not.toContain("catalogue_");
  });
});

integrationDescribe("inventory categories and reference costs migration (0062)", () => {
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

  it("records 0062 in the journal after 0061", async () => {
    const rows = await sql<{ created_at: string }[]>`
      SELECT created_at::text FROM drizzle.__drizzle_migrations
      WHERE created_at <= 1793500000000 ORDER BY created_at DESC LIMIT 2`;
    expect(rows.map((row) => row.created_at)).toEqual(["1793500000000", "1793400000000"]);
  });

  it("creates the columns, constraints and indexes", async () => {
    const columns = async (table: string) =>
      Object.fromEntries(
        (
          await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
            SELECT column_name, data_type, is_nullable FROM information_schema.columns
            WHERE table_schema = 'qos' AND table_name = ${table} ORDER BY ordinal_position`
        ).map((column) => [column.column_name, `${column.data_type}:${column.is_nullable}`]),
      );
    expect(await columns("inventory_categories")).toEqual({
      id: "uuid:NO",
      tenant_id: "uuid:NO",
      public_id: "text:NO",
      name_en: "text:NO",
      name_ar: "text:YES",
      status: "text:NO",
      version: "integer:NO",
      provenance: "USER-DEFINED:NO",
      created_at: "timestamp with time zone:NO",
      updated_at: "timestamp with time zone:NO",
      created_by_subject: "text:YES",
      updated_by_subject: "text:YES",
    });
    expect(await columns("inventory_item_reference_costs")).toEqual({
      id: "uuid:NO",
      tenant_id: "uuid:NO",
      public_id: "text:NO",
      item_id: "uuid:NO",
      unit_id: "uuid:NO",
      amount_micros: "bigint:NO",
      currency: "character:NO",
      tax_basis: "text:NO",
      source: "text:NO",
      source_reference: "text:YES",
      effective_from: "date:NO",
      effective_to: "date:YES",
      revision: "integer:NO",
      provenance: "USER-DEFINED:NO",
      created_at: "timestamp with time zone:NO",
      created_by_subject: "text:YES",
    });
    expect(await columns("inventory_items")).toMatchObject({ category_id: "uuid:YES", notes: "text:YES" });

    const constraintNames = async (table: string) =>
      (
        await sql<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE conrelid = ${`qos.${table}`}::regclass`
      ).map((row) => row.conname);
    expect(await constraintNames("inventory_categories")).toEqual(
      expect.arrayContaining([
        "inventory_categories_public_id_check",
        "inventory_categories_name_en_check",
        "inventory_categories_name_ar_check",
        "inventory_categories_status_check",
        "inventory_categories_version_check",
        "inventory_categories_tenant_id_id_unique",
        "inventory_categories_tenant_public_id_unique",
        "inventory_categories_tenant_fk",
      ]),
    );
    expect(await constraintNames("inventory_item_reference_costs")).toEqual(
      expect.arrayContaining([
        "inventory_item_reference_costs_public_id_check",
        "inventory_item_reference_costs_amount_check",
        "inventory_item_reference_costs_currency_check",
        "inventory_item_reference_costs_tax_basis_check",
        "inventory_item_reference_costs_source_check",
        "inventory_item_reference_costs_source_reference_check",
        "inventory_item_reference_costs_dates_check",
        "inventory_item_reference_costs_revision_check",
        "inventory_item_reference_costs_tenant_public_id_unique",
        "inventory_item_reference_costs_revision_unique",
        "inventory_item_reference_costs_item_fk",
        "inventory_item_reference_costs_unit_fk",
      ]),
    );
    expect(await constraintNames("inventory_items")).toEqual(
      expect.arrayContaining(["inventory_items_category_fk", "inventory_items_notes_check"]),
    );

    const indexDef = async (name: string) =>
      (await sql<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE schemaname = 'qos' AND indexname = ${name}`)[0]
        ?.indexdef;
    const activeName = await indexDef("inventory_categories_active_name_unique");
    expect(activeName).toContain("UNIQUE INDEX");
    expect(activeName).toContain("(tenant_id, lower(btrim(name_en)))");
    expect(activeName).toContain("WHERE (status = 'active'::text)");
    const currentCost = await indexDef("inventory_item_reference_costs_current_unique");
    expect(currentCost).toContain("UNIQUE INDEX");
    expect(currentCost).toContain("(tenant_id, item_id)");
    expect(currentCost).toContain("WHERE (effective_to IS NULL)");
    expect(await indexDef("inventory_item_reference_costs_tenant_item_idx")).toContain("(tenant_id, item_id)");
    expect(await indexDef("inventory_items_tenant_category_idx")).toContain("(tenant_id, category_id)");
    expect(await indexDef("inventory_categories_tenant_id_idx")).toContain("(tenant_id)");
  });

  it("forces RLS with a tenant policy, grants no DELETE and lets qos_app update only effective_to on costs", async () => {
    for (const table of TABLES) {
      const [rls] = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${`qos.${table}`}::regclass`;
      expect(rls, table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const policies = await sql<{ policyname: string }[]>`
        SELECT policyname FROM pg_policies WHERE schemaname = 'qos' AND tablename = ${table}`;
      expect(policies.map((row) => row.policyname)).toEqual([`${table}_tenant_isolation`]);
    }
    const tableGrants = async (table: string) =>
      (
        await sql<{ privilege_type: string }[]>`
          SELECT privilege_type FROM information_schema.role_table_grants
          WHERE table_schema = 'qos' AND table_name = ${table} AND grantee = 'qos_app' ORDER BY privilege_type`
      ).map((row) => row.privilege_type);
    expect(await tableGrants("inventory_categories")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(await tableGrants("inventory_item_reference_costs")).toEqual(["INSERT", "SELECT"]);
    const updatable = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.column_privileges
      WHERE table_schema = 'qos' AND table_name = 'inventory_item_reference_costs'
        AND grantee = 'qos_app' AND privilege_type = 'UPDATE'`;
    expect(updatable.map((row) => row.column_name)).toEqual(["effective_to"]);
  });

  it("enforces active-name uniqueness, tenant-matching FKs, immutable cost amounts and tenant isolation", async () => {
    const tenantA = (await createTenantHierarchy(db, quotesTenantFixture())).tenant;
    const tenantB = (await createTenantHierarchy(db, flowerTenantFixture())).tenant;
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT (SELECT count(*) FROM qos.inventory_categories) + (SELECT count(*) FROM qos.inventory_item_reference_costs) AS count`;
    expect(Number(count)).toBe(0);

    const insertCategory = (tenantId: string, publicId: string, nameEn: string, status = "active") =>
      sql<{ id: string }[]>`INSERT INTO qos.inventory_categories (tenant_id, public_id, name_en, status, provenance)
          VALUES (${tenantId}, ${publicId}, ${nameEn}, ${status}, 'operator_entered') RETURNING id`;
    const [dairy] = await insertCategory(tenantA.id, "invcat_dairy_1", "Dairy");
    await expect(insertCategory(tenantA.id, "invcat_dairy_2", " dairy ")).rejects.toThrow(/inventory_categories_active_name_unique/);
    // An archived category keeps its name as history and does not block an active one.
    await insertCategory(tenantA.id, "invcat_dairy_0", "Dairy", "archived");
    // The same name in another tenant is fine.
    const [dairyB] = await insertCategory(tenantB.id, "invcat_dairy_b", "Dairy");
    await expect(insertCategory(tenantA.id, "cat_bad", "Bad")).rejects.toThrow(/inventory_categories_public_id_check/);

    const [unitA] = await sql<{ id: string }[]>`
      INSERT INTO qos.inventory_units (tenant_id, public_id, code, name_en, name_ar, quantity_kind, standard_code, decimal_places, provenance)
      VALUES (${tenantA.id}, 'unit_kg_a', 'kg', 'Kilogram', 'كيلوغرام', 'mass', 'kg', 3, 'operator_entered') RETURNING id`;
    const [unitB] = await sql<{ id: string }[]>`
      INSERT INTO qos.inventory_units (tenant_id, public_id, code, name_en, name_ar, quantity_kind, standard_code, decimal_places, provenance)
      VALUES (${tenantB.id}, 'unit_kg_b', 'kg', 'Kilogram', 'كيلوغرام', 'mass', 'kg', 3, 'operator_entered') RETURNING id`;
    const [itemA] = await sql<{ id: string }[]>`
      INSERT INTO qos.inventory_items (tenant_id, public_id, name_en, kind, category_id, notes, provenance)
      VALUES (${tenantA.id}, 'item_milk_a', 'Milk', 'purchased', ${dairy!.id}, 'Keep cold.', 'operator_entered') RETURNING id`;
    // An item cannot point at another tenant's category (composite FK).
    await expect(sql`UPDATE qos.inventory_items SET category_id = ${dairyB!.id} WHERE id = ${itemA!.id}`).rejects.toThrow(
      /inventory_items_category_fk/,
    );
    await expect(sql`UPDATE qos.inventory_items SET notes = ${"x".repeat(1001)} WHERE id = ${itemA!.id}`).rejects.toThrow(
      /inventory_items_notes_check/,
    );

    const insertCost = (values: { tenantId: string; publicId: string; itemId: string; unitId: string; amount: string; revision: number; to?: string | null }) =>
      sql`INSERT INTO qos.inventory_item_reference_costs
            (tenant_id, public_id, item_id, unit_id, amount_micros, currency, tax_basis, source, effective_from, effective_to, revision, provenance)
          VALUES (${values.tenantId}, ${values.publicId}, ${values.itemId}, ${values.unitId}, ${values.amount}, 'AED', 'net', 'manual',
                  '2026-11-01', ${values.to ?? null}, ${values.revision}, 'operator_entered')`;
    await insertCost({ tenantId: tenantA.id, publicId: "cost_a1", itemId: itemA!.id, unitId: unitA!.id, amount: "12345678", revision: 1, to: "2026-11-02" });
    await insertCost({ tenantId: tenantA.id, publicId: "cost_a2", itemId: itemA!.id, unitId: unitA!.id, amount: "0", revision: 2 });
    // One current cost per item.
    await expect(
      insertCost({ tenantId: tenantA.id, publicId: "cost_a3", itemId: itemA!.id, unitId: unitA!.id, amount: "1", revision: 3 }),
    ).rejects.toThrow(/inventory_item_reference_costs_current_unique/);
    // Cross-tenant unit and item are refused by the composite FKs.
    await expect(
      insertCost({ tenantId: tenantA.id, publicId: "cost_x1", itemId: itemA!.id, unitId: unitB!.id, amount: "1", revision: 4, to: "2026-11-01" }),
    ).rejects.toThrow(/inventory_item_reference_costs_unit_fk/);
    await expect(
      insertCost({ tenantId: tenantB.id, publicId: "cost_x2", itemId: itemA!.id, unitId: unitB!.id, amount: "1", revision: 1 }),
    ).rejects.toThrow(/inventory_item_reference_costs_item_fk/);
    await expect(
      insertCost({ tenantId: tenantA.id, publicId: "cost_neg", itemId: itemA!.id, unitId: unitA!.id, amount: "-1", revision: 5, to: "2026-11-01" }),
    ).rejects.toThrow(/inventory_item_reference_costs_amount_check/);
    await expect(sql`
      INSERT INTO qos.inventory_item_reference_costs
        (tenant_id, public_id, item_id, unit_id, amount_micros, currency, tax_basis, source, effective_from, effective_to, revision, provenance)
      VALUES (${tenantA.id}, 'cost_basis', ${itemA!.id}, ${unitA!.id}, 1, 'AED', 'NET', 'manual', '2026-11-01', '2026-11-01', 6, 'operator_entered')`).rejects.toThrow(
      /inventory_item_reference_costs_tax_basis_check/,
    );

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
    // A stored amount, unit or date is never rewritten by the application role.
    for (const column of ["amount_micros = 1", "tax_basis = 'gross'", "effective_from = '2026-10-01'", "revision = 9"]) {
      await expect(
        asApp(tenantA.id, (tx) => tx.unsafe(`UPDATE qos.inventory_item_reference_costs SET ${column} WHERE public_id = 'cost_a1'`)),
        column,
      ).rejects.toThrow(/permission denied/);
    }
    const closed = (await asApp(tenantA.id, (tx) =>
      tx`UPDATE qos.inventory_item_reference_costs SET effective_to = '2026-11-03' WHERE public_id = 'cost_a2' RETURNING public_id`,
    )) as unknown[];
    expect(closed).toHaveLength(1);
    await expect(
      asApp(tenantB.id, (tx) =>
        tx`INSERT INTO qos.inventory_categories (tenant_id, public_id, name_en, provenance)
           VALUES (${tenantA.id}, 'invcat_sneak', 'Sneak', 'operator_entered')`,
      ),
    ).rejects.toThrow(/row-level security/);
    const renamedFromB = (await asApp(tenantB.id, (tx) =>
      tx`UPDATE qos.inventory_categories SET name_en = 'Taken' WHERE public_id = 'invcat_dairy_1' RETURNING id`,
    )) as unknown[];
    expect(renamedFromB).toHaveLength(0);
    const [row] = await sql<{ amount_micros: string; effective_to: string | null }[]>`
      SELECT amount_micros::text, effective_to::text FROM qos.inventory_item_reference_costs WHERE public_id = 'cost_a1'`;
    expect(row).toEqual({ amount_micros: "12345678", effective_to: "2026-11-02" });
  });
});
