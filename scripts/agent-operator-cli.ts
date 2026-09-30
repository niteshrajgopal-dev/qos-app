import { parseArgs } from "node:util";

export type OperatorArgs = Record<string, string | boolean | undefined>;

export function readOperatorArgs(options: Record<string, { type: "string" | "boolean" }>) {
  const { values } = parseArgs({ options, strict: true, allowPositionals: false });
  return values as OperatorArgs;
}

export function requireArg(values: OperatorArgs, name: string): string {
  const value = values[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${name} is required.`);
  }
  return value.trim();
}

/**
 * Operator scripts write platform-level rows. They never read `.env`, and the
 * operator must name the database host explicitly so a stray DATABASE_URL
 * cannot point them at a shared environment by accident.
 */
export function assertConfirmedDatabaseHost(confirmedHost: string) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL must be set explicitly for operator scripts.");
  }
  const host = new URL(databaseUrl).hostname;
  if (host !== confirmedHost) {
    throw new Error(
      `DATABASE_URL points at ${host}, but --database-host was ${confirmedHost}. Refusing to continue.`,
    );
  }
  return host;
}
