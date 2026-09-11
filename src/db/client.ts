import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { buildDatabaseUrl } from "@/lib/database-url";
import { readAppEnv, type AppEnv, type EnvSource } from "@/lib/env";

import * as schema from "./schema";

export type DbClient = PostgresJsDatabase<typeof schema>;

function isAppEnv(source: EnvSource | AppEnv): source is AppEnv {
  return typeof (source as AppEnv).dbPoolMax === "number";
}

export function createSqlClient(source: EnvSource | AppEnv = process.env) {
  const env = isAppEnv(source) ? source : readAppEnv(source);
  const databaseUrl = buildDatabaseUrl(source);
  const isLocal =
    databaseUrl.includes("localhost") ||
    databaseUrl.includes("127.0.0.1") ||
    databaseUrl.includes("@db:");

  return postgres(databaseUrl, {
    max: env.dbPoolMax,
    connect_timeout: 10,
    idle_timeout: 30,
    ssl: isLocal
      ? false
      : {
          rejectUnauthorized: true,
          minVersion: "TLSv1.2",
        },
  });
}

export function createDbClient(source: EnvSource | AppEnv = process.env) {
  const sql = createSqlClient(source);
  const db = drizzle(sql, { schema });
  return { db, sql };
}
