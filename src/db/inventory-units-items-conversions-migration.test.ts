import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const TAG = "0060_inventory_units_items_conversions";
const TABLES = ["inventory_units", "inventory_items", "inventory_item_conversions"] as const;

type Journal = { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };

describe("inventory units, items and conversions migration journal (0060)", () => {
  it("is journalled as idx 60 directly after 0059, with every idx and when strictly increasing", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === TAG);
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toEqual({ idx: 60, version: "7", when: 1793300000000, tag: TAG, breakpoints: true });
    expect(journal.entries[position - 1]).toMatchObject({
      idx: 59,
      when: 1793200000000,
      tag: "0059_catalogue_selling_tax_and_reference_costs",
    });
    expect(journal.entries.filter((entry) => entry.idx === 60)).toHaveLength(1);
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
  });

  it("creates the three tables, the partial current index and the effective_to-only update grant", () => {
    const sql = readFileSync(path.join(process.cwd(), `drizzle/${TAG}.sql`), "utf8");
    for (const table of TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "qos"."${table}"`);
      expect(sql).toContain(`ALTER TABLE "qos"."${table}" FORCE ROW LEVEL SECURITY`);
    }
    expect(sql).toContain('"inventory_item_conversions_current_unique"');
    expect(sql).toContain('WHERE "effective_to" IS NULL');
    expect(sql).toContain('GRANT UPDATE ("effective_to") ON TABLE "qos"."inventory_item_conversions" TO qos_app');
    expect(sql).not.toMatch(/GRANT[^;]*DELETE[^;]*inventory/);
    expect(sql).not.toMatch(/^\s*INSERT INTO/m);
  });
});

integrationDescribe("inventory units, items and conversions migration (0060)", () => {
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

  it("records 0060 in the journal after 0059", async () => {
    const rows = await sql<{ created_at: string }[]>`
      SELECT created_at::text FROM drizzle.__drizzle_migrations
      WHERE created_at <= 1793300000000 ORDER BY created_at DESC LIMIT 2`;
    expect(rows.map((row) => row.created_at)).toEqual(["1793300000000", "1793200000000"]);
  });

  it("creates the columns and checks", async () => {
    const columns = async (table: string) =>
      Object.fromEntries(
        (
          await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
            SELECT column_name, data_type, is_nullable FROM information_schema.columns
            WHERE table_schema = 'qos' AND table_name = ${table} ORDER BY ordinal_position`
        ).map((column) => [column.column_name, `${column.data_type}:${column.is_nullable}`]),
      );
    expect(await columns("inventory_units")).toEqual({
      id: "uuid:NO",
      tenant_id: "uuid:NO",
      public_id: "text:NO",
      code: "text:NO",
      name_en: "text:NO",
      name_ar: "text:NO",
      quantity_kind: "text:NO",
      standard_code: "text:YES",
      decimal_places: "integer:NO",
      status: "text:NO",
      version: "integer:NO",
      provenance: "USER-DEFINED:NO",
      created_at: "timestamp with time zone:NO",
      updated_at: "timestamp with time zone:NO",
      created_by_subject: "text:YES",
      updated_by_subject: "text:YES",
    });
    expect(await columns("inventory_items")).toMatchObject({
      name_en: "text:NO",
      name_ar: "text:YES",
      kind: "text:NO",
      storage_unit_id: "uuid:YES",
      recipe_unit_id: "uuid:YES",
      purchase_unit_id: "uuid:YES",
    });
    expect(await columns("inventory_item_conversions")).toEqual({
      id: "uuid:NO",
      tenant_id: "uuid:NO",
      public_id: "text:NO",
      item_id: "uuid:NO",
      from_unit_id: "uuid:NO",
      to_unit_id: "uuid:NO",
      factor_micros: "bigint:NO",
      justification: "text:YES",
      effective_from: "date:NO",
      effective_to: "date:YES",
      revision: "integer:NO",
      provenance: "USER-DEFINED:NO",
      created_at: "timestamp with time zone:NO",
      created_by_subject: "text:YES",
    });

    const constraintNames = async (table: string) =>
      (
        await sql<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE conrelid = ${`qos.${table}`}::regclass`
      ).map((row) => row.conname);
    expect(await constraintNames("inventory_units")).toEqual(
      expect.arrayContaining([
        "inventory_units_code_check",
        "inventory_units_quantity_kind_check",
        "inventory_units_standard_code_check",
        "inventory_units_decimal_places_check",
        "inventory_units_tenant_code_unique",
      ]),
    );
    expect(await constraintNames("inventory_item_conversions")).toEqual(
      expect.arrayContaining([
        "inventory_item_conversions_factor_check",
        "inventory_item_conversions_units_check",
        "inventory_item_conversions_dates_check",
        "inventory_item_conversions_revision_unique",
        "inventory_item_conversions_item_fk",
        "inventory_item_conversions_from_unit_fk",
        "inventory_item_conversions_to_unit_fk",
      ]),
    );
    const [currentIndex] = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'qos' AND indexname = 'inventory_item_conversions_current_unique'`;
    expect(currentIndex?.indexdef).toContain("UNIQUE INDEX");
    expect(currentIndex?.indexdef).toContain("(tenant_id, item_id, from_unit_id, to_unit_id)");
    expect(currentIndex?.indexdef).toContain("WHERE (effective_to IS NULL)");
  });

  it("forces RLS with a tenant policy and grants no DELETE", async () => {
    for (const table of TABLES) {
      const [rls] = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${`qos.${table}`}::regclass`;
      expect(rls, table).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const policies = await sql<{ policyname: string }[]>`
        SELECT policyname FROM pg_policies WHERE schemaname = 'qos' AND tablename = ${table}`;
      expect(policies.map((row) => row.policyname)).toEqual([`${table}_tenant_isolation`]);
      const grants = await sql<{ privilege_type: string }[]>`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'qos' AND table_name = ${table} AND grantee = 'qos_app' ORDER BY privilege_type`;
      expect(grants.map((row) => row.privilege_type), table).toEqual(
        table === "inventory_item_conversions" ? ["INSERT", "SELECT"] : ["INSERT", "SELECT", "UPDATE"],
      );
    }
    const columnUpdates = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.column_privileges
      WHERE table_schema = 'qos' AND table_name = 'inventory_item_conversions' AND grantee = 'qos_app' AND privilege_type = 'UPDATE'`;
    expect(columnUpdates.map((row) => row.column_name)).toEqual(["effective_to"]);
  });

  it("enforces the checks, keeps factors immutable for qos_app and isolates tenants", async () => {
    const tenantA = (await createTenantHierarchy(db, quotesTenantFixture())).tenant;
    const tenantB = (await createTenantHierarchy(db, flowerTenantFixture())).tenant;
    const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM qos.inventory_units`;
    expect(count).toBe(0);

    const [packet] = await sql<{ id: string }[]>`
      INSERT INTO qos.inventory_units (tenant_id, public_id, code, name_en, name_ar, quantity_kind, decimal_places, provenance)
      VALUES (${tenantA.id}, 'unit_packet_1', 'packet', 'Packet', 'علبة', 'pack', 0, 'operator_entered') RETURNING id`;
    const [piece] = await sql<{ id: string }[]>`
      INSERT INTO qos.inventory_units (tenant_id, public_id, code, name_en, name_ar, quantity_kind, standard_code, decimal_places, provenance)
      VALUES (${tenantA.id}, 'unit_piece_1', 'piece', 'Piece', 'قطعة', 'count', 'piece', 0, 'operator_entered') RETURNING id`;
    await expect(sql`
      INSERT INTO qos.inventory_units (tenant_id, public_id, code, name_en, name_ar, quantity_kind, standard_code, decimal_places, provenance)
      VALUES (${tenantA.id}, 'unit_oz_1', 'oz', 'Ounce', 'أونصة', 'mass', 'oz', 0, 'operator_entered')`).rejects.toThrow(
      /inventory_units_standard_code_check/,
    );
    await expect(sql`
      INSERT INTO qos.inventory_units (tenant_id, public_id, code, name_en, name_ar, quantity_kind, decimal_places, provenance)
      VALUES (${tenantA.id}, 'unit_box_1', 'Box', 'Box', 'صندوق', 'pack', 7, 'operator_entered')`).rejects.toThrow(/check/);
    const [item] = await sql<{ id: string }[]>`
      INSERT INTO qos.inventory_items (tenant_id, public_id, name_en, kind, provenance)
      VALUES (${tenantA.id}, 'item_buns_1', 'Buns', 'purchased', 'operator_entered') RETURNING id`;
    await expect(sql`
      INSERT INTO qos.inventory_item_conversions (tenant_id, public_id, item_id, from_unit_id, to_unit_id, factor_micros, effective_from, revision, provenance)
      VALUES (${tenantA.id}, 'conv_zero', ${item!.id}, ${packet!.id}, ${piece!.id}, 0, '2026-11-01', 1, 'operator_entered')`).rejects.toThrow(
      /inventory_item_conversions_factor_check/,
    );
    await expect(sql`
      INSERT INTO qos.inventory_item_conversions (tenant_id, public_id, item_id, from_unit_id, to_unit_id, factor_micros, effective_from, revision, provenance)
      VALUES (${tenantA.id}, 'conv_same', ${item!.id}, ${packet!.id}, ${packet!.id}, 1, '2026-11-01', 1, 'operator_entered')`).rejects.toThrow(
      /inventory_item_conversions_units_check/,
    );
    await sql`
      INSERT INTO qos.inventory_item_conversions (tenant_id, public_id, item_id, from_unit_id, to_unit_id, factor_micros, effective_from, revision, provenance)
      VALUES (${tenantA.id}, 'conv_one', ${item!.id}, ${packet!.id}, ${piece!.id}, 12000000, '2026-11-01', 1, 'operator_entered')`;
    await expect(sql`
      INSERT INTO qos.inventory_item_conversions (tenant_id, public_id, item_id, from_unit_id, to_unit_id, factor_micros, effective_from, revision, provenance)
      VALUES (${tenantA.id}, 'conv_two', ${item!.id}, ${packet!.id}, ${piece!.id}, 10000000, '2026-11-02', 2, 'operator_entered')`).rejects.toThrow(
      /inventory_item_conversions_current_unique/,
    );
    // A tenant B item cannot reference tenant A units (composite FK).
    const [itemB] = await sql<{ id: string }[]>`
      INSERT INTO qos.inventory_items (tenant_id, public_id, name_en, kind, provenance)
      VALUES (${tenantB.id}, 'item_buns_2', 'Buns', 'purchased', 'operator_entered') RETURNING id`;
    await expect(sql`UPDATE qos.inventory_items SET storage_unit_id = ${packet!.id} WHERE id = ${itemB!.id}`).rejects.toThrow(
      /inventory_items_storage_unit_fk/,
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
      await expect(asApp(tenantA.id, (tx) => tx.unsafe(`DELETE FROM qos.${table}`)), table).rejects.toThrow(/permission denied/);
    }
    await expect(
      asApp(tenantA.id, (tx) => tx`UPDATE qos.inventory_item_conversions SET factor_micros = 5 WHERE public_id = 'conv_one'`),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asApp(tenantA.id, (tx) => tx`UPDATE qos.inventory_item_conversions SET revision = 9 WHERE public_id = 'conv_one'`),
    ).rejects.toThrow(/permission denied/);
    // Closing is the one permitted change, and RLS still applies to it.
    const closedFromB = (await asApp(tenantB.id, (tx) =>
      tx`UPDATE qos.inventory_item_conversions SET effective_to = '2026-11-05' WHERE public_id = 'conv_one' RETURNING id`,
    )) as unknown[];
    expect(closedFromB).toHaveLength(0);
    const closed = (await asApp(tenantA.id, (tx) =>
      tx`UPDATE qos.inventory_item_conversions SET effective_to = '2026-11-05' WHERE public_id = 'conv_one' RETURNING id`,
    )) as unknown[];
    expect(closed).toHaveLength(1);
    await expect(
      asApp(tenantB.id, (tx) =>
        tx`INSERT INTO qos.inventory_units (tenant_id, public_id, code, name_en, name_ar, quantity_kind, decimal_places, provenance)
           VALUES (${tenantA.id}, 'unit_sneak_1', 'sneak', 'Sneak', 'تسلل', 'pack', 0, 'operator_entered')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await runAsRole(sql, "qos", async () => {
      const [row] = await sql<{ factor_micros: string; effective_to: string }[]>`
        SELECT factor_micros::text, effective_to::text FROM qos.inventory_item_conversions WHERE public_id = 'conv_one'`;
      expect(row).toEqual({ factor_micros: "12000000", effective_to: "2026-11-05" });
    });
  });
});
