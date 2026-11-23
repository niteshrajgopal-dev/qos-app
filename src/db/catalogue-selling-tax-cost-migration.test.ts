import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { createModifierGroup, createModifierOption } from "@/lib/catalogue/modifiers";
import { createDraftProduct } from "@/lib/catalogue/products";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

/* Constraint and index names use a short prefix: Postgres truncates
   identifiers longer than 63 characters, and the full table names leave too
   little room. The option table's policy name is shortened for the same reason. */
const POLICY_TABLES = [
  {
    table: "catalogue_variant_reference_cost_policies",
    owner: "variant_id",
    prefix: "catalogue_variant_ref_cost",
    policy: "catalogue_variant_reference_cost_policies_tenant_isolation",
  },
  {
    table: "catalogue_modifier_option_reference_cost_policies",
    owner: "modifier_option_id",
    prefix: "catalogue_option_ref_cost",
    policy: "catalogue_modifier_option_ref_cost_policies_tenant_isolation",
  },
] as const;


type Journal = { entries: Array<{ idx: number; when: number; tag: string }> };

describe("catalogue selling tax and reference cost migration journal (0059)", () => {
  it("is journalled as idx 59 directly after 0058, with every idx and when strictly increasing", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === "0059_catalogue_selling_tax_and_reference_costs");
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toMatchObject({ idx: 59, when: 1793200000000 });
    expect(journal.entries[position - 1]).toMatchObject({
      idx: 58,
      when: 1793100000000,
      tag: "0058_workbook_import_apply",
    });
    expect(journal.entries.filter((entry) => entry.idx === 59)).toHaveLength(1);
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
    const sql = readFileSync(
      path.join(process.cwd(), "drizzle/0059_catalogue_selling_tax_and_reference_costs.sql"),
      "utf8",
    );
    expect(sql).toContain("price_tax_basis");
    expect(sql).toContain("tax_rate_basis_points");
    expect(sql).toContain("catalogue_variant_reference_cost_policies");
    expect(sql).toContain("catalogue_modifier_option_reference_cost_policies");
  });
});

integrationDescribe("catalogue selling tax and reference cost migration (0059)", () => {
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

  it("records 0059 in the journal after 0058", async () => {
    const rows = await sql<{ created_at: string }[]>`
      SELECT created_at::text FROM drizzle.__drizzle_migrations
      WHERE created_at <= 1793200000000 ORDER BY created_at DESC LIMIT 2`;
    expect(rows.map((row) => row.created_at)).toEqual(["1793200000000", "1793100000000"]);
  });

  it("adds three nullable tax columns to catalogue_variants with checks", async () => {
    const columns = await sql<{ column_name: string; data_type: string; udt_name: string; is_nullable: string; column_default: string | null }[]>`
      SELECT column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'qos' AND table_name = 'catalogue_variants'
        AND column_name IN ('price_tax_basis', 'tax_rate_basis_points', 'tax_provenance')
      ORDER BY column_name`;
    expect(columns).toEqual([
      { column_name: "price_tax_basis", data_type: "text", udt_name: "text", is_nullable: "YES", column_default: null },
      { column_name: "tax_provenance", data_type: "USER-DEFINED", udt_name: "data_provenance", is_nullable: "YES", column_default: null },
      { column_name: "tax_rate_basis_points", data_type: "integer", udt_name: "int4", is_nullable: "YES", column_default: null },
    ]);

    const checks = await sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE conrelid = 'qos.catalogue_variants'::regclass AND contype = 'c'
      ORDER BY conname`;
    expect(checks.map((row) => row.conname)).toEqual(
      expect.arrayContaining(["catalogue_variants_price_tax_basis_check", "catalogue_variants_tax_rate_basis_points_check"]),
    );
  });

  it("creates both append-only policy tables with checks, FKs, indexes, RLS and narrow grants", async () => {
    for (const { table, owner, prefix, policy: policyName } of POLICY_TABLES) {
      const columns = await sql<{ column_name: string; data_type: string; is_nullable: string }[]>`
        SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_schema = 'qos' AND table_name = ${table} ORDER BY ordinal_position`;
      expect(Object.fromEntries(columns.map((column) => [column.column_name, `${column.data_type}:${column.is_nullable}`]))).toEqual({
        id: "uuid:NO",
        tenant_id: "uuid:NO",
        public_id: "text:NO",
        [owner]: "uuid:NO",
        method: "text:NO",
        amount_micros: "bigint:YES",
        currency: "character:YES",
        unit: "text:YES",
        tax_basis: "text:YES",
        effective_from: "date:YES",
        effective_to: "date:YES",
        source: "text:YES",
        source_reference: "text:YES",
        revision: "integer:NO",
        provenance: "USER-DEFINED:YES",
        created_at: "timestamp with time zone:NO",
        created_by_subject: "text:YES",
      });

      const constraints = await sql<{ conname: string; contype: string }[]>`
        SELECT conname, contype FROM pg_constraint WHERE conrelid = ${`qos.${table}`}::regclass ORDER BY conname`;
      const names = constraints.map((row) => row.conname);
      for (const suffix of [
        "method_check",
        "amount_check",
        "method_amount_check",
        "currency_check",
        "unit_check",
        "tax_basis_check",
        "dates_check",
        "revision_check",
        "tenant_public_id_unique",
        "revision_unique",
      ]) {
        expect(names, `${table} ${suffix}`).toContain(`${prefix}_${suffix}`);
      }
      expect(constraints.filter((row) => row.contype === "f")).toHaveLength(1);

      const [currentIndex] = await sql<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE schemaname = 'qos' AND indexname = ${`${prefix}_current_unique`}`;
      expect(currentIndex?.indexdef).toContain("UNIQUE INDEX");
      expect(currentIndex?.indexdef).toContain(`(tenant_id, ${owner})`);
      expect(currentIndex?.indexdef).toContain("WHERE (effective_to IS NULL)");

      const [rls] = await sql<{ relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
        SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ${`qos.${table}`}::regclass`;
      expect(rls).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
      const [policy] = await sql<{ policyname: string }[]>`
        SELECT policyname FROM pg_policies WHERE schemaname = 'qos' AND tablename = ${table}`;
      expect(policy?.policyname).toBe(policyName);

      const tableGrants = await sql<{ privilege_type: string }[]>`
        SELECT privilege_type FROM information_schema.role_table_grants
        WHERE table_schema = 'qos' AND table_name = ${table} AND grantee = 'qos_app' ORDER BY privilege_type`;
      expect(tableGrants.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT"]);
      const columnUpdates = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.column_privileges
        WHERE table_schema = 'qos' AND table_name = ${table} AND grantee = 'qos_app' AND privilege_type = 'UPDATE'`;
      expect(columnUpdates.map((row) => row.column_name)).toEqual(["effective_to"]);
    }
  });

  it("keeps seeded variants untaxed and policy-free, enforces the checks and isolates tenants", async () => {
    const tenantA = (await createTenantHierarchy(db, quotesTenantFixture())).tenant;
    const tenantB = (await createTenantHierarchy(db, flowerTenantFixture())).tenant;
    const admin = { membershipId: "seed", role: "administrator" as const, staffIdentityId: "seed" };
    const product = await createDraftProduct(db, tenantA.id, admin, {
      internalName: "qos215-latte",
      translations: {
        en: { displayName: "Latte", description: null },
        ar: { displayName: "لاتيه", description: null },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const group = await createModifierGroup(
      db,
      tenantA.id,
      {
        internalName: "milk",
        translations: { en: { displayName: "Milk" }, ar: { displayName: "حليب" } },
      },
      "seed",
      admin,
    );
    const withOption = await createModifierOption(
      db,
      tenantA.id,
      group.publicId,
      {
        expectedGroupVersion: group.version,
        priceMinor: 300,
        translations: { en: { displayName: "Oat" }, ar: { displayName: "شوفان" } },
      },
      "seed",
      admin,
    );
    expect(product.defaultVariant).toMatchObject({ priceTaxBasis: null, taxRateBasisPoints: null, taxProvenance: null });
    expect(product.defaultVariant.referenceCost).toEqual({ policy: null, resolution: { status: "unavailable", reason: "no_policy" } });
    expect(withOption.options[0]?.referenceCost.policy).toBeNull();

    const [variant] = await sql<{ id: string; price_tax_basis: string | null; tax_rate_basis_points: number | null; tax_provenance: string | null }[]>`
      SELECT id, price_tax_basis, tax_rate_basis_points, tax_provenance FROM qos.catalogue_variants
      WHERE public_id = ${product.defaultVariant.publicId}`;
    expect(variant).toMatchObject({ price_tax_basis: null, tax_rate_basis_points: null, tax_provenance: null });
    const [{ options }] = await sql<{ options: number }[]>`
      SELECT count(*)::int AS options FROM qos.catalogue_modifier_option_reference_cost_policies`;
    expect(options).toBe(0);
    const [{ count }] = await sql<{ count: number }[]>`
      SELECT count(*)::int AS count FROM qos.catalogue_variant_reference_cost_policies WHERE variant_id = ${variant!.id}`;
    expect(count).toBe(0);

    await expect(sql`UPDATE qos.catalogue_variants SET price_tax_basis = 'GROSS' WHERE id = ${variant!.id}`).rejects.toThrow(
      /price_tax_basis_check/,
    );
    await expect(sql`UPDATE qos.catalogue_variants SET tax_rate_basis_points = -1 WHERE id = ${variant!.id}`).rejects.toThrow(
      /tax_rate_basis_points_check/,
    );
    await sql`UPDATE qos.catalogue_variants SET tax_rate_basis_points = 0 WHERE id = ${variant!.id}`;
    const [zero] = await sql<{ tax_rate_basis_points: number | null }[]>`
      SELECT tax_rate_basis_points FROM qos.catalogue_variants WHERE id = ${variant!.id}`;
    expect(zero?.tax_rate_basis_points).toBe(0);

    // recipe_derived never stores an amount; manual needs amount, currency and date.
    await expect(sql`
      INSERT INTO qos.catalogue_variant_reference_cost_policies (tenant_id, public_id, variant_id, method, amount_micros, revision)
      VALUES (${tenantA.id}, 'vrc_bad', ${variant!.id}, 'recipe_derived', 1, 1)`).rejects.toThrow(/method_amount_check/);
    await expect(sql`
      INSERT INTO qos.catalogue_variant_reference_cost_policies (tenant_id, public_id, variant_id, method, amount_micros, currency, revision)
      VALUES (${tenantA.id}, 'vrc_bad', ${variant!.id}, 'manual', 0, 'AED', 1)`).rejects.toThrow(/method_amount_check/);

    await sql`
      INSERT INTO qos.catalogue_variant_reference_cost_policies
        (tenant_id, public_id, variant_id, method, amount_micros, currency, effective_from, revision)
      VALUES (${tenantA.id}, 'vrc_one', ${variant!.id}, 'manual', 0, 'AED', '2026-11-01', 1)`;
    await expect(sql`
      INSERT INTO qos.catalogue_variant_reference_cost_policies (tenant_id, public_id, variant_id, method, revision)
      VALUES (${tenantA.id}, 'vrc_two', ${variant!.id}, 'recipe_derived', 2)`).rejects.toThrow(/catalogue_variant_ref_cost_current_unique/);

    // The app role can only close a row; amounts are not rewritable, and RLS hides other tenants.
    await sql.begin(async (tx) => {
      await tx.unsafe("SET LOCAL ROLE qos_app");
      await tx`SELECT set_config('qos.current_tenant_id', ${tenantB.id}, true)`;
      const hidden = await tx`SELECT id FROM qos.catalogue_variant_reference_cost_policies`;
      expect(hidden).toHaveLength(0);
    });
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE qos_app");
        await tx`SELECT set_config('qos.current_tenant_id', ${tenantA.id}, true)`;
        await tx`UPDATE qos.catalogue_variant_reference_cost_policies SET amount_micros = 5 WHERE public_id = 'vrc_one'`;
      }),
    ).rejects.toThrow(/permission denied/);
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE qos_app");
        await tx`SELECT set_config('qos.current_tenant_id', ${tenantA.id}, true)`;
        await tx`DELETE FROM qos.catalogue_variant_reference_cost_policies WHERE public_id = 'vrc_one'`;
      }),
    ).rejects.toThrow(/permission denied/);
    await runAsRole(sql, "qos", async () => {
      const [row] = await sql<{ amount_micros: string }[]>`
        SELECT amount_micros::text FROM qos.catalogue_variant_reference_cost_policies WHERE public_id = 'vrc_one'`;
      expect(row?.amount_micros).toBe("0");
    });
  });
});
