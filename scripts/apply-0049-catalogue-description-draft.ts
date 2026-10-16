/**
 * Apply migration 0049 with per-statement logging and idempotent guards.
 * Use qosadmin (DATABASE_ADMIN_URL or DATABASE_URL). qos_app cannot ALTER TYPE.
 *
 *   npx tsx scripts/apply-0049-catalogue-description-draft.ts
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

async function enumValueExists(sql: ReturnType<typeof postgres>) {
  const [row] = await sql<{ present: boolean }[]>`
    SELECT EXISTS (
      SELECT 1
      FROM pg_enum e
      JOIN pg_type t ON e.enumtypid = t.oid
      JOIN pg_namespace n ON t.typnamespace = n.oid
      WHERE n.nspname = 'qos'
        AND t.typname = 'agent_capability'
        AND e.enumlabel = 'catalogue_description'
    ) AS present
  `;

  return Boolean(row?.present);
}

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
    const migrationPath = path.join(
      process.cwd(),
      "drizzle/0049_catalogue_description_draft.sql",
    );
    const migration = readFileSync(migrationPath, "utf8");
    const statements = migration
      .split("--> statement-breakpoint")
      .map((statement) => statement.trim())
      .filter(Boolean);

    console.log(
      JSON.stringify({
        step: "precheck",
        enumPresent: await enumValueExists(sql),
        tablePresent: await tableExists(
          sql,
          "agent_run_catalogue_description_decisions",
        ),
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

    const tablePresent = await tableExists(
      sql,
      "agent_run_catalogue_description_decisions",
    );
    const enumPresent = await enumValueExists(sql);
    if (!tablePresent || !enumPresent) {
      throw new Error(
        "Migration finished but catalogue description draft objects are still missing.",
      );
    }

    console.log(
      JSON.stringify({
        status: "ok",
        enumPresent: true,
        tablePresent: true,
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
