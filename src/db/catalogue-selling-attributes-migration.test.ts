import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { createModifierGroup, createModifierOption } from "@/lib/catalogue/modifiers";
import { createDraftProduct } from "@/lib/catalogue/products";
import { staffIdentities, staffMemberships } from "@/db/schema";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN = "admin.selling-attributes-migration@test";

type Journal = { entries: Array<{ idx: number; when: number; tag: string }> };

describe("catalogue selling attributes migration journal (0057)", () => {
  it("is journalled as idx 57 directly after 0056 and before 0058, with every idx and when strictly increasing", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === "0057_catalogue_selling_attributes");
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toMatchObject({ idx: 57, when: 1793000000000 });
    expect(journal.entries[position - 1]).toMatchObject({ idx: 56, when: 1792900000000, tag: "0056_sales_channel_prices" });
    expect(journal.entries[position + 1]).toMatchObject({ idx: 58, when: 1793100000000, tag: "0058_workbook_import_apply" });
    expect(journal.entries.filter((entry) => entry.idx === 57)).toHaveLength(1);
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
    const sql = readFileSync(path.join(process.cwd(), "drizzle/0057_catalogue_selling_attributes.sql"), "utf8");
    for (const statement of [
      '"catalogue_products" ADD COLUMN IF NOT EXISTS "preparation_time_minutes" integer',
      '"catalogue_products" ADD COLUMN IF NOT EXISTS "walking_time_minutes" integer',
      '"catalogue_products" ADD COLUMN IF NOT EXISTS "high_salt" boolean',
      '"catalogue_products" ADD COLUMN IF NOT EXISTS "direct_stock_intent" boolean',
      '"catalogue_variants" ADD COLUMN IF NOT EXISTS "selling_quantity_basis" text',
      '"catalogue_variants" ADD COLUMN IF NOT EXISTS "price_unit" text',
      '"catalogue_variants" ADD COLUMN IF NOT EXISTS "price_unit_quantity" numeric',
      '"catalogue_modifier_options" ADD COLUMN IF NOT EXISTS "nutrition_calories" integer',
    ]) {
      expect(sql, statement).toContain(statement);
    }
  });
});

integrationDescribe("catalogue selling attributes migration (0057)", () => {
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

  it("adds nullable typed columns with check constraints, and records the journal row", async () => {
    const columns = await sql<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]>`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'qos'
        AND (table_name, column_name) IN (
          ('catalogue_products', 'preparation_time_minutes'),
          ('catalogue_products', 'walking_time_minutes'),
          ('catalogue_products', 'high_salt'),
          ('catalogue_products', 'direct_stock_intent'),
          ('catalogue_variants', 'selling_quantity_basis'),
          ('catalogue_variants', 'price_unit'),
          ('catalogue_variants', 'price_unit_quantity'),
          ('catalogue_modifier_options', 'nutrition_calories')
        )
      ORDER BY table_name, column_name`;
    expect(columns.map((row) => ({ ...row }))).toEqual([
      { table_name: "catalogue_modifier_options", column_name: "nutrition_calories", data_type: "integer", is_nullable: "YES", column_default: null },
      { table_name: "catalogue_products", column_name: "direct_stock_intent", data_type: "boolean", is_nullable: "YES", column_default: null },
      { table_name: "catalogue_products", column_name: "high_salt", data_type: "boolean", is_nullable: "YES", column_default: null },
      { table_name: "catalogue_products", column_name: "preparation_time_minutes", data_type: "integer", is_nullable: "YES", column_default: null },
      { table_name: "catalogue_products", column_name: "walking_time_minutes", data_type: "integer", is_nullable: "YES", column_default: null },
      { table_name: "catalogue_variants", column_name: "price_unit", data_type: "text", is_nullable: "YES", column_default: null },
      { table_name: "catalogue_variants", column_name: "price_unit_quantity", data_type: "numeric", is_nullable: "YES", column_default: null },
      { table_name: "catalogue_variants", column_name: "selling_quantity_basis", data_type: "text", is_nullable: "YES", column_default: null },
    ]);

    const checks = await sql<{ conname: string }[]>`
      SELECT c.conname
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
      WHERE n.nspname = 'qos' AND c.contype = 'c' AND c.conname IN (
        'catalogue_products_preparation_time_minutes_check',
        'catalogue_products_walking_time_minutes_check',
        'catalogue_variants_selling_quantity_basis_check',
        'catalogue_variants_price_unit_check',
        'catalogue_variants_price_unit_quantity_check',
        'catalogue_modifier_options_nutrition_calories_check'
      )
      ORDER BY c.conname`;
    expect(checks.map((row) => row.conname)).toHaveLength(6);

    const [rls] = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = 'qos.catalogue_variants'::regclass`;
    expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });

    const [journal] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations WHERE created_at = 1793000000000`;
    expect(journal?.count).toBe(1);
  });

  it("leaves rows created by the existing services with every new column NULL", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: ADMIN, email: ADMIN }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role: "administrator" })
      .returning();
    const admin = { membershipId: membership.id, role: "administrator" as const, staffIdentityId: identity.id };

    await createDraftProduct(db, tenantId, admin, {
      internalName: "legacy-latte",
      translations: { en: { displayName: "Latte" }, ar: { displayName: "لاتيه" } },
      defaultVariant: { amountMinor: 1800 },
    });
    const group = await createModifierGroup(db, tenantId, {
      internalName: "milk",
      translations: { en: { displayName: "Milk" }, ar: { displayName: "الحليب" } },
    }, ADMIN, admin);
    await createModifierOption(db, tenantId, group.publicId, {
      expectedGroupVersion: group.version,
      translations: { en: { displayName: "Oat" }, ar: { displayName: "شوفان" } },
    }, ADMIN, admin);

    const products = await sql`SELECT preparation_time_minutes, walking_time_minutes, high_salt, direct_stock_intent FROM qos.catalogue_products`;
    expect(products.map((row) => ({ ...row }))).toEqual([
      { preparation_time_minutes: null, walking_time_minutes: null, high_salt: null, direct_stock_intent: null },
    ]);
    const variants = await sql`SELECT selling_quantity_basis, price_unit, price_unit_quantity FROM qos.catalogue_variants`;
    expect(variants.map((row) => ({ ...row }))).toEqual([
      { selling_quantity_basis: null, price_unit: null, price_unit_quantity: null },
    ]);
    const options = await sql`SELECT nutrition_calories FROM qos.catalogue_modifier_options`;
    expect(options.map((row) => ({ ...row }))).toEqual([{ nutrition_calories: null }]);
  });

  it("rejects negative minutes, unknown units and non-positive quantities at the database", async () => {
    await expect(sql`UPDATE qos.catalogue_products SET preparation_time_minutes = -1`).rejects.toThrow(/preparation_time_minutes_check/);
    await expect(sql`UPDATE qos.catalogue_products SET walking_time_minutes = -1`).rejects.toThrow(/walking_time_minutes_check/);
    await expect(sql`UPDATE qos.catalogue_variants SET price_unit = 'lb'`).rejects.toThrow(/price_unit_check/);
    await expect(sql`UPDATE qos.catalogue_variants SET selling_quantity_basis = 'litre'`).rejects.toThrow(/selling_quantity_basis_check/);
    await expect(sql`UPDATE qos.catalogue_variants SET price_unit_quantity = 0`).rejects.toThrow(/price_unit_quantity_check/);
    await expect(sql`UPDATE qos.catalogue_modifier_options SET nutrition_calories = -1`).rejects.toThrow(/nutrition_calories_check/);
    await sql`UPDATE qos.catalogue_products SET preparation_time_minutes = 0`;
    const [row] = await sql`SELECT preparation_time_minutes FROM qos.catalogue_products`;
    expect(row?.preparation_time_minutes).toBe(0);
  });
});
