import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const TAG = "0061_inventory_suppliers_warehouses";
const TABLES = ["inventory_suppliers", "inventory_warehouses"] as const;

type Journal = { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };

describe("inventory suppliers and warehouses migration journal (0061)", () => {
  it("is journalled as idx 61 directly after 0060, with every idx and when strictly increasing", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === TAG);
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toEqual({ idx: 61, version: "7", when: 1793400000000, tag: TAG, breakpoints: true });
    expect(journal.entries[position - 1]).toEqual({
      idx: 60,
      version: "7",
      when: 1793300000000,
      tag: "0060_inventory_units_items_conversions",
      breakpoints: true,
    });
    expect(journal.entries.filter((entry) => entry.idx === 61)).toHaveLength(1);
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
  });

  it("creates both tables with forced RLS, the partial active-warehouse index and the default supplier FK, and no DELETE grant or seed rows", () => {
    const sql = readFileSync(path.join(process.cwd(), `drizzle/${TAG}.sql`), "utf8");
    for (const table of TABLES) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "qos"."${table}"`);
      expect(sql).toContain(`ALTER TABLE "qos"."${table}" FORCE ROW LEVEL SECURITY`);
      expect(sql).toContain(`GRANT SELECT, INSERT, UPDATE ON TABLE "qos"."${table}" TO qos_app`);
    }
    expect(sql).toContain('"inventory_warehouses_active_location_unique"');
    expect(sql).toContain(`WHERE "status" = 'active'`);
    expect(sql).toContain('"inventory_warehouses_location_fk" FOREIGN KEY ("tenant_id", "location_id") REFERENCES "qos"."locations"("tenant_id", "id")');
    expect(sql).toContain('"inventory_items_default_supplier_fk"');
    expect(sql).not.toMatch(/GRANT[^;]*DELETE/);
    expect(sql).not.toMatch(/^\s*INSERT INTO/m);
    expect(sql).not.toMatch(/^\s*(UPDATE|ALTER TABLE "qos"\."locations")/m);
  });
});

integrationDescribe("inventory suppliers and warehouses migration (0061)", () => {
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

  it("records 0061 in the journal after 0060", async () => {
    const rows = await sql<{ created_at: string }[]>`
      SELECT created_at::text FROM drizzle.__drizzle_migrations
      WHERE created_at <= 1793400000000 ORDER BY created_at DESC LIMIT 2`;
    expect(rows.map((row) => row.created_at)).toEqual(["1793400000000", "1793300000000"]);
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
    const audit = {
      status: "text:NO",
      version: "integer:NO",
      provenance: "USER-DEFINED:NO",
      created_at: "timestamp with time zone:NO",
      updated_at: "timestamp with time zone:NO",
      created_by_subject: "text:YES",
      updated_by_subject: "text:YES",
    };
    expect(await columns("inventory_suppliers")).toEqual({
      id: "uuid:NO",
      tenant_id: "uuid:NO",
      public_id: "text:NO",
      name_en: "text:NO",
      name_ar: "text:YES",
      code: "text:YES",
      contact_name: "text:YES",
      phone: "text:YES",
      email: "text:YES",
      address: "text:YES",
      notes: "text:YES",
      ...audit,
    });
    expect(await columns("inventory_warehouses")).toEqual({
      id: "uuid:NO",
      tenant_id: "uuid:NO",
      public_id: "text:NO",
      location_id: "uuid:NO",
      code: "text:NO",
      name_en: "text:NO",
      name_ar: "text:YES",
      notes: "text:YES",
      ...audit,
    });
    expect(await columns("inventory_items")).toMatchObject({ default_supplier_id: "uuid:YES" });

    const constraintNames = async (table: string) =>
      (
        await sql<{ conname: string }[]>`SELECT conname FROM pg_constraint WHERE conrelid = ${`qos.${table}`}::regclass`
      ).map((row) => row.conname);
    expect(await constraintNames("inventory_suppliers")).toEqual(
      expect.arrayContaining([
        "inventory_suppliers_public_id_check",
        "inventory_suppliers_code_check",
        "inventory_suppliers_phone_check",
        "inventory_suppliers_email_check",
        "inventory_suppliers_status_check",
        "inventory_suppliers_tenant_id_id_unique",
        "inventory_suppliers_tenant_public_id_unique",
        "inventory_suppliers_tenant_fk",
      ]),
    );
    expect(await constraintNames("inventory_warehouses")).toEqual(
      expect.arrayContaining([
        "inventory_warehouses_public_id_check",
        "inventory_warehouses_code_check",
        "inventory_warehouses_status_check",
        "inventory_warehouses_tenant_id_id_unique",
        "inventory_warehouses_location_fk",
      ]),
    );
    expect(await constraintNames("inventory_items")).toEqual(expect.arrayContaining(["inventory_items_default_supplier_fk"]));

    const indexDef = async (name: string) =>
      (await sql<{ indexdef: string }[]>`SELECT indexdef FROM pg_indexes WHERE schemaname = 'qos' AND indexname = ${name}`)[0]
        ?.indexdef;
    const activeLocation = await indexDef("inventory_warehouses_active_location_unique");
    expect(activeLocation).toContain("UNIQUE INDEX");
    expect(activeLocation).toContain("(tenant_id, location_id)");
    expect(activeLocation).toContain("WHERE (status = 'active'::text)");
    expect(await indexDef("inventory_warehouses_tenant_code_unique")).toContain("(tenant_id, lower(code))");
    const supplierCode = await indexDef("inventory_suppliers_tenant_code_unique");
    expect(supplierCode).toContain("(tenant_id, lower(code))");
    expect(supplierCode).toContain("WHERE (code IS NOT NULL)");
    expect(await indexDef("inventory_items_tenant_default_supplier_idx")).toContain("(tenant_id, default_supplier_id)");
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
      expect(grants.map((row) => row.privilege_type), table).toEqual(["INSERT", "SELECT", "UPDATE"]);
    }
  });

  it("enforces one active warehouse per location, tenant-matching FKs, code uniqueness and tenant isolation", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const tenantA = quotes.tenant;
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const tenantB = flowers.tenant;
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT (SELECT count(*) FROM qos.inventory_suppliers) + (SELECT count(*) FROM qos.inventory_warehouses) AS count`;
    expect(Number(count)).toBe(0);

    const insertWarehouse = (tenantId: string, publicId: string, locationId: string, code: string, status = "active") =>
      sql`INSERT INTO qos.inventory_warehouses (tenant_id, public_id, location_id, code, name_en, status, provenance)
          VALUES (${tenantId}, ${publicId}, ${locationId}, ${code}, 'Store', ${status}, 'operator_entered')`;

    await insertWarehouse(tenantA.id, "wh_a1", quotes.locationA.id, "A1");
    await expect(insertWarehouse(tenantA.id, "wh_a2", quotes.locationA.id, "A2")).rejects.toThrow(
      /inventory_warehouses_active_location_unique/,
    );
    // An archived warehouse keeps its location as history and does not block an active one.
    await insertWarehouse(tenantA.id, "wh_a0", quotes.locationA.id, "A0", "archived");
    await insertWarehouse(tenantA.id, "wh_b1", quotes.locationB.id, "B1");
    await expect(insertWarehouse(tenantA.id, "wh_b2", quotes.locationB.id, "b1", "archived")).rejects.toThrow(
      /inventory_warehouses_tenant_code_unique/,
    );
    // A warehouse cannot point at another tenant's location (composite FK).
    await expect(insertWarehouse(tenantB.id, "wh_x", quotes.locationA.id, "X1")).rejects.toThrow(
      /inventory_warehouses_location_fk/,
    );
    await expect(insertWarehouse(tenantA.id, "wh_bad", quotes.locationB.id, "-bad", "archived")).rejects.toThrow(
      /inventory_warehouses_code_check/,
    );

    const [supplierA] = await sql<{ id: string }[]>`
      INSERT INTO qos.inventory_suppliers (tenant_id, public_id, name_en, code, provenance)
      VALUES (${tenantA.id}, 'sup_gulf_1', 'Gulf Supply', 'GS-1', 'operator_entered') RETURNING id`;
    // Same name, no code: a separate supplier.
    await sql`INSERT INTO qos.inventory_suppliers (tenant_id, public_id, name_en, provenance)
              VALUES (${tenantA.id}, 'sup_gulf_2', 'Gulf Supply', 'operator_entered')`;
    await expect(sql`
      INSERT INTO qos.inventory_suppliers (tenant_id, public_id, name_en, code, provenance)
      VALUES (${tenantA.id}, 'sup_gulf_3', 'Gulf Supply', 'gs-1', 'operator_entered')`).rejects.toThrow(
      /inventory_suppliers_tenant_code_unique/,
    );
    // The same code in another tenant is fine.
    await sql`INSERT INTO qos.inventory_suppliers (tenant_id, public_id, name_en, code, provenance)
              VALUES (${tenantB.id}, 'sup_gulf_4', 'Gulf Supply', 'GS-1', 'operator_entered')`;
    const [itemB] = await sql<{ id: string }[]>`
      INSERT INTO qos.inventory_items (tenant_id, public_id, name_en, kind, provenance)
      VALUES (${tenantB.id}, 'item_flour_1', 'Flour', 'purchased', 'operator_entered') RETURNING id`;
    await expect(sql`UPDATE qos.inventory_items SET default_supplier_id = ${supplierA!.id} WHERE id = ${itemB!.id}`).rejects.toThrow(
      /inventory_items_default_supplier_fk/,
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
    await expect(
      asApp(tenantB.id, (tx) =>
        tx`INSERT INTO qos.inventory_suppliers (tenant_id, public_id, name_en, provenance)
           VALUES (${tenantA.id}, 'sup_sneak_1', 'Sneak', 'operator_entered')`,
      ),
    ).rejects.toThrow(/row-level security/);
    await expect(
      asApp(tenantB.id, (tx) =>
        tx`INSERT INTO qos.inventory_warehouses (tenant_id, public_id, location_id, code, name_en, provenance)
           VALUES (${tenantA.id}, 'wh_sneak', ${quotes.locationB.id}, 'SNEAK', 'Sneak', 'operator_entered')`,
      ),
    ).rejects.toThrow(/row-level security/);
    const renamedFromB = (await asApp(tenantB.id, (tx) =>
      tx`UPDATE qos.inventory_warehouses SET name_en = 'Taken' WHERE public_id = 'wh_a1' RETURNING id`,
    )) as unknown[];
    expect(renamedFromB).toHaveLength(0);
  });
});
