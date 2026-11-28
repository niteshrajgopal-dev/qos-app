import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const TAG = "0065_workbook_source_links_phase2";

type Journal = { entries: Array<{ idx: number; version: string; when: number; tag: string; breakpoints: boolean }> };

/* The earlier Phase 2 migrations are applied on dev already; 0065 must not change a byte of them. */
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
  "0064_recipe_modifier_effects.sql": "65deef08fc6f571ea8cf5edf9eec3c8fb86690376c9b3f7a8bc6448d97be4d65",
};

const OLD_ENTITIES = ["category", "product", "variant", "modifier_group", "modifier_option", "menu", "menu_section"];
const NEW_ENTITIES = [
  "unit",
  "supplier",
  "warehouse",
  "inventory_category",
  "inventory_item",
  "recipe",
  "recipe_version",
  "recipe_line",
  "prep_step",
  "modifier_effect",
];

describe("workbook source links Phase 2 migration journal (0065)", () => {
  it("is journalled as idx 65 directly after 0064, with every idx and when strictly increasing", () => {
    const journal = JSON.parse(readFileSync(path.join(process.cwd(), "drizzle/meta/_journal.json"), "utf8")) as Journal;
    const position = journal.entries.findIndex((entry) => entry.tag === TAG);
    expect(position).toBeGreaterThan(0);
    expect(journal.entries[position]).toEqual({ idx: 65, version: "7", when: 1793800000000, tag: TAG, breakpoints: true });
    expect(journal.entries[position - 1]).toEqual({ idx: 64, version: "7", when: 1793700000000, tag: "0064_recipe_modifier_effects", breakpoints: true });
    expect(journal.entries.filter((entry) => entry.idx === 65)).toHaveLength(1);
    for (let index = 1; index < journal.entries.length; index += 1) {
      expect(journal.entries[index]!.idx).toBeGreaterThan(journal.entries[index - 1]!.idx);
      expect(journal.entries[index]!.when).toBeGreaterThan(journal.entries[index - 1]!.when);
    }
  });

  it("leaves 0054 to 0064 byte-identical", () => {
    for (const [file, hash] of Object.entries(APPLIED_HASHES)) {
      const actual = createHash("sha256").update(readFileSync(path.join(process.cwd(), "drizzle", file))).digest("hex");
      expect(actual, file).toBe(hash);
    }
  });

  it("only widens the entity CHECK: no table, grant, policy or data change, a manual header and a down script", () => {
    const sql = readFileSync(path.join(process.cwd(), `drizzle/${TAG}.sql`), "utf8");
    expect(sql.startsWith("-- MANUAL (Nitesh):")).toBe(true);
    const statements = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n")
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toBe('ALTER TABLE "qos"."workbook_source_links" DROP CONSTRAINT IF EXISTS "workbook_source_links_entity_check";');
    expect(statements[1]).toMatch(/^ALTER TABLE "qos"\."workbook_source_links" ADD CONSTRAINT "workbook_source_links_entity_check" CHECK \("entity_type" IN \(/);
    const listed = [...statements[1]!.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]);
    expect(listed).toEqual([...OLD_ENTITIES, ...NEW_ENTITIES]);
    const body = statements.join("\n");
    expect(body).not.toMatch(/\b(GRANT|REVOKE|POLICY|CREATE TABLE|INSERT|DELETE|UPDATE)\b/);
    expect(body).not.toMatch(/stock|ledger|production/i);
    expect(sql).toContain("-- Down script (documentation only; not executed).");
    expect(sql).toContain(`--   ALTER TABLE "qos"."workbook_source_links" ADD CONSTRAINT "workbook_source_links_entity_check" CHECK ("entity_type" IN ('category','product','variant','modifier_group','modifier_option','menu','menu_section'));`);
  });

  it("matches the schema CHECK text", () => {
    const schema = readFileSync(path.join(process.cwd(), "src/db/schema.ts"), "utf8");
    const values = [...OLD_ENTITIES, ...NEW_ENTITIES].map((entity) => `'${entity}'`).join(",");
    expect(schema).toContain(`sql\`\${table.entityType} IN (${values})\``);
  });
});

integrationDescribe("workbook source links Phase 2 migration (0065)", () => {
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

  it("records 0065 in the journal after 0064", async () => {
    const rows = await sql<{ created_at: string }[]>`
      SELECT created_at::text FROM drizzle.__drizzle_migrations WHERE created_at <= 1793800000000 ORDER BY created_at DESC LIMIT 2`;
    expect(rows.map((row) => row.created_at)).toEqual(["1793800000000", "1793700000000"]);
  });

  it("accepts every Phase 2 entity type, refuses unknown ones and keeps tenant isolation", async () => {
    const tenantA = (await createTenantHierarchy(db, quotesTenantFixture())).tenant;
    const tenantB = (await createTenantHierarchy(db, flowerTenantFixture())).tenant;
    for (const entity of [...OLD_ENTITIES, ...NEW_ENTITIES]) {
      await sql`
        INSERT INTO qos.workbook_source_links (tenant_id, source_namespace, entity_type, source_key, target_public_id, created_by_subject)
        VALUES (${tenantA.id}, 'qos:a', ${entity}, ${`key-${entity}`}, ${`target-${entity}`}, 'alice')`;
    }
    await sql`
      INSERT INTO qos.workbook_source_links (tenant_id, source_namespace, entity_type, source_key, target_public_id, created_by_subject)
      VALUES (${tenantB.id}, 'qos:b', 'recipe_version', 'key-b', 'recv_b', 'bob')`;
    await expect(
      sql`
        INSERT INTO qos.workbook_source_links (tenant_id, source_namespace, entity_type, source_key, target_public_id, created_by_subject)
        VALUES (${tenantA.id}, 'qos:a', 'bogus', 'key-bogus', 'x', 'alice')`,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql`
        INSERT INTO qos.workbook_source_links (tenant_id, source_namespace, entity_type, source_key, target_public_id, created_by_subject)
        VALUES (${tenantA.id}, 'qos:a', 'opening_stock', 'key-stock', 'x', 'alice')`,
    ).rejects.toMatchObject({ code: "23514" });

    await runAsRole(sql, "qos_app", async () => {
      const visible = await sql.begin(async (tx) => {
        await tx`SELECT set_config('qos.current_tenant_id', ${tenantB.id}, true)`;
        return tx`SELECT entity_type, source_key FROM qos.workbook_source_links ORDER BY source_key`;
      });
      expect(visible.map((row) => `${row.entity_type}:${row.source_key}`)).toEqual(["recipe_version:key-b"]);
      await expect(
        sql.begin(async (tx) => {
          await tx`SELECT set_config('qos.current_tenant_id', ${tenantB.id}, true)`;
          await tx`
            INSERT INTO qos.workbook_source_links (tenant_id, source_namespace, entity_type, source_key, target_public_id, created_by_subject)
            VALUES (${tenantA.id}, 'qos:a', 'unit', 'key-cross', 'unit_x', 'bob')`;
        }),
      ).rejects.toThrow();
    });
  });
});
