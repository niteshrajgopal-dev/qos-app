import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

type Journal = { entries: Array<{ idx: number; when: number; tag: string }> };

const NEW_TABLES = [
  "sales_channels",
  "catalogue_variant_channel_prices",
  "catalogue_modifier_option_channel_prices",
  "catalogue_variant_channel_price_reset_audits",
  "catalogue_option_channel_price_reset_audits",
];

describe("sales channel prices migration journal (0056)", () => {
  it("records 0056 after 0055 and before 0057 (QOS-214), which precedes 0058", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === "0056_sales_channel_prices");
    expect(journal.entries[position]).toMatchObject({ idx: 56, when: 1792900000000 });
    expect(journal.entries[position - 1]).toMatchObject({ idx: 55, tag: "0055_workbook_import_plans" });
    expect(journal.entries[position + 1]).toMatchObject({ idx: 57, when: 1793000000000, tag: "0057_catalogue_selling_attributes" });
    expect(journal.entries[position + 2]).toMatchObject({ idx: 58, when: 1793100000000, tag: "0058_workbook_import_apply" });
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
  });
});

integrationDescribe("sales channel prices migration (0056)", () => {
  let sql: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    sql = connection.sql;
    await grantRoleMembership(sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  it("records 0056 in the migration journal", async () => {
    const rows = await sql`SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations WHERE created_at = 1792900000000`;
    expect(rows[0]?.count).toBe(1);
  });

  it("creates the five tables with RLS enabled and forced and a tenant isolation policy", async () => {
    const rows = await sql<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'qos' AND c.relname = ANY(${NEW_TABLES})
      ORDER BY c.relname`;
    expect(rows.map((row) => row.relname).sort()).toEqual([...NEW_TABLES].sort());
    for (const row of rows) {
      expect(row.relrowsecurity, row.relname).toBe(true);
      expect(row.relforcerowsecurity, row.relname).toBe(true);
    }

    const policies = await sql<{ tablename: string; policyname: string; qual: string; with_check: string; roles: string[] }[]>`
      SELECT tablename, policyname, qual, with_check, roles::text[] AS roles FROM pg_policies
      WHERE schemaname = 'qos' AND tablename = ANY(${NEW_TABLES})`;
    expect(policies).toHaveLength(NEW_TABLES.length);
    for (const policy of policies) {
      expect(policy.policyname).toBe(`${policy.tablename}_tenant_isolation`);
      expect(policy.qual).toContain("qos.current_tenant_id");
      expect(policy.with_check).toContain("qos.current_tenant_id");
      expect(policy.roles).toEqual(["qos_app"]);
    }
  });

  it("grants qos_app select, insert, update and delete on every new table", async () => {
    for (const table of NEW_TABLES) {
      const [row] = await sql`
        SELECT
          has_table_privilege('qos_app', ${`qos.${table}`}, 'SELECT') AS s,
          has_table_privilege('qos_app', ${`qos.${table}`}, 'INSERT') AS i,
          has_table_privilege('qos_app', ${`qos.${table}`}, 'UPDATE') AS u,
          has_table_privilege('qos_app', ${`qos.${table}`}, 'DELETE') AS d`;
      expect(row, table).toEqual({ s: true, i: true, u: true, d: true });
    }
  });

  it("declares the channel identity, price and audit columns", async () => {
    const columns = await sql<{ table_name: string; column_name: string; data_type: string; is_nullable: string; column_default: string | null }[]>`
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'qos' AND table_name = ANY(${NEW_TABLES})`;
    const of = (table: string) =>
      Object.fromEntries(columns.filter((column) => column.table_name === table).map((column) => [column.column_name, column]));

    const channels = of("sales_channels");
    expect(Object.keys(channels).sort()).toEqual(
      ["code", "created_at", "display_name", "id", "kind", "public_id", "status", "tenant_id", "updated_at", "version", "workbook_slot"],
    );
    expect(channels.workbook_slot?.is_nullable).toBe("YES");
    expect(channels.kind?.column_default).toContain("aggregator");
    expect(channels.status?.column_default).toContain("active");

    const variantPrices = of("catalogue_variant_channel_prices");
    expect(Object.keys(variantPrices).sort()).toEqual([
      "amount_minor",
      "central_price_version_at_override",
      "channel_id",
      "created_at",
      "created_by_subject",
      "currency",
      "id",
      "tenant_id",
      "updated_at",
      "updated_by_subject",
      "variant_id",
      "version",
    ]);
    expect(variantPrices.amount_minor?.data_type).toBe("integer");
    expect(variantPrices.currency?.data_type).toBe("character");

    const optionPrices = of("catalogue_modifier_option_channel_prices");
    expect(optionPrices.central_price_version_at_override).toBeUndefined();
    expect(optionPrices.modifier_option_id?.is_nullable).toBe("NO");

    expect(Object.keys(of("catalogue_variant_channel_price_reset_audits")).sort()).toEqual([
      "channel_id",
      "currency",
      "id",
      "previous_amount_minor",
      "reset_at",
      "reset_by_subject",
      "tenant_id",
      "variant_id",
    ]);
    expect(of("catalogue_option_channel_price_reset_audits").modifier_option_id).toBeDefined();
  });

  it("enforces composite tenant foreign keys, uniqueness and check constraints", async () => {
    const constraints = await sql<{ conname: string; contype: string; def: string }[]>`
      SELECT con.conname, con.contype, pg_get_constraintdef(con.oid) AS def
      FROM pg_constraint con
      JOIN pg_class c ON c.oid = con.conrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'qos' AND c.relname = ANY(${NEW_TABLES})`;
    // pg_get_constraintdef omits the schema when qos is on the search path.
    const byName = new Map(constraints.map((row) => [row.conname, row.def.replaceAll("REFERENCES qos.", "REFERENCES ")]));

    expect(byName.get("catalogue_variant_channel_prices_variant_fk")).toBe(
      "FOREIGN KEY (tenant_id, variant_id) REFERENCES catalogue_variants(tenant_id, id) ON DELETE RESTRICT",
    );
    expect(byName.get("catalogue_variant_channel_prices_channel_fk")).toBe(
      "FOREIGN KEY (tenant_id, channel_id) REFERENCES sales_channels(tenant_id, id) ON DELETE RESTRICT",
    );
    expect(byName.get("catalogue_modifier_option_channel_prices_option_fk")).toBe(
      "FOREIGN KEY (tenant_id, modifier_option_id) REFERENCES catalogue_modifier_options(tenant_id, id) ON DELETE RESTRICT",
    );
    expect(byName.get("catalogue_variant_channel_prices_unique")).toBe(
      "UNIQUE (tenant_id, variant_id, channel_id, currency)",
    );
    expect(byName.get("catalogue_modifier_option_channel_prices_unique")).toBe(
      "UNIQUE (tenant_id, modifier_option_id, channel_id, currency)",
    );
    expect(byName.get("sales_channels_tenant_code_unique")).toBe("UNIQUE (tenant_id, code)");
    expect(byName.get("sales_channels_tenant_id_id_unique")).toBe("UNIQUE (tenant_id, id)");
    expect(byName.get("sales_channels_tenant_public_id_unique")).toBe("UNIQUE (tenant_id, public_id)");
    expect(byName.get("catalogue_variant_channel_prices_amount_check")).toBe("CHECK ((amount_minor >= 0))");
    expect(byName.get("sales_channels_kind_check")).toContain("aggregator");
    expect(byName.get("sales_channels_workbook_slot_check")).toContain("aggregator_3");

    const [slotIndex] = await sql<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE schemaname = 'qos' AND indexname = 'sales_channels_tenant_workbook_slot_unique'`;
    expect(slotIndex?.indexdef).toContain("UNIQUE INDEX");
    expect(slotIndex?.indexdef).toContain("WHERE (workbook_slot IS NOT NULL)");

    // Channels never point at locations: no new table references qos.locations.
    expect(constraints.filter((row) => /REFERENCES (qos\.)?locations\(/.test(row.def))).toEqual([]);
  });

  it("seeds no channel for a fresh tenant and enforces slot, kind and uniqueness rules", async () => {
    const [tenant] = await sql<{ id: string }[]>`
      INSERT INTO qos.tenants (public_id, name, business_profile, base_currency, default_locale, default_timezone, supported_locales)
      VALUES ('tnt_qos213_shape', 'Shape test', 'hospitality', 'AED', 'en', 'Asia/Dubai', ARRAY['en', 'ar'])
      RETURNING id`;
    const [count] = await sql`SELECT count(*)::int AS count FROM qos.sales_channels`;
    expect(count?.count).toBe(0);

    const [channel] = await sql<{ id: string }[]>`
      INSERT INTO qos.sales_channels (tenant_id, public_id, code, display_name, workbook_slot)
      VALUES (${tenant!.id}, 'schan_aggregator-1_abcd1234', 'aggregator_1', 'Aggregator 1', 'aggregator_1')
      RETURNING id`;
    expect(channel?.id).toBeTruthy();

    await expect(sql`
      INSERT INTO qos.sales_channels (tenant_id, public_id, code, display_name, workbook_slot)
      VALUES (${tenant!.id}, 'schan_other_abcd1234', 'other', 'Other', 'aggregator_1')`).rejects.toMatchObject({ code: "23505" });
    await expect(sql`
      INSERT INTO qos.sales_channels (tenant_id, public_id, code, display_name, workbook_slot)
      VALUES (${tenant!.id}, 'schan_x_abcd1234', 'x', 'X', 'aggregator_4')`).rejects.toMatchObject({ code: "23514" });
    await expect(sql`
      INSERT INTO qos.sales_channels (tenant_id, public_id, code, display_name, kind)
      VALUES (${tenant!.id}, 'schan_y_abcd1234', 'y', 'Y', 'branch')`).rejects.toMatchObject({ code: "23514" });
    // Two channels without a slot are fine (partial unique index).
    await sql`INSERT INTO qos.sales_channels (tenant_id, public_id, code, display_name) VALUES (${tenant!.id}, 'schan_a_abcd1234', 'a', 'A')`;
    await sql`INSERT INTO qos.sales_channels (tenant_id, public_id, code, display_name) VALUES (${tenant!.id}, 'schan_b_abcd1234', 'b', 'B')`;
  });
});
