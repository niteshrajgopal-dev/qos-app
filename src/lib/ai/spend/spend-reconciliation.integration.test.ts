import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
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
import { listDueUncertainAiSpend, summarizeAiSpendUsage } from "@/lib/ai/spend/spend-reconciliation";
import { readAiSpendPolicy, type AiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { withTenantContext } from "@/lib/tenant/context";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const NOW = new Date("2026-10-03T12:00:00.000Z");
const LATER = new Date("2026-10-03T12:05:00.000Z");
const ACTOR = { subject: "qos.test-worker", actorClass: "system" as const };
const OPERATOR = { subject: "operator@test", actorClass: "operator" as const };

function policy(overrides: Record<string, string> = {}): AiSpendPolicy {
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
    ...overrides,
  });
}

integrationDescribe("AI spend reconciliation", () => {
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

  function input(tenantId: string, subject: string): ReserveAiSpendInput {
    return {
      tenantId,
      path: "ai_photo.async",
      provider: "openai",
      subjectType: "catalogue_product",
      subjectPublicId: subject,
      units: 1,
      requestedBy: ACTOR,
    };
  }

  function asApp<T>(tenantId: string, fn: (tx: Parameters<Parameters<typeof withTenantContext>[2]>[0]) => Promise<T>) {
    return runAsRole(sqlClient, "qos_app", () => withTenantContext(db, tenantId, fn));
  }

  async function seedQuotesAndFlowers() {
    const consumed = await asApp(quotesId, async (tx) => {
      const { reservation } = await reserveAiSpend(tx, input(quotesId, "consumed"), { policy: policy(), now: NOW });
      await markAiSpendDispatched(tx, { tenantId: quotesId, reservationPublicId: reservation.publicId, now: NOW });
      await recordAiSpendOutcome(tx, {
        tenantId: quotesId,
        reservationPublicId: reservation.publicId,
        outcome: "completed",
        reportedUsage: { total_tokens: 30 },
        actor: ACTOR,
        now: NOW,
      });
      return reservation;
    });
    const uncertain = await asApp(quotesId, async (tx) => {
      const { reservation } = await reserveAiSpend(tx, input(quotesId, "uncertain"), { policy: policy(), now: NOW });
      await markAiSpendDispatched(tx, { tenantId: quotesId, reservationPublicId: reservation.publicId, now: NOW });
      await recordAiSpendOutcome(tx, {
        tenantId: quotesId,
        reservationPublicId: reservation.publicId,
        outcome: "submission_unknown",
        actor: ACTOR,
        now: NOW,
      });
      return reservation;
    });
    await asApp(quotesId, async (tx) => {
      const { reservation } = await reserveAiSpend(tx, input(quotesId, "released"), { policy: policy(), now: NOW });
      await releaseUnstartedAiSpend(tx, { tenantId: quotesId, reservationPublicId: reservation.publicId, now: NOW });
    });
    const flowersUncertain = await asApp(flowersId, async (tx) => {
      const { reservation } = await reserveAiSpend(tx, input(flowersId, "uncertain"), { policy: policy(), now: LATER });
      await markAiSpendDispatched(tx, { tenantId: flowersId, reservationPublicId: reservation.publicId, now: LATER });
      await recordAiSpendOutcome(tx, {
        tenantId: flowersId,
        reservationPublicId: reservation.publicId,
        outcome: "submission_unknown",
        actor: ACTOR,
        now: LATER,
      });
      return reservation;
    });
    return { consumed, uncertain, flowersUncertain };
  }

  it("rolls up reserved, consumed, released and uncertain usage for a tenant", async () => {
    await seedQuotesAndFlowers();
    const summary = await asApp(quotesId, (tx) =>
      summarizeAiSpendUsage(tx, { path: "ai_photo.async", tenantId: quotesId, now: NOW }),
    );
    expect(summary).toMatchObject({
      path: "ai_photo.async",
      tenantId: quotesId,
      quotaKind: "application_quota",
      reservations: { reserved: 0, consumed: 1, released: 1, uncertain: 1 },
      units: { reserved: 0, consumed: 1, released: 1, uncertain: 1 },
      reportedUsage: { total_tokens: 30 },
      uncertain: 1,
    });
    expect(summary.counters.tenantDaily).toBe(2);
    expect(summary.counters.tenantMonthly).toBe(2);
  });

  it("lists due-uncertain oldest first and keeps uncertain off the expiry timer", async () => {
    const seeded = await seedQuotesAndFlowers();
    const due = await db.transaction((tx) => listDueUncertainAiSpend(tx, { now: LATER }));
    expect(due.map((row) => row.reservationPublicId)).toEqual([
      seeded.uncertain.publicId,
      seeded.flowersUncertain.publicId,
    ]);
    expect(due[0]).toMatchObject({
      tenantId: quotesId,
      path: "ai_photo.async",
      subjectPublicId: "uncertain",
      units: 1,
    });

    const released = await asApp(quotesId, (tx) =>
      releaseExpiredUnstartedAiSpend(tx, { tenantId: quotesId, now: new Date(NOW.getTime() + 30 * 24 * 60 * 60_000) }),
    );
    expect(released).toEqual([]);
    const stillDue = await asApp(quotesId, (tx) => listDueUncertainAiSpend(tx, { tenantId: quotesId, now: LATER }));
    expect(stillDue.map((row) => row.reservationPublicId)).toEqual([seeded.uncertain.publicId]);
  });

  it("resolves billed versus not_billed without deleting history", async () => {
    const seeded = await seedQuotesAndFlowers();
    await asApp(quotesId, (tx) =>
      resolveUncertainAiSpend(tx, {
        tenantId: quotesId,
        reservationPublicId: seeded.uncertain.publicId,
        resolution: "billed",
        resolvedBy: OPERATOR,
        reason: "Provider dashboard shows the image request.",
      }),
    );
    await asApp(flowersId, (tx) =>
      resolveUncertainAiSpend(tx, {
        tenantId: flowersId,
        reservationPublicId: seeded.flowersUncertain.publicId,
        resolution: "not_billed",
        resolvedBy: OPERATOR,
        reason: "Provider confirms no request was received.",
      }),
    );

    const quotes = await asApp(quotesId, (tx) =>
      summarizeAiSpendUsage(tx, { path: "ai_photo.async", tenantId: quotesId, now: NOW }),
    );
    expect(quotes.reservations).toEqual({ reserved: 0, consumed: 2, released: 1, uncertain: 0 });
    expect(quotes.counters.tenantDaily).toBe(2);

    const flowers = await asApp(flowersId, (tx) =>
      summarizeAiSpendUsage(tx, { path: "ai_photo.async", tenantId: flowersId, now: LATER }),
    );
    expect(flowers.reservations).toEqual({ reserved: 0, consumed: 0, released: 1, uncertain: 0 });
    expect(flowers.counters.tenantDaily).toBe(0);

    const due = await db.transaction((tx) => listDueUncertainAiSpend(tx, { now: LATER }));
    expect(due).toEqual([]);
  });
});
