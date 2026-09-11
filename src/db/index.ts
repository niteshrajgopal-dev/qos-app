import { createDbClient } from "@/db/client";

const globalForDb = globalThis as unknown as {
  db: ReturnType<typeof createDbClient>["db"] | undefined;
  sql: ReturnType<typeof createDbClient>["sql"] | undefined;
};

function getDbConnection() {
  if (globalForDb.db && globalForDb.sql) {
    return { db: globalForDb.db, sql: globalForDb.sql };
  }

  const { db, sql } = createDbClient();
  globalForDb.db = db;
  globalForDb.sql = sql;
  return { db, sql };
}

export const db = new Proxy({} as ReturnType<typeof createDbClient>["db"], {
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

export { createDbClient, createSqlClient, type DbClient } from "@/db/client";
