import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import {
  markAiSpendDispatched,
  recordAiSpendOutcome,
  reserveAiSpend,
  resolveUncertainAiSpend,
} from "@/lib/ai/spend/spend-admission";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { withTenantContext } from "@/lib/tenant/context";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const NOW = new Date("2026-10-03T12:00:00.000Z");
const ACTOR = { subject: "qos.test-worker", actorClass: "system" as const };
const OPERATOR = { subject: "operator@test", actorClass: "operator" as const };

function policy() {
  return readAiSpendPolicy({
    AI_SPEND_PLATFORM_CONCURRENCY: "10",
    AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
    AI_SPEND_AI_PHOTO_ASYNC_ENABLED: "true",
    AI_SPEND_AI_PHOTO_ASYNC_MAX_UNITS_PER_RUN: "3",
    AI_SPEND_AI_PHOTO_ASYNC_TENANT_DAILY_UNITS: "10",
    AI_SPEND_AI_PHOTO_ASYNC_TENANT_MONTHLY_UNITS: "100",
    AI_SPEND_AI_PHOTO_ASYNC_TENANT_CONCURRENCY: "10",
    AI_SPEND_AI_PHOTO_ASYNC_PLATFORM_DAILY_UNITS: "20",
    AI_SPEND_AI_PHOTO_ASYNC_PLATFORM_MONTHLY_UNITS: "100",
    AI_SPEND_AI_PHOTO_ASYNC_UNSTARTED_EXPIRY_MS: "600000",
  });
}

integrationDescribe("0044 AI spend reconciliation migration", () => {
  let connection: Awaited<ReturnType<typeof resetAndMigrate>>;

  beforeAll(async () => {
    connection = await resetAndMigrate();
    await grantRoleMembership(connection.sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await connection.sql.end({ timeout: 5 });
  });

  it("gives the queue owner SELECT-only access through a dedicated policy", async () => {
    const { sql } = connection;
    const [policyRow] = await sql`
      SELECT polname, polcmd, polroles::regrole[]::text[] AS roles, pg_get_expr(polqual, polrelid) AS qual
      FROM pg_policy
      WHERE polrelid = 'qos.ai_spend_reservations'::regclass AND polname = 'ai_spend_reservations_queue_owner'`;
    expect(policyRow).toMatchObject({
      polname: "ai_spend_reservations_queue_owner",
      polcmd: "r",
      qual: "true",
    });
    expect(policyRow!.roles).toEqual(["qos_ai_queue_owner"]);

    const owner = await sql`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'qos_ai_queue_owner' AND table_schema = 'qos' AND table_name = 'ai_spend_reservations'
      ORDER BY privilege_type`;
    expect(owner.map((row) => row.privilege_type)).toEqual(["SELECT"]);

    const scaler = await sql`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'qos_ai_scaler' AND table_schema = 'qos' AND table_name = 'ai_spend_reservations'`;
    expect(scaler).toEqual([]);

    const worker = await sql`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'qos_ai_worker' AND table_schema = 'qos' AND table_name = 'ai_spend_reservations'
      ORDER BY privilege_type`;
    expect(worker.map((row) => row.privilege_type)).toEqual(["SELECT", "UPDATE"]);

    const app = await sql`
      SELECT privilege_type FROM information_schema.role_table_grants
      WHERE grantee = 'qos_app' AND table_schema = 'qos' AND table_name = 'ai_spend_reservations'
      ORDER BY privilege_type`;
    expect(app.map((row) => row.privilege_type)).toEqual(["INSERT", "SELECT", "UPDATE"]);
  });

  it("keeps count_due_ai_work scaler-only and includes uncertain reservations", async () => {
    const { db, sql } = connection;
    const [fn] = await sql`
      SELECT pg_get_userbyid(p.proowner) AS owner, p.prosecdef, p.proconfig
      FROM pg_proc p
      WHERE p.oid = 'qos.count_due_ai_work()'::regprocedure`;
    expect(fn).toMatchObject({
      owner: "qos_ai_queue_owner",
      prosecdef: true,
      proconfig: ["search_path=pg_catalog, pg_temp"],
    });

    for (const role of ["public", "qos_app", "qos_ai_worker", "qos_ai_scaler"]) {
      const [row] = await sql`SELECT has_function_privilege(${role}, 'qos.count_due_ai_work()', 'EXECUTE') AS ok`;
      if (role === "public") {
        const [acl] = await sql`
          SELECT EXISTS (
            SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
            WHERE p.oid = 'qos.count_due_ai_work()'::regprocedure AND a.grantee = 0
          ) AS ok`;
        expect(acl!.ok).toBe(false);
      } else {
        expect({ role, ok: row!.ok }).toEqual({ role, ok: role === "qos_ai_scaler" });
      }
    }

    await sql`TRUNCATE TABLE qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.tenant_audit_events, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    const tenantId = (await createTenantHierarchy(db, quotesTenantFixture())).tenant.id;
    const reservation = await runAsRole(sql, "qos_app", () =>
      withTenantContext(db, tenantId, async (tx) => {
        const created = await reserveAiSpend(
          tx,
          {
            tenantId,
            path: "ai_photo.async",
            provider: "openai",
            subjectType: "catalogue_product",
            subjectPublicId: "uncertain",
            units: 1,
            requestedBy: ACTOR,
          },
          { policy: policy(), now: NOW },
        );
        await markAiSpendDispatched(tx, { tenantId, reservationPublicId: created.reservation.publicId, now: NOW });
        await recordAiSpendOutcome(tx, {
          tenantId,
          reservationPublicId: created.reservation.publicId,
          outcome: "submission_unknown",
          actor: ACTOR,
          now: NOW,
        });
        return created.reservation;
      }),
    );

    const due = await runAsRole(sql, "qos_ai_scaler", () => sql`SELECT qos.count_due_ai_work() AS count`);
    expect(Number(due[0]!.count)).toBe(1);

    await runAsRole(sql, "qos_app", () =>
      withTenantContext(db, tenantId, (tx) =>
        resolveUncertainAiSpend(tx, {
          tenantId,
          reservationPublicId: reservation.publicId,
          resolution: "not_billed",
          resolvedBy: OPERATOR,
          reason: "Provider confirms no request was received.",
        }),
      ),
    );
    const after = await runAsRole(sql, "qos_ai_scaler", () => sql`SELECT qos.count_due_ai_work() AS count`);
    expect(Number(after[0]!.count)).toBe(0);

    await expect(runAsRole(sql, "qos_ai_scaler", () => sql`SELECT * FROM qos.ai_spend_reservations`)).rejects.toThrow(
      /permission denied/,
    );
    await expect(runAsRole(sql, "qos_ai_worker", () => sql`SELECT qos.count_due_ai_work()`)).rejects.toThrow(
      /permission denied/,
    );
  });
});
