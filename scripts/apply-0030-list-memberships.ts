import { readFileSync } from "node:fs";
import path from "node:path";

import postgres from "postgres";

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required.");
  }

  const sql = postgres(databaseUrl, {
    max: 1,
    ssl: databaseUrl.includes("localhost")
      ? false
      : { rejectUnauthorized: true, minVersion: "TLSv1.2" },
  });

  const migration = readFileSync(
    path.join(process.cwd(), "drizzle/0030_list_active_staff_memberships.sql"),
    "utf8",
  );

  for (const statement of migration.split("--> statement-breakpoint")) {
    const trimmed = statement.trim();
    if (trimmed) {
      await sql.unsafe(trimmed);
    }
  }

  const [fn] = await sql<{ present: boolean }[]>`
    SELECT exists(
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'qos'
        AND p.proname = 'list_active_staff_memberships'
    ) AS present
  `;

  console.log(JSON.stringify({ functionPresent: Boolean(fn?.present) }));
  await sql.end({ timeout: 5 });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Migration failed.");
  process.exit(1);
});
