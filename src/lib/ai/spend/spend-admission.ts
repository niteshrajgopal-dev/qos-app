import { randomBytes } from "node:crypto";

import { and, eq, isNull, lte, sql } from "drizzle-orm";
import { z } from "zod";

import { aiSpendReservations } from "@/db/schema";
import type { ProviderOutcome } from "@/lib/ai/provider-outcome";
import {
  aiSpendReadiness,
  type AiSpendAdmissibleLimits,
  type AiSpendPath,
  type AiSpendPolicy,
  type AiSpendProvider,
} from "@/lib/ai/spend/spend-policy";
import { recordTenantAuditEventInTx, type AuditActorClass } from "@/lib/audit/tenant-audit";
import type { DbTransaction } from "@/lib/tenant/context";

/**
 * Spend admission for new paid AI paths (ADR-AI-02 decision 16).
 *
 * Every function runs inside the caller's tenant transaction, so admission is
 * atomic with whatever creates the paid work. Platform, provider and tenant
 * allowances are conditional counter increments taken in one fixed order
 * (platform keys, then tenant keys, each sorted), which makes them race-safe
 * across tenants without deadlocks. Queued and uncertain work keeps counting.
 * Only work proven never dispatched is released, and a timer only ever
 * releases reservations whose dispatch never began.
 */

export type AiSpendReservation = typeof aiSpendReservations.$inferSelect;

export type AiSpendActor = { subject: string; actorClass: AuditActorClass };

export type AiSpendAdmissionErrorCode =
  | "spend_policy_unset"
  | "per_run_limit"
  | "platform_concurrency_limit"
  | "provider_concurrency_limit"
  | "platform_daily_limit"
  | "platform_monthly_limit"
  | "tenant_concurrency_limit"
  | "tenant_daily_limit"
  | "tenant_monthly_limit";

export class AiSpendAdmissionError extends Error {
  constructor(
    public readonly code: AiSpendAdmissionErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AiSpendAdmissionError";
  }
}

export class AiSpendStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSpendStateError";
  }
}

/** Outcomes a dispatched reservation can settle with. Reads never settle spend. */
export type AiSpendOutcome = "completed" | Exclude<ProviderOutcome, "read_failed">;

const CONCURRENCY_WINDOW = "1970-01-01";

const reportedUsageSchema = z
  .record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), z.number().int().nonnegative())
  .refine((value) => Object.keys(value).length <= 32, "Too many usage fields.");

export type AiSpendReportedUsage = z.infer<typeof reportedUsageSchema>;

type CounterCharge = {
  scope: "platform" | "tenant";
  scopeKey: string;
  windowStart: string;
  units: number;
  limit: number;
  code: AiSpendAdmissionErrorCode;
  kind: "concurrency" | "quota";
};

function utcDay(now: Date) {
  return now.toISOString().slice(0, 10);
}

function utcMonth(now: Date) {
  return `${now.toISOString().slice(0, 7)}-01`;
}

function charges(
  input: { path: AiSpendPath; provider: AiSpendProvider; units: number },
  windows: { daily: string; monthly: string },
  limits: AiSpendAdmissibleLimits,
): CounterCharge[] {
  const { path, provider, units } = input;
  const list: CounterCharge[] = [
    { scope: "platform", scopeKey: "platform:concurrency", windowStart: CONCURRENCY_WINDOW, units: 1, limit: limits.platformConcurrency, code: "platform_concurrency_limit", kind: "concurrency" },
    { scope: "platform", scopeKey: `provider:${provider}:concurrency`, windowStart: CONCURRENCY_WINDOW, units: 1, limit: limits.providerConcurrency, code: "provider_concurrency_limit", kind: "concurrency" },
    { scope: "platform", scopeKey: `path:${path}:daily`, windowStart: windows.daily, units, limit: limits.platformDailyUnits, code: "platform_daily_limit", kind: "quota" },
    { scope: "platform", scopeKey: `path:${path}:monthly`, windowStart: windows.monthly, units, limit: limits.platformMonthlyUnits, code: "platform_monthly_limit", kind: "quota" },
    { scope: "tenant", scopeKey: `path:${path}:concurrency`, windowStart: CONCURRENCY_WINDOW, units: 1, limit: limits.tenantConcurrency, code: "tenant_concurrency_limit", kind: "concurrency" },
    { scope: "tenant", scopeKey: `path:${path}:daily`, windowStart: windows.daily, units, limit: limits.tenantDailyUnits, code: "tenant_daily_limit", kind: "quota" },
    { scope: "tenant", scopeKey: `path:${path}:monthly`, windowStart: windows.monthly, units, limit: limits.tenantMonthlyUnits, code: "tenant_monthly_limit", kind: "quota" },
  ];
  return orderCharges(list);
}

/** The single lock order shared by admission and release. */
function orderCharges<T extends Pick<CounterCharge, "scope" | "scopeKey" | "windowStart">>(list: T[]) {
  const scopeRank = { platform: 0, tenant: 1 } as const;
  return [...list].sort(
    (a, b) =>
      scopeRank[a.scope] - scopeRank[b.scope] ||
      a.scopeKey.localeCompare(b.scopeKey) ||
      a.windowStart.localeCompare(b.windowStart),
  );
}

async function takeCharge(tx: DbTransaction, tenantId: string, charge: CounterCharge) {
  const rows =
    charge.scope === "platform"
      ? await tx.execute<{ units: number }>(sql`
          insert into qos.ai_spend_platform_counters as counter (scope_key, window_start, units)
          select ${charge.scopeKey}, ${charge.windowStart}::date, ${charge.units}::int
          where ${charge.units}::int <= ${charge.limit}::int
          on conflict (scope_key, window_start) do update
            set units = counter.units + excluded.units
            where counter.units + excluded.units <= ${charge.limit}::int
          returning counter.units`)
      : await tx.execute<{ units: number }>(sql`
          insert into qos.ai_spend_tenant_counters as counter (tenant_id, scope_key, window_start, units)
          select ${tenantId}::uuid, ${charge.scopeKey}, ${charge.windowStart}::date, ${charge.units}::int
          where ${charge.units}::int <= ${charge.limit}::int
          on conflict (tenant_id, scope_key, window_start) do update
            set units = counter.units + excluded.units
            where counter.units + excluded.units <= ${charge.limit}::int
          returning counter.units`);
  if (rows.length === 0) {
    throw new AiSpendAdmissionError(
      charge.code,
      charge.kind === "concurrency"
        ? "Too much AI work is already in progress. Try again later."
        : "The AI usage allowance for this period has been reached.",
      429,
    );
  }
}

async function returnCharge(
  tx: DbTransaction,
  tenantId: string,
  charge: Pick<CounterCharge, "scope" | "scopeKey" | "windowStart" | "units">,
) {
  // The units >= 0 check makes a double release fail loudly instead of drifting.
  if (charge.scope === "platform") {
    await tx.execute(sql`
      update qos.ai_spend_platform_counters
      set units = units - ${charge.units}::int
      where scope_key = ${charge.scopeKey} and window_start = ${charge.windowStart}::date`);
  } else {
    await tx.execute(sql`
      update qos.ai_spend_tenant_counters
      set units = units - ${charge.units}::int
      where tenant_id = ${tenantId}::uuid and scope_key = ${charge.scopeKey}
        and window_start = ${charge.windowStart}::date`);
  }
}

/** Returns concurrency, and quota too when the work is proven unbilled. */
async function returnCharges(
  tx: DbTransaction,
  row: AiSpendReservation,
  options: { includeQuota: boolean },
) {
  const list = orderCharges([
    { scope: "platform" as const, scopeKey: "platform:concurrency", windowStart: CONCURRENCY_WINDOW, units: 1, kind: "concurrency" },
    { scope: "platform" as const, scopeKey: `provider:${row.provider}:concurrency`, windowStart: CONCURRENCY_WINDOW, units: 1, kind: "concurrency" },
    { scope: "platform" as const, scopeKey: `path:${row.path}:daily`, windowStart: row.dailyWindow, units: row.units, kind: "quota" },
    { scope: "platform" as const, scopeKey: `path:${row.path}:monthly`, windowStart: row.monthlyWindow, units: row.units, kind: "quota" },
    { scope: "tenant" as const, scopeKey: `path:${row.path}:concurrency`, windowStart: CONCURRENCY_WINDOW, units: 1, kind: "concurrency" },
    { scope: "tenant" as const, scopeKey: `path:${row.path}:daily`, windowStart: row.dailyWindow, units: row.units, kind: "quota" },
    { scope: "tenant" as const, scopeKey: `path:${row.path}:monthly`, windowStart: row.monthlyWindow, units: row.units, kind: "quota" },
  ]);
  for (const charge of list) {
    if (charge.kind === "concurrency" || options.includeQuota) {
      await returnCharge(tx, row.tenantId, charge);
    }
  }
}

async function auditSpend(
  tx: DbTransaction,
  row: AiSpendReservation,
  action: "ai_spend.reserved" | "ai_spend.uncertain" | "ai_spend.resolved",
  actor: AiSpendActor,
  changeSummary: Record<string, unknown> = {},
) {
  await recordTenantAuditEventInTx(tx, {
    tenantId: row.tenantId,
    actorSubject: actor.subject,
    actorClass: actor.actorClass,
    action,
    entityType: "ai_spend_reservation",
    entityPublicId: row.publicId,
    changeSummary: {
      path: row.path,
      provider: row.provider,
      subjectType: row.subjectType,
      subjectPublicId: row.subjectPublicId,
      units: row.units,
      quotaKind: "application_quota",
      state: row.state,
      ...changeSummary,
    },
  });
}

async function lockReservation(tx: DbTransaction, tenantId: string, publicId: string) {
  const [row] = await tx
    .select()
    .from(aiSpendReservations)
    .where(and(eq(aiSpendReservations.tenantId, tenantId), eq(aiSpendReservations.publicId, publicId)))
    .limit(1)
    .for("update");
  if (!row) {
    throw new AiSpendStateError(`AI spend reservation ${publicId} was not found.`);
  }
  return row;
}

export type ReserveAiSpendInput = {
  tenantId: string;
  path: AiSpendPath;
  provider: AiSpendProvider;
  subjectType: string;
  subjectPublicId: string;
  units: number;
  requestedBy: AiSpendActor;
  /** Only with versioned pricing; never presented as an invoice ceiling. */
  estimate?: { costMicros: number; pricingVersion: string };
};

/**
 * Admits paid work or throws. Repeating the call for the same subject and path
 * returns the existing reservation instead of charging again.
 */
export async function reserveAiSpend(
  tx: DbTransaction,
  input: ReserveAiSpendInput,
  options: { policy: AiSpendPolicy; now?: Date },
): Promise<{ reservation: AiSpendReservation; created: boolean }> {
  const readiness = aiSpendReadiness(options.policy, input.path, input.provider);
  if (!readiness.admissible) {
    throw new AiSpendAdmissionError(
      "spend_policy_unset",
      "This AI feature is not enabled because its spend policy has not been configured.",
      409,
    );
  }
  if (!Number.isInteger(input.units) || input.units < 1 || input.units > readiness.limits.maxUnitsPerRun) {
    throw new AiSpendAdmissionError(
      "per_run_limit",
      "This request is larger than a single AI run is allowed to be.",
      422,
    );
  }

  const [existing] = await tx
    .select()
    .from(aiSpendReservations)
    .where(
      and(
        eq(aiSpendReservations.tenantId, input.tenantId),
        eq(aiSpendReservations.path, input.path),
        eq(aiSpendReservations.subjectType, input.subjectType),
        eq(aiSpendReservations.subjectPublicId, input.subjectPublicId),
      ),
    )
    .limit(1);
  if (existing) {
    return { reservation: existing, created: false };
  }

  const now = options.now ?? new Date();
  const windows = { daily: utcDay(now), monthly: utcMonth(now) };
  // A savepoint, so a refused admission leaves no partial counter changes even
  // if the caller catches the error and keeps using the transaction.
  const reservation = await tx.transaction(async (sp) => {
    for (const charge of charges(input, windows, readiness.limits)) {
      await takeCharge(sp, input.tenantId, charge);
    }
    const [row] = await sp
      .insert(aiSpendReservations)
      .values({
        tenantId: input.tenantId,
        publicId: `spr_${randomBytes(12).toString("base64url")}`,
        path: input.path,
        provider: input.provider,
        subjectType: input.subjectType,
        subjectPublicId: input.subjectPublicId,
        units: input.units,
        estimatedCostMicros: input.estimate?.costMicros ?? null,
        pricingVersion: input.estimate?.pricingVersion ?? null,
        dailyWindow: windows.daily,
        monthlyWindow: windows.monthly,
        expiresAt: new Date(now.getTime() + readiness.limits.unstartedExpiryMs),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row!;
  });

  await auditSpend(tx, reservation, "ai_spend.reserved", input.requestedBy, {
    estimatedCostMicros: reservation.estimatedCostMicros,
    pricingVersion: reservation.pricingVersion,
  });
  return { reservation, created: true };
}

/**
 * Records that the provider call is about to start. Commit this before the
 * call: from here on the reservation is never released on a timer.
 */
export async function markAiSpendDispatched(
  tx: DbTransaction,
  input: { tenantId: string; reservationPublicId: string; now?: Date },
) {
  const row = await lockReservation(tx, input.tenantId, input.reservationPublicId);
  if (row.state !== "reserved") {
    throw new AiSpendStateError(`AI spend reservation ${row.publicId} is ${row.state}.`);
  }
  if (row.dispatchedAt) {
    return row;
  }
  const now = input.now ?? new Date();
  const [updated] = await tx
    .update(aiSpendReservations)
    .set({ dispatchedAt: now, updatedAt: now })
    .where(eq(aiSpendReservations.id, row.id))
    .returning();
  return updated!;
}

/**
 * Settles a dispatched reservation from what the provider outcome proves.
 * completed / failed_after_processing: consumed, quota kept.
 * not_dispatched / rejected: released, quota returned.
 * submission_unknown: uncertain; keeps counting until explicitly resolved.
 */
export async function recordAiSpendOutcome(
  tx: DbTransaction,
  input: {
    tenantId: string;
    reservationPublicId: string;
    outcome: AiSpendOutcome;
    reportedUsage?: AiSpendReportedUsage | null;
    actor: AiSpendActor;
    now?: Date;
  },
) {
  const row = await lockReservation(tx, input.tenantId, input.reservationPublicId);
  if (row.state !== "reserved" || !row.dispatchedAt) {
    throw new AiSpendStateError(
      `AI spend reservation ${row.publicId} cannot record an outcome while ${row.state}${row.dispatchedAt ? "" : " and undispatched"}.`,
    );
  }
  const reportedUsage = input.reportedUsage ? reportedUsageSchema.parse(input.reportedUsage) : null;
  const now = input.now ?? new Date();

  if (input.outcome === "submission_unknown") {
    const [updated] = await tx
      .update(aiSpendReservations)
      .set({ state: "uncertain", outcome: input.outcome, reportedUsage, updatedAt: now })
      .where(eq(aiSpendReservations.id, row.id))
      .returning();
    await auditSpend(tx, updated!, "ai_spend.uncertain", input.actor);
    return updated!;
  }

  const released = input.outcome === "not_dispatched" || input.outcome === "rejected";
  await returnCharges(tx, row, { includeQuota: released });
  const [updated] = await tx
    .update(aiSpendReservations)
    .set({
      state: released ? "released" : "consumed",
      outcome: input.outcome,
      reportedUsage,
      updatedAt: now,
      resolvedAt: now,
    })
    .where(eq(aiSpendReservations.id, row.id))
    .returning();
  return updated!;
}

/** Cancels admitted work before its dispatch began; returns everything. */
export async function releaseUnstartedAiSpend(
  tx: DbTransaction,
  input: { tenantId: string; reservationPublicId: string; now?: Date },
) {
  const row = await lockReservation(tx, input.tenantId, input.reservationPublicId);
  if (row.state !== "reserved" || row.dispatchedAt) {
    throw new AiSpendStateError(
      `AI spend reservation ${row.publicId} has started or finished and cannot be released.`,
    );
  }
  return releaseRow(tx, row, "released_unstarted", input.now ?? new Date());
}

async function releaseRow(
  tx: DbTransaction,
  row: AiSpendReservation,
  outcome: "released_unstarted" | "expired_unstarted",
  now: Date,
) {
  await returnCharges(tx, row, { includeQuota: true });
  const [updated] = await tx
    .update(aiSpendReservations)
    .set({ state: "released", outcome, updatedAt: now, resolvedAt: now })
    .where(eq(aiSpendReservations.id, row.id))
    .returning();
  return updated!;
}

/**
 * Releases expired reservations whose dispatch never began. Dispatched and
 * uncertain reservations are never touched, however old.
 */
export async function releaseExpiredUnstartedAiSpend(
  tx: DbTransaction,
  input: { tenantId: string; now?: Date },
) {
  const now = input.now ?? new Date();
  const expired = await tx
    .select()
    .from(aiSpendReservations)
    .where(
      and(
        eq(aiSpendReservations.tenantId, input.tenantId),
        eq(aiSpendReservations.state, "reserved"),
        isNull(aiSpendReservations.dispatchedAt),
        lte(aiSpendReservations.expiresAt, now),
      ),
    )
    .orderBy(aiSpendReservations.id)
    .for("update", { skipLocked: true });
  const released: AiSpendReservation[] = [];
  for (const row of expired) {
    released.push(await releaseRow(tx, row, "expired_unstarted", now));
  }
  return released;
}

/**
 * The only way out of "uncertain": a person (or a reconciler with provider
 * evidence) records whether the work was billed. Audited.
 */
export async function resolveUncertainAiSpend(
  tx: DbTransaction,
  input: {
    tenantId: string;
    reservationPublicId: string;
    resolution: "billed" | "not_billed";
    resolvedBy: AiSpendActor;
    reason: string;
    reportedUsage?: AiSpendReportedUsage | null;
    now?: Date;
  },
) {
  const reason = input.reason.trim();
  if (!reason || reason.length > 500) {
    throw new AiSpendStateError("A resolution reason of 1 to 500 characters is required.");
  }
  const row = await lockReservation(tx, input.tenantId, input.reservationPublicId);
  if (row.state !== "uncertain") {
    throw new AiSpendStateError(`AI spend reservation ${row.publicId} is ${row.state}, not uncertain.`);
  }
  const reportedUsage = input.reportedUsage
    ? reportedUsageSchema.parse(input.reportedUsage)
    : (row.reportedUsage as AiSpendReportedUsage | null);
  const now = input.now ?? new Date();
  const notBilled = input.resolution === "not_billed";

  await returnCharges(tx, row, { includeQuota: notBilled });
  const [updated] = await tx
    .update(aiSpendReservations)
    .set({
      state: notBilled ? "released" : "consumed",
      resolution: input.resolution,
      resolvedBySubject: input.resolvedBy.subject,
      reportedUsage,
      updatedAt: now,
      resolvedAt: now,
    })
    .where(eq(aiSpendReservations.id, row.id))
    .returning();
  await auditSpend(tx, updated!, "ai_spend.resolved", input.resolvedBy, {
    resolution: input.resolution,
    reason,
  });
  return updated!;
}
