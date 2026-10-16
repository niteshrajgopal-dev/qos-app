/**
 * Apply migration 0048 with per-statement logging and journal recording.
 * Use qosadmin (DATABASE_ADMIN_URL or DATABASE_URL). qos_app cannot GRANT
 * qos_ai_worker table privileges.
 *
 *   npx tsx scripts/apply-0048-ai-worker-menu-facts-read.ts
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

const MIGRATION_TAG = "0048_ai_worker_menu_facts_read";
const MIGRATION_WHEN = 1792100000000;
const WORKER_TABLES = [
  "catalogue_menu_translations",
  "catalogue_menu_sections",
  "catalogue_menu_section_translations",
  "catalogue_menu_section_products",
  "catalogue_menu_live_revisions",
  "catalogue_product_translations",
  "catalogue_product_categories",
  "catalogue_variants",
  "catalogue_variant_prices",
  "catalogue_product_modifier_groups",
  "catalogue_modifier_groups",
  "catalogue_modifier_options",
  "catalogue_media_derivatives",
  "location_weekly_schedule_windows",
  "location_schedule_exceptions",
  "location_item_stop_sales",
] as const;

async function main() {
  if (typeof process.loadEnvFile === "function") {
    process.loadEnvFile(".env");
  }

  const databaseUrl = process.env.DATABASE_ADMIN_URL || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DATABASE_ADMIN_URL or DATABASE_URL is required (use qosadmin, not qos_app).",
    );
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: databaseUrl.includes("localhost")
      ? false
      : { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });

  try {
    const migrationPath = path.join(process.cwd(), `drizzle/${MIGRATION_TAG}.sql`);
    const migration = readFileSync(migrationPath, "utf8");
    const hash = createHash("sha256").update(migration).digest("hex");
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    const [who] = await sql<{ user: string; db: string }[]>`
      SELECT current_user AS user, current_database() AS db
    `;
    if (who?.user === "qos_app") {
      throw new Error("Refusing to run as qos_app; use qosadmin.");
    }

    const grantsBefore = await sql<{ table_name: string; privileges: string }[]>`
      SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE grantee = 'qos_ai_worker'
        AND table_schema = 'qos'
        AND table_name IN ${sql(WORKER_TABLES)}
      GROUP BY table_name
      ORDER BY table_name
    `;

    console.log(
      JSON.stringify({
        step: "precheck",
        user: who?.user,
        db: who?.db,
        hash,
        grantsBefore: Object.fromEntries(
          grantsBefore.map((row) => [row.table_name, row.privileges]),
        ),
      }),
    );

    for (const [index, statement] of statements.entries()) {
      const label = statement.split("\n")[0]?.slice(0, 80) ?? statement;
      await sql.unsafe(statement);
      console.log(`OK [${index + 1}/${statements.length}]: ${label}`);
    }

    const [recorded] = await sql<{ present: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM drizzle.__drizzle_migrations WHERE hash = ${hash}
      ) AS present
    `;
    if (!recorded?.present) {
      await sql`
        INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
        VALUES (${hash}, ${MIGRATION_WHEN})
      `;
    }

    const grantsAfter = await sql<{ table_name: string; privileges: string }[]>`
      SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS privileges
      FROM information_schema.role_table_grants
      WHERE grantee = 'qos_ai_worker'
        AND table_schema = 'qos'
        AND table_name IN ${sql(WORKER_TABLES)}
      GROUP BY table_name
      ORDER BY table_name
    `;
    const grantMap = Object.fromEntries(
      grantsAfter.map((row) => [row.table_name, row.privileges]),
    );
    const missing = WORKER_TABLES.filter((table) => {
      const privileges = grantMap[table] ?? "";
      if (table === "location_item_stop_sales") {
        return privileges !== "SELECT,UPDATE";
      }
      return privileges !== "SELECT";
    });
    if (missing.length > 0) {
      throw new Error(`Missing qos_ai_worker grants: ${missing.join(", ")}`);
    }

    console.log(
      JSON.stringify({
        status: "ok",
        journalRecorded: true,
        grantsAfter: grantMap,
      }),
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});