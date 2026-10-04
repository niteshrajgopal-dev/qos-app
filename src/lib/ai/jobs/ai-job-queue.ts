import { randomBytes } from "node:crypto";

import { and, eq, gt, isNull, sql } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { aiJobAttempts, aiJobs } from "@/db/schema";
import type { ProviderOutcome } from "@/lib/ai/provider-outcome";
import { withTenantContext, type DbTransaction } from "@/lib/tenant/context";

/**
 * Durable AI job queue (ADR-AI-02 decision 14). Claims and heartbeats go
 * through SECURITY DEFINER functions owned by a dedicated NOLOGIN role; every
 * other read and write happens under the job's tenant context and is fenced
 * by the lease token, so a worker that lost its lease cannot commit anything.
 * No transaction is held across a provider call.
 */

export type AiJobKind = "menu_manager.run" | "ai_photo.generate";

export type ClaimedAiJob = {
  jobId: string;
  tenantId: string;
  jobPublicId: string;
  jobKind: AiJobKind;
  /** Null for jobs whose subject is not an agent run (AI photos point at a media asset). */
  agentRunId: string | null;
  leaseToken: string;
  leaseExpiresAt: Date;
  attemptNumber: number;
  /** An earlier attempt began dispatch and then lost its lease: the provider may have the work. */
  uncertainPriorDispatch: boolean;
};

/** What a job step decided. Only "reschedule" keeps the job alive. */
export type AiJobStepResult =
  | { type: "completed" }
  | { type: "reschedule"; delayMs: number; providerOutcome?: ProviderOutcome; code?: string }
  | { type: "failed"; code: string; message: string; providerOutcome?: ProviderOutcome }
  | { type: "operator_review"; code: string; message: string; providerOutcome?: ProviderOutcome };

export class AiJobLeaseLostError extends Error {
  constructor(jobPublicId: string) {
    super(`The lease on AI job ${jobPublicId} was lost.`);
    this.name = "AiJobLeaseLostError";
  }
}

export type AiJobClaimLimits = {
  leaseMs: number;
  maxActiveGlobal: number;
  maxActivePerTenant: number;
  maxActivePerKind: number;
};

function leaseSeconds(leaseMs: number) {
  return Math.max(5, Math.ceil(leaseMs / 1000));
}

/** Enqueues inside the transaction that accepts the work (decision 14: atomic admission). */
export async function enqueueAiJobInTx(
  tx: DbTransaction,
  input: { tenantId: string; jobKind: AiJobKind; now?: Date } & (
    | { agentRunId: string; mediaAssetId?: never }
    | { mediaAssetId: string; agentRunId?: never }
  ),
) {
  const now = input.now ?? new Date();
  const [job] = await tx
    .insert(aiJobs)
    .values({
      tenantId: input.tenantId,
      publicId: `job_${randomBytes(12).toString("hex")}`,
      jobKind: input.jobKind,
      agentRunId: input.agentRunId ?? null,
      mediaAssetId: input.mediaAssetId ?? null,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  return job!;
}

export async function getAiJobForRun(
  db: DbClient,
  tenantId: string,
  input: { jobKind: AiJobKind; agentRunId: string },
) {
  return withTenantContext(db, tenantId, async (tx) => {
    const [job] = await tx
      .select()
      .from(aiJobs)
      .where(
        and(
          eq(aiJobs.tenantId, tenantId),
          eq(aiJobs.jobKind, input.jobKind),
          eq(aiJobs.agentRunId, input.agentRunId),
        ),
      )
      .limit(1);
    return job ?? null;
  });
}

type ClaimRow = {
  job_id: string;
  tenant_id: string;
  job_public_id: string;
  job_kind: AiJobKind;
  agent_run_id: string | null;
  lease_token: string;
  lease_expires_at: string | Date;
  attempt_number: number;
  uncertain_prior_dispatch: boolean;
};

export async function claimNextAiJob(
  db: DbClient,
  input: { workerId: string; jobKinds: readonly AiJobKind[]; limits: AiJobClaimLimits },
): Promise<ClaimedAiJob | null> {
  const kinds = sql`ARRAY[${sql.join(
    input.jobKinds.map((kind) => sql`${kind}`),
    sql`, `,
  )}]::text[]`;
  const rows = await db.execute<ClaimRow>(
    sql`select * from qos.claim_next_ai_job(${input.workerId}, ${kinds}, ${leaseSeconds(input.limits.leaseMs)}::int, ${input.limits.maxActiveGlobal}::int, ${input.limits.maxActivePerTenant}::int, ${input.limits.maxActivePerKind}::int)`,
  );
  const row = rows[0];
  if (!row) {
    return null;
  }
  return {
    jobId: row.job_id,
    tenantId: row.tenant_id,
    jobPublicId: row.job_public_id,
    jobKind: row.job_kind,
    agentRunId: row.agent_run_id,
    leaseToken: row.lease_token,
    leaseExpiresAt: new Date(row.lease_expires_at),
    attemptNumber: Number(row.attempt_number),
    uncertainPriorDispatch: row.uncertain_prior_dispatch,
  };
}

/** Extends the lease; null when it was already lost. */
export async function heartbeatAiJob(db: DbClient, job: ClaimedAiJob, leaseMs: number) {
  const rows = await db.execute<{ expires: string | Date | null }>(
    sql`select qos.heartbeat_ai_job(${job.jobId}::uuid, ${job.leaseToken}::uuid, ${leaseSeconds(leaseMs)}::int) as expires`,
  );
  const expires = rows[0]?.expires;
  return expires ? new Date(expires) : null;
}

/** Lease expiry is judged by the database clock, the same clock that granted it. */
function leaseHeld(job: ClaimedAiJob) {
  return and(
    eq(aiJobs.tenantId, job.tenantId),
    eq(aiJobs.id, job.jobId),
    eq(aiJobs.status, "leased"),
    eq(aiJobs.leaseToken, job.leaseToken),
    gt(aiJobs.leaseExpiresAt, sql`clock_timestamp()`),
  );
}

/**
 * Fences a write: inside the caller's tenant transaction, holds the job row
 * until commit and throws if this worker no longer has the lease.
 */
export async function lockLeasedAiJobInTx(tx: DbTransaction, job: ClaimedAiJob) {
  const [row] = await tx
    .select({ id: aiJobs.id, mediaAssetId: aiJobs.mediaAssetId })
    .from(aiJobs)
    .where(leaseHeld(job))
    .limit(1)
    .for("update");
  if (!row) {
    throw new AiJobLeaseLostError(job.jobPublicId);
  }
  return row;
}


/**
 * Records that this attempt is about to contact the provider. Must commit
 * before the call: after a crash it is the evidence that paid work may exist.
 */
export async function markAiJobDispatched(db: DbClient, job: ClaimedAiJob, now: Date = new Date()) {
  await withTenantContext(db, job.tenantId, async (tx) => {
    await lockLeasedAiJobInTx(tx, job);
    await tx
      .update(aiJobAttempts)
      .set({ dispatchedAt: now })
      .where(
        and(
          eq(aiJobAttempts.tenantId, job.tenantId),
          eq(aiJobAttempts.leaseToken, job.leaseToken),
          isNull(aiJobAttempts.dispatchedAt),
        ),
      );
  });
}

/** Commits a step result, but only while this worker still holds the lease. */
export async function finishAiJobStep(
  db: DbClient,
  job: ClaimedAiJob,
  result: AiJobStepResult,
  now: Date = new Date(),
) {
  return withTenantContext(db, job.tenantId, async (tx) => {
    await lockLeasedAiJobInTx(tx, job);
    const attemptOutcome = result.type === "reschedule" ? "rescheduled" : result.type;
    await tx
      .update(aiJobAttempts)
      .set({
        finishedAt: now,
        outcome: attemptOutcome,
        providerOutcome: "providerOutcome" in result ? (result.providerOutcome ?? null) : null,
        errorCode: "code" in result ? (result.code?.slice(0, 100) ?? null) : null,
      })
      .where(and(eq(aiJobAttempts.tenantId, job.tenantId), eq(aiJobAttempts.leaseToken, job.leaseToken)));

    const released = { leaseToken: null, leaseOwner: null, leaseExpiresAt: null, updatedAt: now };
    const [updated] = await tx
      .update(aiJobs)
      .set(
        result.type === "reschedule"
          ? {
              ...released,
              status: "queued",
              nextAttemptAt: new Date(now.getTime() + Math.max(0, result.delayMs)),
              lastErrorCode: result.code ?? null,
              lastErrorMessage: null,
            }
          : {
              ...released,
              status: result.type,
              finishedAt: now,
              lastErrorCode: result.type === "completed" ? null : result.code.slice(0, 100),
              lastErrorMessage: result.type === "completed" ? null : result.message.slice(0, 2000),
            },
      )
      .where(eq(aiJobs.id, job.jobId))
      .returning();
    return updated!;
  });
}

/**
 * Cancels the job if no worker ever claimed it, inside the caller's tenant
 * transaction. True only when the work is proven never dispatched.
 */
export async function cancelUnclaimedAiJobInTx(
  tx: DbTransaction,
  input: { jobPublicId: string; code: string; message: string },
) {
  const rows = await tx.execute<{ cancelled: boolean }>(
    sql`select qos.cancel_queued_ai_job(${input.jobPublicId}, ${input.code}, ${input.message}) as cancelled`,
  );
  return rows[0]?.cancelled === true;
}
