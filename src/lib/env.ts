export type AppEnv = {
  nodeEnv: string;
  serviceVersion: string;
  databaseUrl?: string;
  dbHost?: string;
  dbPort: string;
  dbName?: string;
  dbUser?: string;
  dbPassword?: string;
  dbPoolMax: number;
};

function parsePoolMax(value: string | undefined): number {
  if (value === undefined || value === "") {
    return 10;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error("DB_POOL_MAX must be a positive integer.");
  }

  return parsed;
}

export type EnvSource = Record<string, string | undefined>;

export function readAppEnv(source: EnvSource = process.env): AppEnv {
  return {
    nodeEnv: source.NODE_ENV ?? "development",
    serviceVersion: source.npm_package_version ?? "0.1.0",
    databaseUrl: source.DATABASE_URL,
    dbHost: source.DB_HOST,
    dbPort: source.DB_PORT ?? "5432",
    dbName: source.DB_NAME,
    dbUser: source.DB_USER,
    dbPassword: source.DB_PASSWORD,
    dbPoolMax: parsePoolMax(source.DB_POOL_MAX),
  };
}
