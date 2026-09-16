/**
 * Apply migration 0032 with per-statement logging and idempotent guards.
 * Use an admin DATABASE_URL (not qos_app).
 *
 *   npx tsx scripts/apply-0032-storefront-deployments.ts
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

async function tableExists(
  sql: ReturnType<typeof postgres>,
  tableName: string,
) {
  const [row] = await sql<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'qos'
        AND table_name = ${tableName}
    ) AS present
  `;

  return Boolean(row?.present);
}

async function enumExists(sql: ReturnType<typeof postgres>, typeName: string) {
  const [row] = await sql<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
      WHERE n.nspname = 'qos'
        AND t.typname = ${typeName}
    ) AS present
  `;

  return Boolean(row?.present);
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (use admin credentials, not qos_app).");
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: databaseUrl.includes("localhost")
      ? false
      : { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });

  try {
    const migrationPath = path.join(
      process.cwd(),
      "drizzle/0032_storefront_deployments.sql",
    );
    const migration = readFileSync(migrationPath, "utf8");
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    console.log(
      JSON.stringify({
        step: "precheck",
        enumPresent: await enumExists(
          sql,
          "storefront_deployment_lifecycle_status",
        ),
        tablePresent: await tableExists(sql, "storefront_deployments"),
      }),
    );

    for (const [index, statement] of statements.entries()) {
      const label = statement.split("\n")[0]?.slice(0, 80) ?? statement;
      try {
        await sql.unsafe(statement);
        console.log(`OK [${index + 1}/${statements.length}]: ${label}`);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown migration error";

        if (
          message.includes("already exists") ||
          message.includes("duplicate_object")
        ) {
          console.log(`SKIP [${index + 1}/${statements.length}]: ${message}`);
          continue;
        }

        console.error(`FAIL [${index + 1}/${statements.length}]: ${label}`);
        throw error;
      }
    }

    const tablePresent = await tableExists(sql, "storefront_deployments");
    if (!tablePresent) {
      throw new Error(
        "Migration finished but qos.storefront_deployments is still missing.",
      );
    }

    console.log(
      JSON.stringify({
        status: "ok",
        tablePresent: true,
        nextStep: "npm run db:migrate (should report nothing pending)",
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
