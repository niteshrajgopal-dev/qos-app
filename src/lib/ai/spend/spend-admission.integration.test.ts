import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { aiSpendReservations, tenantAuditEvents } from "@/db/schema";
import {
  createIntegrationDb,
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import {
  markAiSpendDispatched,
  recordAiSpendOutcome,
  releaseExpiredUnstartedAiSpend,
  releaseUnstartedAiSpend,
  reserveAiSpend,
  resolveUncertainAiSpend,
  type ReserveAiSpendInput,
} from "@/lib/ai/spend/spend-admission";
import { readAiSpendPolicy, type AiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { withTenantContext } from "@/lib/tenant/context";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const NOW = new Date("2026-10-03T12:00:00.000Z");
const ACTOR = { subject: "qos.test-worker", actorClass: "system" as const };
const OPERATOR = { subject: "operator@test", actorClass: "operator" as const };

function policy(overrides: Record<string, string> = {}): AiSpendPolicy {
  return readAiSpendPolicy({
    AI_SPEND_PLATFORM_CONCURRENCY: "10",
    AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
    AI_SPEND_AI_PHOTO_ASYNC_ENABLED: "true",
    AI_SPEND_AI_PHOTO_ASYNC_MAX_UNITS_PER_RUN: "3",
    AI_SPEND_AI_PHOTO_ASYNC_TENANT_DAILY_UNITS: "3",
    AI_SPEND_AI_PHOTO_ASYNC_TENANT_MONTHLY_UNITS: "100",
    AI_SPEND_AI_PHOTO_ASYNC_TENANT_CONCURRENCY: "10",
    AI_SPEND_AI_PHOTO_ASYNC_PLATFORM_DAILY_UNITS: "4",
    AI_SPEND_AI_PHOTO_ASYNC_PLATFORM_MONTHLY_UNITS: "100",
    AI_SPEND_AI_PHOTO_ASYNC_UNSTARTED_EXPIRY_MS: "600000",
    ...overrides,
  });
}

/**
 * PR 3b: spend admission. Platform and tenant allowances are taken atomically
 * in one order; refused admissions leave nothing behind; uncertain work keeps
 * counting until explicitly resolved; a timer only releases work whose
 * dispatch never began. Everything runs as the restricted app role.
 */
integrationDescribe("AI spend admission", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let quotesId: string;
  let flowersId: string;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.tenant_audit_events, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    quotesId = (await createTenantHierarchy(db, quotesTenantFixture())).tenant.id;
    flowersId = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
  });

  function input(tenantId: string, subject: string, units = 1): ReserveAiSpendInput {
    return {
      tenantId,
      path: "ai_photo.async",
      provider: "openai",
      subjectType: "catalogue_product",
      subjectPublicId: subject,
      units,
      requestedBy: ACTOR,
    };
  }

  function reserve(tenantId: string, subject: string, units = 1, spendPolicy = policy(), now = NOW) {
    return runAsRole(sqlClient, "qos_app", () =>
      withTenantContext(db, tenantId, (tx) => reserveAiSpend(tx, input(tenantId, subject, units), { policy: spendPolicy, now })),
    );
  }

  function asApp<T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof withTenantContext>[2]>[0]) => Promise<T>) {
    return runAsRole(sqlClient, "qos_app", () => withTenantContext(db, tenantId, fn));
  }

  async function platformUnits(scopeKey: string) {
    const [row] = await sqlClient<{ units: number }[]>`
      SELECT coalesce(sum(units), 0)::int AS units FROM qos.ai_spend_platform_counters WHERE scope_key = ${scopeKey}`;
    return row!.units;
  }

  async function tenantUnits(tenantId: string, scopeKey: string) {
    const [row] = await sqlClient<{ units: number }[]>`
      SELECT coalesce(sum(units), 0)::int AS units FROM qos.ai_spend_tenant_counters
      WHERE tenant_id = ${tenantId} AND scope_key = ${scopeKey}`;
    return row!.units;
  }

  async function dispatched(tenantId: string, subject: string) {
    const { reservation } = await reserve(tenantId, subject);
    await asApp(tenantId, (tx) =>
      markAiSpendDispatched(tx, { tenantId, reservationPublicId: reservation.publicId, now: NOW }),
    );
    return reservation;
  }

  it("refuses new paid work while the policy is unset and writes nothing", async () => {
    await expect(reserve(quotesId, "p1", 1, readAiSpendPolicy({}))).rejects.toMatchObject({
      code: "spend_policy_unset",
      status: 409,
    });
    await expect(
      reserve(quotesId, "p1", 1, policy({ AI_SPEND_AI_PHOTO_ASYNC_TENANT_MONTHLY_UNITS: "" })),
    ).rejects.toMatchObject({ code: "spend_policy_unset" });
    const [counts] = await sqlClient<{ reservations: number; counters: number }[]>`
      SELECT (SELECT count(*)::int FROM qos.ai_spend_reservations) AS reservations,
             (SELECT count(*)::int FROM qos.ai_spend_platform_counters) AS counters`;
    expect(counts).toEqual({ reservations: 0, counters: 0 });
  });

  it("enforces the per-run bound and is idempotent per subject", async () => {
    await expect(reserve(quotesId, "big", 4)).rejects.toMatchObject({ code: "per_run_limit", status: 422 });

    const first = await reserve(quotesId, "p1", 2);
    const again = await reserve(quotesId, "p1", 2);
    expect(first.created).toBe(true);
    expect(again).toEqual({ reservation: first.reservation, created: false });
    expect(await tenantUnits(quotesId, "path:ai_photo.async:daily")).toBe(2);
    expect(await platformUnits("platform:concurrency")).toBe(1);

    const audits = await sqlClient`SELECT action, change_summary FROM qos.tenant_audit_events WHERE action = 'ai_spend.reserved'`;
    expect(audits).toHaveLength(1);
    expect(audits[0]!.change_summary).toMatchObject({ units: 2, quotaKind: "application_quota", estimatedCostMicros: null });
  });

  it("applies tenant and platform daily allowances across tenants", async () => {
    await reserve(quotesId, "q1");
    await reserve(quotesId, "q2");
    await reserve(quotesId, "q3");
    await expect(reserve(quotesId, "q4")).rejects.toMatchObject({ code: "tenant_daily_limit", status: 429 });

    // The platform allowance (4) is shared: one left for the other tenant.
    await reserve(flowersId, "f1");
    await expect(reserve(flowersId, "f2")).rejects.toMatchObject({ code: "platform_daily_limit" });
    expect(await platformUnits("path:ai_photo.async:daily")).toBe(4);

    // A new UTC day has a fresh allowance; the monthly one still accumulates.
    const tomorrow = new Date(NOW.getTime() + 24 * 60 * 60_000);
    await reserve(flowersId, "f2", 1, policy(), tomorrow);
    expect(await platformUnits("path:ai_photo.async:monthly")).toBe(5);
  });

  it("serialises concurrent admissions from different tenants on the platform allowance", async () => {
    await reserve(quotesId, "q1");
    await reserve(quotesId, "q2");
    await reserve(quotesId, "q3");
    // One platform unit remains. Two tenants race for it on separate connections.
    const a = await createIntegrationDb();
    const b = await createIntegrationDb();
    try {
      await a.sql.unsafe("SET ROLE qos_app");
      await b.sql.unsafe("SET ROLE qos_app");
      let releaseA!: () => void;
      const holdA = new Promise<void>((resolve) => (releaseA = resolve));
      let aReserved!: () => void;
      const aHasReserved = new Promise<void>((resolve) => (aReserved = resolve));

      const txA = withTenantContext(a.db, flowersId, async (tx) => {
        await reserveAiSpend(tx, input(flowersId, "fa"), { policy: policy({ AI_SPEND_AI_PHOTO_ASYNC_TENANT_DAILY_UNITS: "3" }), now: NOW });
        aReserved();
        await holdA;
      });
      await aHasReserved;

      let bSettled = false;
      const txB = withTenantContext(b.db, quotesId, (tx) =>
        reserveAiSpend(tx, input(quotesId, "qb"), { policy: policy({ AI_SPEND_AI_PHOTO_ASYNC_TENANT_DAILY_UNITS: "10" }), now: NOW }),
      ).finally(() => {
        bSettled = true;
      });
      const bResult = txB.catch((error: unknown) => error);

      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(bSettled).toBe(false);
      releaseA();
      await txA;
      expect(await bResult).toMatchObject({ code: "platform_daily_limit" });
    } finally {
      await a.sql.end({ timeout: 5 });
      await b.sql.end({ timeout: 5 });
    }
    expect(await platformUnits("path:ai_photo.async:daily")).toBe(4);
    expect(await tenantUnits(quotesId, "path:ai_photo.async:daily")).toBe(3);
  });

  it("leaves no partial counter changes when a later allowance refuses, even if the caller carries on", async () => {
    const tight = policy({ AI_SPEND_AI_PHOTO_ASYNC_TENANT_DAILY_UNITS: "1" });
    await reserve(quotesId, "q1", 1, tight);
    await asApp(quotesId, async (tx) => {
      await expect(reserveAiSpend(tx, input(quotesId, "q2"), { policy: tight, now: NOW })).rejects.toMatchObject({
        code: "tenant_daily_limit",
      });
    });
    expect(await platformUnits("path:ai_photo.async:daily")).toBe(1);
    expect(await platformUnits("platform:concurrency")).toBe(1);
    expect(await platformUnits("provider:openai:concurrency")).toBe(1);
  });

  it("counts queued and uncertain work against concurrency and frees only finished work", async () => {
    const one = policy({ AI_SPEND_AI_PHOTO_ASYNC_TENANT_CONCURRENCY: "1", AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "2" });
    const { reservation } = await reserve(quotesId, "q1", 1, one);
    await expect(reserve(quotesId, "q2", 1, one)).rejects.toMatchObject({ code: "tenant_concurrency_limit" });
    // Provider concurrency spans tenants.
    await reserve(flowersId, "f1", 1, one);
    await expect(reserve(flowersId, "f2", 1, one)).rejects.toMatchObject({ code: "provider_concurrency_limit" });

    await asApp(quotesId, async (tx) => {
      await markAiSpendDispatched(tx, { tenantId: quotesId, reservationPublicId: reservation.publicId, now: NOW });
      await recordAiSpendOutcome(tx, {
        tenantId: quotesId,
        reservationPublicId: reservation.publicId,
        outcome: "completed",
        reportedUsage: { images: 1, output_tokens: 4200 },
        actor: ACTOR,
      });
    });
    expect(await tenantUnits(quotesId, "path:ai_photo.async:concurrency")).toBe(0);
    expect(await tenantUnits(quotesId, "path:ai_photo.async:daily")).toBe(1);
    expect(await platformUnits("provider:openai:concurrency")).toBe(1);
    const [row] = await db.select().from(aiSpendReservations).where(eq(aiSpendReservations.publicId, reservation.publicId));
    expect(row).toMatchObject({ state: "consumed", outcome: "completed", reportedUsage: { images: 1, output_tokens: 4200 } });
    await reserve(quotesId, "q2", 1, one);
  });

  it("returns quota only for work proven unbilled", async () => {
    for (const [subject, outcome, state, quota] of [
      ["a", "not_dispatched", "released", 0],
      ["b", "rejected", "released", 0],
      ["c", "failed_after_processing", "consumed", 1],
    ] as const) {
      const reservation = await dispatched(quotesId, subject);
      await asApp(quotesId, (tx) =>
        recordAiSpendOutcome(tx, { tenantId: quotesId, reservationPublicId: reservation.publicId, outcome, actor: ACTOR }),
      );
      const [row] = await db.select().from(aiSpendReservations).where(eq(aiSpendReservations.publicId, reservation.publicId));
      expect(row).toMatchObject({ state, outcome });
      expect(await tenantUnits(quotesId, "path:ai_photo.async:daily")).toBe(quota);
      await sqlClient`TRUNCATE qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters`;
    }
  });

  it("never releases uncertain or dispatched work on a timer", async () => {
    const queued = (await reserve(quotesId, "queued")).reservation;
    const inFlight = await dispatched(quotesId, "in-flight");
    const unknown = await dispatched(quotesId, "unknown");
    await asApp(quotesId, (tx) =>
      recordAiSpendOutcome(tx, { tenantId: quotesId, reservationPublicId: unknown.publicId, outcome: "submission_unknown", actor: ACTOR }),
    );

    const muchLater = new Date(NOW.getTime() + 30 * 24 * 60 * 60_000);
    const released = await asApp(quotesId, (tx) => releaseExpiredUnstartedAiSpend(tx, { tenantId: quotesId, now: muchLater }));
    expect(released.map((row) => row.publicId)).toEqual([queued.publicId]);
    expect(released[0]).toMatchObject({ state: "released", outcome: "expired_unstarted" });

    const rows = await db.select().from(aiSpendReservations).where(eq(aiSpendReservations.tenantId, quotesId));
    const byId = new Map(rows.map((row) => [row.publicId, row]));
    expect(byId.get(inFlight.publicId)!.state).toBe("reserved");
    expect(byId.get(unknown.publicId)!.state).toBe("uncertain");
    expect(await tenantUnits(quotesId, "path:ai_photo.async:daily")).toBe(2);
    expect(await tenantUnits(quotesId, "path:ai_photo.async:concurrency")).toBe(2);

    // Not expired yet: nothing is released.
    const early = await asApp(flowersId, async (tx) => {
      const { reservation } = await reserveAiSpend(tx, input(flowersId, "fresh"), { policy: policy(), now: NOW });
      return [reservation, await releaseExpiredUnstartedAiSpend(tx, { tenantId: flowersId, now: new Date(NOW.getTime() + 60_000) })] as const;
    });
    expect(early[1]).toEqual([]);
  });

  it("releases explicitly cancelled unstarted work but not dispatched work", async () => {
    const queued = (await reserve(quotesId, "queued")).reservation;
    await asApp(quotesId, (tx) => releaseUnstartedAiSpend(tx, { tenantId: quotesId, reservationPublicId: queued.publicId }));
    expect(await tenantUnits(quotesId, "path:ai_photo.async:daily")).toBe(0);
    expect(await platformUnits("platform:concurrency")).toBe(0);

    const started = await dispatched(quotesId, "started");
    await expect(
      asApp(quotesId, (tx) => releaseUnstartedAiSpend(tx, { tenantId: quotesId, reservationPublicId: started.publicId })),
    ).rejects.toThrow(/cannot be released/);
  });

  it("resolves uncertain work only through an explicit, audited resolution", async () => {
    const billed = await dispatched(quotesId, "billed");
    const unbilled = await dispatched(quotesId, "unbilled");
    for (const reservation of [billed, unbilled]) {
      await asApp(quotesId, (tx) =>
        recordAiSpendOutcome(tx, { tenantId: quotesId, reservationPublicId: reservation.publicId, outcome: "submission_unknown", actor: ACTOR }),
      );
    }
    await expect(
      asApp(quotesId, (tx) =>
        resolveUncertainAiSpend(tx, { tenantId: quotesId, reservationPublicId: billed.publicId, resolution: "billed", resolvedBy: OPERATOR, reason: " " }),
      ),
    ).rejects.toThrow(/reason/);

    await asApp(quotesId, (tx) =>
      resolveUncertainAiSpend(tx, {
        tenantId: quotesId,
        reservationPublicId: billed.publicId,
        resolution: "billed",
        resolvedBy: OPERATOR,
        reason: "Provider dashboard shows the image request.",
        reportedUsage: { images: 1 },
      }),
    );
    await asApp(quotesId, (tx) =>
      resolveUncertainAiSpend(tx, {
        tenantId: quotesId,
        reservationPublicId: unbilled.publicId,
        resolution: "not_billed",
        resolvedBy: OPERATOR,
        reason: "Provider confirms no request was received.",
      }),
    );
    expect(await tenantUnits(quotesId, "path:ai_photo.async:daily")).toBe(1);
    expect(await tenantUnits(quotesId, "path:ai_photo.async:concurrency")).toBe(0);

    const rows = await db.select().from(aiSpendReservations).where(eq(aiSpendReservations.tenantId, quotesId));
    expect(rows.find((row) => row.publicId === billed.publicId)).toMatchObject({
      state: "consumed",
      outcome: "submission_unknown",
      resolution: "billed",
      resolvedBySubject: OPERATOR.subject,
      reportedUsage: { images: 1 },
    });
    expect(rows.find((row) => row.publicId === unbilled.publicId)).toMatchObject({ state: "released", resolution: "not_billed" });

    const audits = await db
      .select()
      .from(tenantAuditEvents)
      .where(and(eq(tenantAuditEvents.tenantId, quotesId), eq(tenantAuditEvents.action, "ai_spend.resolved")));
    expect(audits).toHaveLength(2);
    expect(audits.map((audit) => audit.actorSubject)).toEqual([OPERATOR.subject, OPERATOR.subject]);
    expect(audits[0]!.changeSummary).toMatchObject({ reason: expect.any(String) });

    await expect(
      asApp(quotesId, (tx) =>
        resolveUncertainAiSpend(tx, { tenantId: quotesId, reservationPublicId: billed.publicId, resolution: "not_billed", resolvedBy: OPERATOR, reason: "again" }),
      ),
    ).rejects.toThrow(/not uncertain/);
  });

  it("guards the lifecycle in the database even against direct writes by the app role", async () => {
    const queued = (await reserve(quotesId, "queued")).reservation;
    const started = await dispatched(quotesId, "started");
    const unknown = await dispatched(quotesId, "unknown");
    await asApp(quotesId, (tx) =>
      recordAiSpendOutcome(tx, { tenantId: quotesId, reservationPublicId: unknown.publicId, outcome: "submission_unknown", actor: ACTOR }),
    );

    async function rawUpdate(set: string, publicId: string) {
      return runAsRole(sqlClient, "qos_app", () =>
        sqlClient.begin(async (tx) => {
          await tx`SELECT set_config('qos.current_tenant_id', ${quotesId}, true)`;
          await tx.unsafe(`UPDATE qos.ai_spend_reservations SET ${set} WHERE public_id = $1`, [publicId]);
        }),
      );
    }

    await expect(rawUpdate("state = 'released', outcome = 'expired_unstarted'", started.publicId)).rejects.toThrow(/state_outcome/);
    await expect(rawUpdate("state = 'released', outcome = 'not_dispatched'", unknown.publicId)).rejects.toThrow(/explicit resolution/);
    await expect(rawUpdate("state = 'consumed', outcome = 'completed'", unknown.publicId)).rejects.toThrow(/explicit resolution/);
    await expect(
      rawUpdate("state = 'consumed', outcome = 'submission_unknown', resolution = 'billed', resolved_by_subject = 'x'", started.publicId),
    ).rejects.toThrow(/Only an uncertain/);
    await expect(rawUpdate("units = 1000", queued.publicId)).rejects.toThrow(/immutable/);
    await expect(rawUpdate("expires_at = now() + interval '1 year'", queued.publicId)).rejects.toThrow(/immutable/);
    await expect(rawUpdate("dispatched_at = null", started.publicId)).rejects.toThrow(/immutable/);
    await expect(rawUpdate("state = 'consumed', outcome = 'completed'", queued.publicId)).rejects.toThrow(/outcome_dispatched/);

    await rawUpdate("state = 'released', outcome = 'released_unstarted'", queued.publicId);
    await expect(rawUpdate("state = 'reserved', outcome = null", queued.publicId)).rejects.toThrow(/already released/);

    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        sqlClient.begin(async (tx) => {
          await tx`SELECT set_config('qos.current_tenant_id', ${quotesId}, true)`;
          await tx`DELETE FROM qos.ai_spend_reservations`;
        }),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      runAsRole(sqlClient, "qos_app", () => sqlClient`DELETE FROM qos.ai_spend_platform_counters`),
    ).rejects.toThrow(/permission denied/);
  });

  it("keeps reservations and tenant counters tenant-isolated", async () => {
    await reserve(quotesId, "q1");
    const seen = await asApp(flowersId, async (tx) => ({
      reservations: await tx.select().from(aiSpendReservations),
      counters: await tx.execute(sql`SELECT * FROM qos.ai_spend_tenant_counters`),
    }));
    expect(seen.reservations).toEqual([]);
    expect(seen.counters).toHaveLength(0);
  });
});
