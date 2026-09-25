import type { EnvSource } from "@/lib/env";

export class DevOnlySeedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevOnlySeedError";
  }
}

const BLOCKED_ENVIRONMENT = new Set([
  "staging",
  "stage",
  "stg",
  "production",
  "prod",
]);

const DEV_ENVIRONMENT = new Set(["dev", "development"]);

/**
 * Tokens that identify a non-dev deployment in host, database, or container names.
 * `NODE_ENV=production` is intentionally ignored: the DEV Container App runs that way.
 */
const BLOCKED_TARGET =
  /(^|[^a-z0-9])(staging|stage|stg|prod|production)([^a-z0-9]|$)/i;

const DEV_TARGET = /(^|[^a-z0-9])dev(elopment)?([^a-z0-9]|$)/i;

function targetText(source: EnvSource) {
  return [
    source.DATABASE_URL,
    source.DB_HOST,
    source.DB_NAME,
    source.CONTAINER_APP_NAME,
  ]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(" ");
}

function isLocalDatabase(source: EnvSource) {
  const target = `${source.DATABASE_URL ?? ""} ${source.DB_HOST ?? ""}`;
  return /localhost|127\.0\.0\.1|@db:/.test(target);
}

export function assertDevOnlySeedTarget(
  source: EnvSource = process.env,
): "dev" | "test" {
  const explicit = source.QOS_ENVIRONMENT?.trim().toLowerCase() ?? "";
  const target = targetText(source);

  if (BLOCKED_ENVIRONMENT.has(explicit) || BLOCKED_TARGET.test(explicit)) {
    throw new DevOnlySeedError(
      `DEV-only seed refused because QOS_ENVIRONMENT=${explicit}.`,
    );
  }

  if (BLOCKED_TARGET.test(target)) {
    throw new DevOnlySeedError(
      "DEV-only seed refused because the database or container target is staging or production.",
    );
  }

  if (explicit === "test") {
    return "test";
  }

  if (DEV_ENVIRONMENT.has(explicit) || isLocalDatabase(source) || DEV_TARGET.test(target)) {
    return "dev";
  }

  throw new DevOnlySeedError(
    "DEV-only seed refused because the target environment is not DEV. Set QOS_ENVIRONMENT=dev only for the development database.",
  );
}
