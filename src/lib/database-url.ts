import { readAppEnv, type AppEnv, type EnvSource } from "@/lib/env";

export function buildDatabaseUrl(
  source: EnvSource | AppEnv = process.env,
): string {
  const env = isAppEnv(source) ? source : readAppEnv(source);

  if (env.databaseUrl) {
    return env.databaseUrl;
  }

  const { dbHost, dbPort, dbName, dbUser, dbPassword } = env;

  if (!dbHost || !dbName || !dbUser || !dbPassword) {
    throw new Error(
      "Database configuration missing. Set DATABASE_URL or DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD.",
    );
  }

  const encodedUser = encodeURIComponent(dbUser);
  const encodedPassword = encodeURIComponent(dbPassword);

  return `postgresql://${encodedUser}:${encodedPassword}@${dbHost}:${dbPort}/${dbName}?sslmode=require`;
}

function isAppEnv(source: EnvSource | AppEnv): source is AppEnv {
  return typeof (source as AppEnv).dbPoolMax === "number";
}
