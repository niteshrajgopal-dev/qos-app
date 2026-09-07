import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { buildDatabaseUrl } from "@/lib/database-url";
import { readAppEnv } from "@/lib/env";

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof drizzle> | undefined;
  sql: ReturnType<typeof postgres> | undefined;
};

function getDbConnection() {
  if (globalForDb.db && globalForDb.sql) {
    return { db: globalForDb.db, sql: globalForDb.sql };
  }

  const env = readAppEnv();
  const sql = postgres(buildDatabaseUrl(env), { max: env.dbPoolMax });
  const db = drizzle(sql);

  globalForDb.db = db;
  globalForDb.sql = sql;

  return { db, sql };
}

export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const { db: connection } = getDbConnection();
    const value = connection[prop as keyof typeof connection];

    return typeof value === "function"
      ? value.bind(connection)
      : value;
  },
});

export function closeDbConnection() {
  if (globalForDb.sql) {
    void globalForDb.sql.end({ timeout: 5 });
    globalForDb.db = undefined;
    globalForDb.sql = undefined;
  }
}
