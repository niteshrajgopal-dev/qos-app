import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

import type postgres from "postgres";

/**
 * Database logins for the AI worker and its autoscaler. Each login holds
 * exactly one queue role (privileges inherited, SET ROLE refused) and no
 * attributes beyond LOGIN, so a leaked credential reaches only what that role
 * was granted by migrations 0042/0043.
 */
export type AiWorkerLoginSpec = {
  login: string;
  role: "qos_ai_worker" | "qos_ai_scaler";
  connectionLimit: number;
};

export const AI_WORKER_LOGIN: AiWorkerLoginSpec = {
  login: "qos_ai_worker_login",
  role: "qos_ai_worker",
  connectionLimit: 20,
};

export const AI_SCALER_LOGIN: AiWorkerLoginSpec = {
  login: "qos_ai_scaler_login",
  role: "qos_ai_scaler",
  connectionLimit: 5,
};

const IDENTIFIER = /^[a-z][a-z0-9_]*$/;
/** Generated secrets only: long, and safe inside a connection string. */
const PASSWORD = /^[A-Za-z0-9_-]{32,}$/;
const SCRAM_ITERATIONS = 4096;

/**
 * Postgres SCRAM-SHA-256 verifier (the format pg_authid stores). Sending this
 * instead of the password keeps the plaintext out of server statement logs.
 */
export function scramSha256Verifier(
  password: string,
  options: { salt?: Buffer; iterations?: number } = {},
) {
  const salt = options.salt ?? randomBytes(16);
  const iterations = options.iterations ?? SCRAM_ITERATIONS;
  const salted = pbkdf2Sync(password.normalize("NFKC"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

export class AiWorkerLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiWorkerLoginError";
  }
}

/**
 * Creates the login, or rotates its password, then grants its one role.
 * Idempotent. Needs a role with CREATEROLE and ADMIN on the queue role (on
 * Azure, the migrator that created it). Refuses rather than repairs a login
 * that has picked up extra memberships or attributes.
 */
export async function provisionAiWorkerLogin(
  sql: postgres.Sql,
  spec: AiWorkerLoginSpec,
  password: string,
) {
  if (!IDENTIFIER.test(spec.login) || !IDENTIFIER.test(spec.role)) {
    throw new AiWorkerLoginError("Login and role names must be plain lowercase identifiers.");
  }
  if (!PASSWORD.test(password)) {
    throw new AiWorkerLoginError("The password must be at least 32 URL-safe characters.");
  }
  if (!Number.isInteger(spec.connectionLimit) || spec.connectionLimit < 1) {
    throw new AiWorkerLoginError("The connection limit must be a positive integer.");
  }
  const verifier = scramSha256Verifier(password);

  await sql.begin(async (tx) => {
    const [existing] = await tx`SELECT 1 AS found FROM pg_roles WHERE rolname = ${spec.login}`;
    const template = existing
      ? "ALTER ROLE %I WITH LOGIN INHERIT CONNECTION LIMIT %s PASSWORD %L"
      : "CREATE ROLE %I WITH LOGIN INHERIT CONNECTION LIMIT %s PASSWORD %L";
    const [roleSql] = await tx`
      SELECT format(${template}::text, ${spec.login}::text, ${String(spec.connectionLimit)}::text, ${verifier}::text) AS stmt`;
    await tx.unsafe(roleSql!.stmt);
    await tx.unsafe(`GRANT ${spec.role} TO ${spec.login} WITH INHERIT TRUE, SET FALSE`);

    const [database] = await tx`SELECT current_database() AS name`;
    if (!database?.name || !IDENTIFIER.test(database.name)) {
      throw new AiWorkerLoginError("The current database name is not a safe identifier.");
    }
    await tx.unsafe(`GRANT CONNECT ON DATABASE ${database.name} TO ${spec.login}`);

    const [attributes] = await tx`
      SELECT rolsuper OR rolcreaterole OR rolcreatedb OR rolreplication OR rolbypassrls AS elevated
      FROM pg_roles WHERE rolname = ${spec.login}`;
    if (attributes!.elevated) {
      throw new AiWorkerLoginError(
        `${spec.login} has role attributes beyond LOGIN; fix it by hand before provisioning.`,
      );
    }
    const memberships = await tx`
      SELECT m.roleid::regrole::text AS role, m.inherit_option, m.set_option, m.admin_option
      FROM pg_auth_members m WHERE m.member = ${spec.login}::regrole`;
    const exact =
      memberships.length === 1 &&
      memberships[0]!.role === spec.role &&
      memberships[0]!.inherit_option === true &&
      memberships[0]!.set_option === false &&
      memberships[0]!.admin_option === false;
    if (!exact) {
      throw new AiWorkerLoginError(
        `${spec.login} must hold only ${spec.role}; fix its memberships by hand before provisioning.`,
      );
    }
  });
}
