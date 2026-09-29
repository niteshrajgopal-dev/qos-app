import { randomBytes, randomUUID } from "node:crypto";

import { and, desc, eq, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { agentRuns } from "@/db/schema";
import type { TenantAgentBinding } from "@/lib/agents/tenant-agent-bindings";
import {
  AgentProviderError,
  type AgentCapability,
  type AgentRunObservation,
  type AgentRunStatus,
  type AgentRuntimeProvider,
} from "@/lib/agents/types";
import {
  recordTenantAuditEventInTx,
  type AuditActorClass,
} from "@/lib/audit/tenant-audit";
import { withTenantContext, type TenantDbExecutor } from "@/lib/tenant/context";

export const RAW_RESULT_EXCERPT_MAX_CHARS = 16_384;
const FAILURE_MESSAGE_MAX_CHARS = 2_000;
const SYSTEM_ACTOR = { subject: "qos.agent-runtime", actorClass: "system" as const };

type AgentRunRow = typeof agentRuns.$inferSelect;

/** Browser-safe run view: no provider thread id, idempotency key or raw output. */
export type AgentRunView = {
  publicId: string;
  capability: AgentCapability;
  status: AgentRunStatus;
  subjectType: string;
  subjectPublicId: string;
  subjectVersion: number | null;
  result: Record<string, unknown> | null;
  failureCode: string | null;
  failureMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  deadlineAt: string;
  nextPollAt: string | null;
};

export type AgentRunRecord = AgentRunView & {
  id: string;
  providerAgentId: string;
  providerThreadId: string | null;
  correlationId: string;
  requestedBySubject: string;
};

export class AgentRunError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly activeRunPublicId?: string;

  constructor(
    code: string,
    message: string,
    statusCode: number,
    options: { activeRunPublicId?: string } = {},
  ) {
    super(message);
    this.name = "AgentRunError";
    this.code = code;
    this.statusCode = statusCode;
    this.activeRunPublicId = options.activeRunPublicId;
  }
}

function iso(value: Date | null) {
  return value ? value.toISOString() : null;
}

function toRecord(row: AgentRunRow): AgentRunRecord {
  return {
    id: row.id,
    publicId: row.publicId,
    capability: row.capability,
    status: row.status,
    subjectType: row.subjectType,
    subjectPublicId: row.subjectPublicId,
    subjectVersion: row.subjectVersion,
    result: row.result ?? null,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    deadlineAt: row.deadlineAt.toISOString(),
    nextPollAt: iso(row.nextPollAt),
    providerAgentId: row.providerAgentId,
    providerThreadId: row.providerThreadId,
    correlationId: row.correlationId,
    requestedBySubject: row.requestedBySubject,
  };
}

export function toAgentRunView(run: AgentRunRecord): AgentRunView {
  return {
    publicId: run.publicId,
    capability: run.capability,
    status: run.status,
    subjectType: run.subjectType,
    subjectPublicId: run.subjectPublicId,
    subjectVersion: run.subjectVersion,
    result: run.result,
    failureCode: run.failureCode,
    failureMessage: run.failureMessage,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    deadlineAt: run.deadlineAt,
    nextPollAt: run.nextPollAt,
  };
}

export function boundRawResultExcerpt(raw: string | null | undefined) {
  if (raw == null) {
    return null;
  }
  return raw.length > RAW_RESULT_EXCERPT_MAX_CHARS
    ? raw.slice(0, RAW_RESULT_EXCERPT_MAX_CHARS)
    : raw;
}

function boundFailureMessage(message: string) {
  return message.slice(0, FAILURE_MESSAGE_MAX_CHARS);
}

async function loadRunRow(tx: TenantDbExecutor, tenantId: string, runPublicId: string) {
  const [row] = await tx
    .select()
    .from(agentRuns)
    .where(and(eq(agentRuns.tenantId, tenantId), eq(agentRuns.publicId, runPublicId)))
    .limit(1);
  return row ?? null;
}

async function requireRunRow(tx: TenantDbExecutor, tenantId: string, runPublicId: string) {
  const row = await loadRunRow(tx, tenantId, runPublicId);
  if (!row) {
    throw new AgentRunError("run_not_found", "Agent run not found.", 404);
  }
  return row;
}

async function auditRun(
  tx: TenantDbExecutor,
  row: AgentRunRow,
  action:
    | "agent_run.requested"
    | "agent_run.started"
    | "agent_run.completed"
    | "agent_run.failed",
  actor: { subject: string; actorClass: AuditActorClass },
  changeSummary: Record<string, unknown>,
) {
  await recordTenantAuditEventInTx(tx, {
    tenantId: row.tenantId,
    actorSubject: actor.subject,
    actorClass: actor.actorClass,
    action,
    entityType: "agent_run",
    entityPublicId: row.publicId,
    correlationId: row.correlationId,
    changeSummary: {
      capability: row.capability,
      subjectType: row.subjectType,
      subjectPublicId: row.subjectPublicId,
      subjectVersion: row.subjectVersion,
      status: row.status,
      ...changeSummary,
    },
  });
}

export type CreateAgentRunInput = {
  tenantId: string;
  binding: TenantAgentBinding;
  subject: { type: string; publicId: string; version: number | null };
  requestedBy: { subject: string; actorClass: AuditActorClass };
  idempotencyKey: string;
  /** Small, non-sensitive facts about the request. Never the full snapshot. */
  requestSummary: Record<string, unknown>;
  runTimeoutMs: number;
  now?: Date;
};

/**
 * Creates a queued run. Replaying the same idempotency key returns the
 * original run; a second concurrent run for the same subject is rejected.
 */
export async function createAgentRun(
  db: DbClient,
  input: CreateAgentRunInput,
): Promise<{ run: AgentRunRecord; created: boolean }> {
  const key = input.idempotencyKey.trim();
  if (key.length < 8 || key.length > 200) {
    throw new AgentRunError(
      "invalid_idempotency_key",
      "idempotencyKey must be between 8 and 200 characters.",
      400,
    );
  }

  if (!input.binding.enabled) {
    throw new AgentRunError(
      "capability_disabled",
      "This agent capability is disabled for the business.",
      409,
    );
  }

  const now = input.now ?? new Date();

  return withTenantContext(db, input.tenantId, async (tx) => {
    const [inserted] = await tx
      .insert(agentRuns)
      .values({
        tenantId: input.tenantId,
        publicId: `run_${randomBytes(12).toString("hex")}`,
        bindingId: input.binding.id,
        capability: input.binding.capability,
        provider: input.binding.provider,
        providerAgentId: input.binding.providerAgentId,
        status: "queued",
        subjectType: input.subject.type,
        subjectPublicId: input.subject.publicId,
        subjectVersion: input.subject.version,
        requestedBySubject: input.requestedBy.subject,
        requestedByActorClass: input.requestedBy.actorClass,
        idempotencyKey: key,
        correlationId: randomUUID(),
        requestSummary: input.requestSummary,
        deadlineAt: new Date(now.getTime() + input.runTimeoutMs),
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoNothing()
      .returning();

    if (inserted) {
      await auditRun(tx, inserted, "agent_run.requested", input.requestedBy, {
        providerAgentId: inserted.providerAgentId,
        request: input.requestSummary,
      });
      return { run: toRecord(inserted), created: true };
    }

    const [replay] = await tx
      .select()
      .from(agentRuns)
      .where(and(eq(agentRuns.tenantId, input.tenantId), eq(agentRuns.idempotencyKey, key)))
      .limit(1);

    if (replay) {
      if (
        replay.capability !== input.binding.capability ||
        replay.subjectType !== input.subject.type ||
        replay.subjectPublicId !== input.subject.publicId ||
        replay.requestedBySubject !== input.requestedBy.subject
      ) {
        throw new AgentRunError(
          "idempotency_key_reused",
          "idempotencyKey was already used for a different request.",
          409,
        );
      }
      return { run: toRecord(replay), created: false };
    }

    const [active] = await tx
      .select({ publicId: agentRuns.publicId })
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.tenantId, input.tenantId),
          eq(agentRuns.capability, input.binding.capability),
          eq(agentRuns.subjectType, input.subject.type),
          eq(agentRuns.subjectPublicId, input.subject.publicId),
          inArray(agentRuns.status, ["queued", "running"]),
        ),
      )
      .limit(1);

    throw new AgentRunError(
      "run_in_progress",
      "An agent run is already in progress for this item.",
      409,
      { activeRunPublicId: active?.publicId },
    );
  });
}

/** queued -> running once the provider has accepted the run. */
export async function markAgentRunStarted(
  db: DbClient,
  tenantId: string,
  runPublicId: string,
  input: {
    providerThreadId: string;
    actor: { subject: string; actorClass: AuditActorClass };
    pollIntervalMs: number;
    now?: Date;
  },
): Promise<AgentRunRecord> {
  const now = input.now ?? new Date();

  return withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx
      .update(agentRuns)
      .set({
        status: "running",
        providerThreadId: input.providerThreadId,
        startedAt: now,
        nextPollAt: new Date(now.getTime() + input.pollIntervalMs),
        updatedAt: now,
      })
      .where(
        and(
          eq(agentRuns.tenantId, tenantId),
          eq(agentRuns.publicId, runPublicId),
          eq(agentRuns.status, "queued"),
        ),
      )
      .returning();

    if (!row) {
      return toRecord(await requireRunRow(tx, tenantId, runPublicId));
    }

    await auditRun(tx, row, "agent_run.started", input.actor, {});
    return toRecord(row);
  });
}

async function failRunInTx(
  tx: TenantDbExecutor,
  tenantId: string,
  runPublicId: string,
  input: {
    code: string;
    message: string;
    rawResultExcerpt?: string | null;
    now: Date;
    extraWhere?: ReturnType<typeof and>;
  },
) {
  const [row] = await tx
    .update(agentRuns)
    .set({
      status: "failed",
      failureCode: input.code.slice(0, 100),
      failureMessage: boundFailureMessage(input.message),
      rawResultExcerpt: boundRawResultExcerpt(input.rawResultExcerpt),
      pollLeaseOwner: null,
      pollLeaseExpiresAt: null,
      nextPollAt: null,
      finishedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(agentRuns.tenantId, tenantId),
        eq(agentRuns.publicId, runPublicId),
        inArray(agentRuns.status, ["queued", "running"]),
        input.extraWhere,
      ),
    )
    .returning();

  if (row) {
    await auditRun(tx, row, "agent_run.failed", SYSTEM_ACTOR, {
      failureCode: row.failureCode,
    });
  }

  return row ?? null;
}

/** Fails a queued or running run. No-op for runs that already finished. */
export async function markAgentRunFailed(
  db: DbClient,
  tenantId: string,
  runPublicId: string,
  input: { code: string; message: string; rawResultExcerpt?: string | null; now?: Date },
): Promise<AgentRunRecord> {
  const now = input.now ?? new Date();
  return withTenantContext(db, tenantId, async (tx) => {
    const failed = await failRunInTx(tx, tenantId, runPublicId, { ...input, now });
    return toRecord(failed ?? (await requireRunRow(tx, tenantId, runPublicId)));
  });
}

export type ClaimAgentRunPollResult =
  | { claimed: true; run: AgentRunRecord }
  | { claimed: false; run: AgentRunRecord };

/**
 * Applies the hard deadline and stale-start rules, then tries to take the poll
 * lease. Only one caller across tabs and replicas wins per poll interval.
 */
export async function claimAgentRunPoll(
  db: DbClient,
  tenantId: string,
  runPublicId: string,
  input: { owner: string; leaseMs: number; queuedStaleMs: number; now?: Date },
): Promise<ClaimAgentRunPollResult> {
  const now = input.now ?? new Date();

  return withTenantContext(db, tenantId, async (tx) => {
    await failRunInTx(tx, tenantId, runPublicId, {
      code: "timeout",
      message: "The agent did not finish before the run deadline.",
      now,
      extraWhere: and(eq(agentRuns.status, "running"), lte(agentRuns.deadlineAt, now)),
    });

    await failRunInTx(tx, tenantId, runPublicId, {
      code: "start_not_recorded",
      message: "The agent run was not started with the provider in time.",
      now,
      extraWhere: and(
        eq(agentRuns.status, "queued"),
        lte(agentRuns.createdAt, new Date(now.getTime() - input.queuedStaleMs)),
      ),
    });

    const [claimed] = await tx
      .update(agentRuns)
      .set({
        pollLeaseOwner: input.owner,
        pollLeaseExpiresAt: new Date(now.getTime() + input.leaseMs),
        lastPolledAt: now,
        pollCount: sql`${agentRuns.pollCount} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(agentRuns.tenantId, tenantId),
          eq(agentRuns.publicId, runPublicId),
          eq(agentRuns.status, "running"),
          or(isNull(agentRuns.nextPollAt), lte(agentRuns.nextPollAt, now)),
          or(isNull(agentRuns.pollLeaseExpiresAt), lt(agentRuns.pollLeaseExpiresAt, now)),
        ),
      )
      .returning();

    if (claimed) {
      return { claimed: true, run: toRecord(claimed) };
    }

    return { claimed: false, run: toRecord(await requireRunRow(tx, tenantId, runPublicId)) };
  });
}

export type AgentRunOutcome =
  | { state: "running" }
  | { state: "awaiting_approval" }
  | {
      state: "completed";
      result: Record<string, unknown>;
      /** Small counts for the audit trail; never the full result. */
      auditSummary?: Record<string, unknown>;
    }
  | { state: "failed"; code: string; message: string; rawResultExcerpt?: string | null };

/**
 * Persists what one poll observed and releases the lease in the same write.
 * Returns `recorded: false` if this caller no longer holds the lease.
 */
export async function recordAgentRunOutcome(
  db: DbClient,
  tenantId: string,
  runPublicId: string,
  input: { owner: string; outcome: AgentRunOutcome; pollIntervalMs: number; now?: Date },
): Promise<{ recorded: boolean; run: AgentRunRecord }> {
  const now = input.now ?? new Date();
  const heldLease = and(
    eq(agentRuns.tenantId, tenantId),
    eq(agentRuns.publicId, runPublicId),
    eq(agentRuns.status, "running"),
    eq(agentRuns.pollLeaseOwner, input.owner),
  );
  const releaseLease = { pollLeaseOwner: null, pollLeaseExpiresAt: null, updatedAt: now };

  return withTenantContext(db, tenantId, async (tx) => {
    const outcome = input.outcome;
    let row: AgentRunRow | undefined;

    if (outcome.state === "running") {
      [row] = await tx
        .update(agentRuns)
        .set({ ...releaseLease, nextPollAt: new Date(now.getTime() + input.pollIntervalMs) })
        .where(heldLease)
        .returning();
    } else if (outcome.state === "awaiting_approval") {
      [row] = await tx
        .update(agentRuns)
        .set({ ...releaseLease, status: "awaiting_approval", nextPollAt: null })
        .where(heldLease)
        .returning();
    } else if (outcome.state === "completed") {
      [row] = await tx
        .update(agentRuns)
        .set({
          ...releaseLease,
          status: "completed",
          result: outcome.result,
          nextPollAt: null,
          finishedAt: now,
        })
        .where(heldLease)
        .returning();
      if (row) {
        await auditRun(tx, row, "agent_run.completed", SYSTEM_ACTOR, outcome.auditSummary ?? {});
      }
    } else {
      [row] = await tx
        .update(agentRuns)
        .set({
          ...releaseLease,
          status: "failed",
          failureCode: outcome.code.slice(0, 100),
          failureMessage: boundFailureMessage(outcome.message),
          rawResultExcerpt: boundRawResultExcerpt(outcome.rawResultExcerpt),
          nextPollAt: null,
          finishedAt: now,
        })
        .where(heldLease)
        .returning();
      if (row) {
        await auditRun(tx, row, "agent_run.failed", SYSTEM_ACTOR, {
          failureCode: row.failureCode,
        });
      }
    }

    if (!row) {
      return { recorded: false, run: toRecord(await requireRunRow(tx, tenantId, runPublicId)) };
    }

    return { recorded: true, run: toRecord(row) };
  });
}

export type CompletionInterpretation =
  | { ok: true; result: Record<string, unknown>; auditSummary?: Record<string, unknown> }
  | { ok: false; code: string; message: string; rawResultExcerpt: string };

/**
 * One bounded poll: claim the lease, ask the provider once, persist the
 * outcome. Callers must have authorized the requester before calling.
 * `interpretCompletion` validates the untrusted final message.
 */
export async function pollAgentRunOnce(
  db: DbClient,
  tenantId: string,
  runPublicId: string,
  input: {
    provider: AgentRuntimeProvider;
    owner: string;
    pollIntervalMs: number;
    leaseMs: number;
    queuedStaleMs: number;
    interpretCompletion: (finalMessage: string) => CompletionInterpretation;
    onReauthRequired?: (error: AgentProviderError) => Promise<void>;
    now?: () => Date;
  },
): Promise<{ polled: boolean; run: AgentRunRecord }> {
  const clock = input.now ?? (() => new Date());
  const claim = await claimAgentRunPoll(db, tenantId, runPublicId, {
    owner: input.owner,
    leaseMs: input.leaseMs,
    queuedStaleMs: input.queuedStaleMs,
    now: clock(),
  });

  if (!claim.claimed || !claim.run.providerThreadId) {
    return { polled: false, run: claim.run };
  }

  let outcome: AgentRunOutcome;
  try {
    const observation: AgentRunObservation = await input.provider.getRun({
      providerThreadId: claim.run.providerThreadId,
    });
    outcome = outcomeFromObservation(observation, input.interpretCompletion);
  } catch (error) {
    if (!(error instanceof AgentProviderError)) {
      throw error;
    }
    if (error.requiresReauth) {
      await input.onReauthRequired?.(error);
      outcome = {
        state: "failed",
        code: "provider_reauth_required",
        message: "The platform agent connection needs to be re-authorized by QOS.",
      };
    } else {
      outcome = { state: "running" };
    }
  }

  const recorded = await recordAgentRunOutcome(db, tenantId, runPublicId, {
    owner: input.owner,
    outcome,
    pollIntervalMs: input.pollIntervalMs,
    now: clock(),
  });

  return { polled: recorded.recorded, run: recorded.run };
}

function outcomeFromObservation(
  observation: AgentRunObservation,
  interpretCompletion: (finalMessage: string) => CompletionInterpretation,
): AgentRunOutcome {
  switch (observation.state) {
    case "running":
      return { state: "running" };
    case "awaiting_approval":
      return { state: "awaiting_approval" };
    case "failed":
      return { state: "failed", code: observation.code, message: observation.message };
    case "completed": {
      const interpreted = interpretCompletion(observation.finalMessage);
      if (interpreted.ok) {
        return {
          state: "completed",
          result: interpreted.result,
          auditSummary: interpreted.auditSummary,
        };
      }
      return {
        state: "failed",
        code: interpreted.code,
        message: interpreted.message,
        rawResultExcerpt: interpreted.rawResultExcerpt,
      };
    }
  }
}

export async function getAgentRun(
  db: DbClient,
  tenantId: string,
  runPublicId: string,
): Promise<AgentRunRecord> {
  return withTenantContext(db, tenantId, async (tx) =>
    toRecord(await requireRunRow(tx, tenantId, runPublicId)),
  );
}

export async function getLatestAgentRunForSubject(
  db: DbClient,
  tenantId: string,
  input: { capability: AgentCapability; subjectType: string; subjectPublicId: string },
): Promise<AgentRunRecord | null> {
  return withTenantContext(db, tenantId, async (tx) => {
    const [row] = await tx
      .select()
      .from(agentRuns)
      .where(
        and(
          eq(agentRuns.tenantId, tenantId),
          eq(agentRuns.capability, input.capability),
          eq(agentRuns.subjectType, input.subjectType),
          eq(agentRuns.subjectPublicId, input.subjectPublicId),
        ),
      )
      .orderBy(desc(agentRuns.createdAt))
      .limit(1);
    return row ? toRecord(row) : null;
  });
}
