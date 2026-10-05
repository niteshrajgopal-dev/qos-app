import { parseArgs } from "node:util";

import { and, asc, eq } from "drizzle-orm";

import { aiSpendPlatformCounters, aiSpendReservations, aiSpendTenantCounters } from "@/db/schema";
import { isAiSpendPath, type AiSpendPath } from "@/lib/ai/spend/spend-policy";
import type { DbTransaction } from "@/lib/tenant/context";

export const AI_SPEND_QUOTA_KIND = "application_quota" as const;

const CONCURRENCY_WINDOW = "1970-01-01";
const USAGE_KEY = /^[a-z][a-z0-9_]{0,63}$/;
const DUE_UNCERTAIN_LIMIT = 200;

export type AiSpendUsageBuckets = {
  reserved: number;
  consumed: number;
  released: number;
  uncertain: number;
};

export type AiSpendUsageSummary = {
  path: AiSpendPath;
  asOf: string;
  tenantId: string | null;
  quotaKind: typeof AI_SPEND_QUOTA_KIND;
  reservations: AiSpendUsageBuckets;
  units: AiSpendUsageBuckets;
  reportedUsage: Record<string, number>;
  estimatedCostMicros: number | null;
  uncertain: number;
  counters: {
    platformDaily: number;
    platformMonthly: number;
    platformConcurrency: number;
    providerConcurrency: number;
    tenantDaily: number | null;
    tenantMonthly: number | null;
    tenantConcurrency: number | null;
  };
};

export type AiSpendDueUncertain = {
  reservationPublicId: string;
  tenantId: string;
  path: string;
  provider: string;
  subjectType: string;
  subjectPublicId: string;
  units: number;
  reportedUsage: Record<string, number> | null;
  updatedAt: Date;
  ageMs: number;
};

export type AiSpendUsageSnapshotEvent = {
  event: "ai_spend.usage_snapshot";
  tenantId: string;
  path: string;
  reservations: AiSpendUsageBuckets;
  units: AiSpendUsageBuckets;
  uncertain: number;
  quotaKind: typeof AI_SPEND_QUOTA_KIND;
};

export type AiSpendOperatorCommand =
  | { command: "usage"; databaseHost: string; tenantId?: string; path: AiSpendPath }
  | { command: "due-uncertain"; databaseHost: string; tenantId?: string }
  | {
      command: "resolve";
      databaseHost: string;
      tenantId: string;
      reservationPublicId: string;
      resolution: "billed" | "not_billed";
      reason: string;
      operator: string;
    };

function utcDay(now: Date) {
  return now.toISOString().slice(0, 10);
}

function utcMonth(now: Date) {
  return `${now.toISOString().slice(0, 7)}-01`;
}

function isBucketState(value: string): value is keyof AiSpendUsageBuckets {
  return value === "reserved" || value === "consumed" || value === "released" || value === "uncertain";
}

function requireFlag(values: Record<string, string | boolean | undefined>, name: string) {
  const value = values[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`--${name} is required.`);
  }
  return value.trim();
}

export function emptyAiSpendUsageBuckets(): AiSpendUsageBuckets {
  return { reserved: 0, consumed: 0, released: 0, uncertain: 0 };
}

export function addAiSpendReservationToBuckets(
  buckets: { reservations: AiSpendUsageBuckets; units: AiSpendUsageBuckets },
  state: keyof AiSpendUsageBuckets,
  units: number,
) {
  buckets.reservations[state] += 1;
  buckets.units[state] += units;
}

export function mergeReportedUsage(into: Record<string, number>, usage: unknown) {
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) {
    return;
  }
  for (const [key, value] of Object.entries(usage)) {
    if (!USAGE_KEY.test(key) || typeof value !== "number" || !Number.isInteger(value) || value < 0) {
      continue;
    }
    if (!(key in into) && Object.keys(into).length >= 32) {
      continue;
    }
    into[key] = (into[key] ?? 0) + value;
  }
}

export function usageSnapshotEvent(summary: AiSpendUsageSummary): AiSpendUsageSnapshotEvent {
  if (!summary.tenantId) {
    throw new Error("A tenant is required to emit an AI spend usage snapshot.");
  }
  return {
    event: "ai_spend.usage_snapshot",
    tenantId: summary.tenantId,
    path: summary.path,
    reservations: summary.reservations,
    units: summary.units,
    uncertain: summary.uncertain,
    quotaKind: AI_SPEND_QUOTA_KIND,
  };
}

export function parseAiSpendOperatorArgs(argv: string[]): AiSpendOperatorCommand {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      "database-host": { type: "string" },
      tenant: { type: "string" },
      path: { type: "string" },
      reservation: { type: "string" },
      resolution: { type: "string" },
      reason: { type: "string" },
      operator: { type: "string" },
    },
  });
  const command = positionals[0];
  const databaseHost = requireFlag(values, "database-host");
  const tenantId = typeof values.tenant === "string" && values.tenant.trim() ? values.tenant.trim() : undefined;

  if (command === "usage") {
    const pathValue = typeof values.path === "string" && values.path.trim() ? values.path.trim() : "ai_photo.async";
    if (!isAiSpendPath(pathValue)) {
      throw new Error(`Unknown AI spend path ${pathValue}.`);
    }
    return tenantId ? { command, databaseHost, tenantId, path: pathValue } : { command, databaseHost, path: pathValue };
  }

  if (command === "due-uncertain") {
    return tenantId ? { command, databaseHost, tenantId } : { command, databaseHost };
  }

  if (command === "resolve") {
    const resolution = requireFlag(values, "resolution");
    if (resolution !== "billed" && resolution !== "not_billed") {
      throw new Error("Resolution must be billed or not_billed.");
    }
    const reason = typeof values.reason === "string" ? values.reason.trim() : "";
    if (reason.length < 1 || reason.length > 500) {
      throw new Error("A resolution reason of 1 to 500 characters is required.");
    }
    return {
      command,
      databaseHost,
      tenantId: requireFlag(values, "tenant"),
      reservationPublicId: requireFlag(values, "reservation"),
      resolution,
      reason,
      operator: requireFlag(values, "operator"),
    };
  }

  throw new Error("Command must be usage, due-uncertain, or resolve.");
}

async function platformCounter(
  tx: DbTransaction,
  input: { scopeKey: string; windowStart: string },
): Promise<number> {
  const [row] = await tx
    .select({ units: aiSpendPlatformCounters.units })
    .from(aiSpendPlatformCounters)
    .where(
      and(eq(aiSpendPlatformCounters.scopeKey, input.scopeKey), eq(aiSpendPlatformCounters.windowStart, input.windowStart)),
    )
    .limit(1);
  return row?.units ?? 0;
}

async function tenantCounter(
  tx: DbTransaction,
  input: { tenantId?: string; scopeKey: string; windowStart: string },
): Promise<number | null> {
  if (!input.tenantId) {
    return null;
  }
  const [row] = await tx
    .select({ units: aiSpendTenantCounters.units })
    .from(aiSpendTenantCounters)
    .where(
      and(
        eq(aiSpendTenantCounters.tenantId, input.tenantId),
        eq(aiSpendTenantCounters.scopeKey, input.scopeKey),
        eq(aiSpendTenantCounters.windowStart, input.windowStart),
      ),
    )
    .limit(1);
  return row?.units ?? 0;
}

export async function summarizeAiSpendUsage(
  tx: DbTransaction,
  input: { path: AiSpendPath; tenantId?: string; now?: Date; provider?: "openai" },
): Promise<AiSpendUsageSummary> {
  const now = input.now ?? new Date();
  const provider = input.provider ?? "openai";
  const filters = [eq(aiSpendReservations.path, input.path)];
  if (input.tenantId) {
    filters.push(eq(aiSpendReservations.tenantId, input.tenantId));
  }
  const rows = await tx
    .select()
    .from(aiSpendReservations)
    .where(and(...filters));

  const buckets = { reservations: emptyAiSpendUsageBuckets(), units: emptyAiSpendUsageBuckets() };
  const reportedUsage: Record<string, number> = {};
  let estimatedCostMicros: number | null = null;
  for (const row of rows) {
    if (isBucketState(row.state)) {
      addAiSpendReservationToBuckets(buckets, row.state, row.units);
    }
    mergeReportedUsage(reportedUsage, row.reportedUsage);
    if (row.estimatedCostMicros != null) {
      estimatedCostMicros = (estimatedCostMicros ?? 0) + row.estimatedCostMicros;
    }
  }

  const daily = utcDay(now);
  const monthly = utcMonth(now);
  return {
    path: input.path,
    asOf: now.toISOString(),
    tenantId: input.tenantId ?? null,
    quotaKind: AI_SPEND_QUOTA_KIND,
    reservations: buckets.reservations,
    units: buckets.units,
    reportedUsage,
    estimatedCostMicros,
    uncertain: buckets.reservations.uncertain,
    counters: {
      platformDaily: await platformCounter(tx, { scopeKey: `path:${input.path}:daily`, windowStart: daily }),
      platformMonthly: await platformCounter(tx, { scopeKey: `path:${input.path}:monthly`, windowStart: monthly }),
      platformConcurrency: await platformCounter(tx, {
        scopeKey: "platform:concurrency",
        windowStart: CONCURRENCY_WINDOW,
      }),
      providerConcurrency: await platformCounter(tx, {
        scopeKey: `provider:${provider}:concurrency`,
        windowStart: CONCURRENCY_WINDOW,
      }),
      tenantDaily: await tenantCounter(tx, {
        tenantId: input.tenantId,
        scopeKey: `path:${input.path}:daily`,
        windowStart: daily,
      }),
      tenantMonthly: await tenantCounter(tx, {
        tenantId: input.tenantId,
        scopeKey: `path:${input.path}:monthly`,
        windowStart: monthly,
      }),
      tenantConcurrency: await tenantCounter(tx, {
        tenantId: input.tenantId,
        scopeKey: `path:${input.path}:concurrency`,
        windowStart: CONCURRENCY_WINDOW,
      }),
    },
  };
}

export async function listDueUncertainAiSpend(
  tx: DbTransaction,
  input: { tenantId?: string; now?: Date; limit?: number } = {},
): Promise<AiSpendDueUncertain[]> {
  const now = input.now ?? new Date();
  const filters = [eq(aiSpendReservations.state, "uncertain")];
  if (input.tenantId) {
    filters.push(eq(aiSpendReservations.tenantId, input.tenantId));
  }
  const rows = await tx
    .select()
    .from(aiSpendReservations)
    .where(and(...filters))
    .orderBy(asc(aiSpendReservations.updatedAt), asc(aiSpendReservations.id))
    .limit(input.limit ?? DUE_UNCERTAIN_LIMIT);

  return rows.map((row) => {
    const reportedUsage: Record<string, number> = {};
    mergeReportedUsage(reportedUsage, row.reportedUsage);
    return {
      reservationPublicId: row.publicId,
      tenantId: row.tenantId,
      path: row.path,
      provider: row.provider,
      subjectType: row.subjectType,
      subjectPublicId: row.subjectPublicId,
      units: row.units,
      reportedUsage: Object.keys(reportedUsage).length > 0 ? reportedUsage : null,
      updatedAt: row.updatedAt,
      ageMs: Math.max(0, now.getTime() - row.updatedAt.getTime()),
    };
  });
}
