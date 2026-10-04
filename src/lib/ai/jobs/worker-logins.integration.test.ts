import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hasIntegrationDatabase, integrationDatabaseUrl, resetAndMigrate } from "@/db/test-utils";
import {
  AI_SCALER_LOGIN,
  AI_WORKER_LOGIN,
  AiWorkerLoginError,
  provisionAiWorkerLogin,
} from "@/lib/ai/jobs/worker-logins";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

function loginUrl(user: string, password: string) {
  const url = new URL(integrationDatabaseUrl.replace(/^postgresql:/, "http:"));
  url.username = encodeURIComponent(user);
  url.password = encodeURIComponent(password);
  return url.toString().replace(/^http:/, "postgresql:");
}

async function dropLogin(sql: postgres.Sql, login: string) {
  const [existing] = await sql`SELECT 1 AS found FROM pg_roles WHERE rolname = ${login}`;
  if (!existing) {
    return;
  }
  await sql.unsafe(`DROP OWNED BY ${login}`);
  await sql.unsafe(`DROP ROLE ${login}`);
}

integrationDescribe("AI worker login provisioning", () => {
  let admin: postgres.Sql;
  const workerPassword = `w${"A".repeat(31)}`;
  const scalerPassword = `s${"B".repeat(31)}`;

  beforeAll(async () => {
    const migrated = await resetAndMigrate();
    admin = migrated.sql;
    await dropLogin(admin, AI_WORKER_LOGIN.login);
    await dropLogin(admin, AI_SCALER_LOGIN.login);
  }, 120_000);

  afterAll(async () => {
    if (!admin) {
      return;
    }
    await dropLogin(admin, AI_WORKER_LOGIN.login);
    await dropLogin(admin, AI_SCALER_LOGIN.login);
    await admin.end({ timeout: 5 });
  });

  it("creates inheriting logins that can only do their one queue job", async () => {
    await provisionAiWorkerLogin(admin, AI_WORKER_LOGIN, workerPassword);
    await provisionAiWorkerLogin(admin, AI_SCALER_LOGIN, scalerPassword);

    const roles = await admin`
      SELECT rolname, rolcanlogin, rolbypassrls, rolsuper, rolinherit, rolconnlimit
      FROM pg_roles
      WHERE rolname IN (${AI_WORKER_LOGIN.login}, ${AI_SCALER_LOGIN.login})
      ORDER BY rolname`;
    expect(roles).toEqual([
      {
        rolname: AI_SCALER_LOGIN.login,
        rolcanlogin: true,
        rolbypassrls: false,
        rolsuper: false,
        rolinherit: true,
        rolconnlimit: AI_SCALER_LOGIN.connectionLimit,
      },
      {
        rolname: AI_WORKER_LOGIN.login,
        rolcanlogin: true,
        rolbypassrls: false,
        rolsuper: false,
        rolinherit: true,
        rolconnlimit: AI_WORKER_LOGIN.connectionLimit,
      },
    ]);

    const worker = postgres(loginUrl(AI_WORKER_LOGIN.login, workerPassword), { max: 1, ssl: false });
    const scaler = postgres(loginUrl(AI_SCALER_LOGIN.login, scalerPassword), { max: 1, ssl: false });
    try {
      const [count] = await scaler`SELECT qos.count_due_ai_work() AS count`;
      expect(Number(count!.count)).toBe(0);
      await expect(scaler`SELECT count(*) FROM qos.ai_jobs`).rejects.toThrow(/permission denied/);
      await expect(worker`SELECT qos.count_due_ai_work()`).rejects.toThrow(/permission denied/);
      await expect(worker`SET ROLE qos_ai_worker`).rejects.toThrow(/permission denied|cannot be assumed/i);
      const [ok] = await worker`
        SELECT has_function_privilege(
          'qos.claim_next_ai_job(text,text[],integer,integer,integer,integer)',
          'EXECUTE'
        ) AS ok`;
      expect(ok!.ok).toBe(true);
    } finally {
      await worker.end({ timeout: 5 });
      await scaler.end({ timeout: 5 });
    }
  });

  it("rotates the password and refuses a login that picked up another role", async () => {
    const rotated = `r${"C".repeat(31)}`;
    await provisionAiWorkerLogin(admin, AI_WORKER_LOGIN, rotated);

    const stale = postgres(loginUrl(AI_WORKER_LOGIN.login, workerPassword), { max: 1, ssl: false });
    await expect(stale`SELECT 1`).rejects.toThrow();
    await stale.end({ timeout: 5 });

    const fresh = postgres(loginUrl(AI_WORKER_LOGIN.login, rotated), { max: 1, ssl: false });
    try {
      const [row] = await fresh`SELECT current_user AS user`;
      expect(row!.user).toBe(AI_WORKER_LOGIN.login);
    } finally {
      await fresh.end({ timeout: 5 });
    }

    await admin.unsafe(`GRANT qos_app TO ${AI_WORKER_LOGIN.login}`);
    await expect(provisionAiWorkerLogin(admin, AI_WORKER_LOGIN, rotated)).rejects.toBeInstanceOf(
      AiWorkerLoginError,
    );
    await admin.unsafe(`REVOKE qos_app FROM ${AI_WORKER_LOGIN.login}`);
  });
});
