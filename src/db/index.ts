import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { buildDatabaseUrl } from "@/lib/database-url";

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle> | undefined;
  sql: ReturnType<typeof postgres> | undefined;
};

function createDb() {
  const sql = postgres(buildDatabaseUrl(), { max: 1 });
  const db = drizzle(sql);

  return { db, sql };
}

const cached = globalForDb.db && globalForDb.sql
  ? { db: globalForDb.db, sql: globalForDb.sql }
  : createDb();

export const db = cached.db;
export const sql = cached.sql;

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
  globalForDb.sql = sql;
}
