import type { DbClient } from "@/db/client";
import type { aiJobs } from "@/db/schema";
import {
  expireAgentRunIfDue,
  failQueuedAgentRunInTx,
  getAgentRun,
  markAgentRunFailed,
  NOT_STARTED_IN_TIME_CODE,
  NOT_STARTED_IN_TIME_MESSAGE,
  type AgentRunConfig,
  type AgentRunRecord,
} from "@/lib/agents/agent-runs";
import type { AgentRunStatus } from "@/lib/agents/types";
import {
  MENU_MANAGER_MAX_JOB_ATTEMPTS,
  WORKER_STOPPED_MID_REVIEW_CODE,
  WORKER_STOPPED_MID_REVIEW_MESSAGE,
} from "@/lib/agents/menu-manager/menu-manager-worker-limits";
import {
  cancelUnclaimedAiJobInTx,
  getAiJobForRun,
  type AiJobKind,
} from "@/lib/ai/jobs/ai-job-queue";
import { withTenantContext } from "@/lib/tenant/context";

export const MENU_MANAGER_JOB_KIND: AiJobKind = "menu_manager.run";

type AiJobRow = typeof aiJobs.$inferSelect;

const TERMINAL_JOB_STATUSES = new Set<AiJobRow["status"]>(["completed", "failed", "operator_review"]);

function isActiveRun(status: AgentRunStatus) {
  return status === "queued" || status === "running";
}

function runningWithoutActiveLease(run: AgentRunRecord, job: AiJobRow, now: Date, limits: AgentRunConfig) {
  if (run.status !== "running" || job.status !== "queued") {
    return false;
  }
  const updatedAtMs =
    job.updatedAt instanceof Date ? job.updatedAt.getTime() : Date.parse(String(job.updatedAt));
  const idleMs = now.getTime() - updatedAtMs;
  const graceMs = limits.pollLeaseMs + limits.pollIntervalMs;
  return idleMs >= graceMs;
}

async function failRunForWorkerStopped(
  db: DbClient,
  tenantId: string,
  runPublicId: string,
  now: Date,
): Promise<AgentRunRecord> {
  await markAgentRunFailed(db, tenantId, runPublicId, {
    code: WORKER_STOPPED_MID_REVIEW_CODE,
    message: WORKER_STOPPED_MID_REVIEW_MESSAGE,
    now,
  });
  return getAgentRun(db, tenantId, runPublicId);
}

/**
 * Read-side upkeep for a queued_worker Menu Manager run. Never contacts a
 * provider. Applies run deadlines first, then reconciles a terminal job with
 * an active run, then ends runs whose worker job will not be retried.
 */
export async function settleQueuedWorkerMenuManagerRun(
  db: DbClient,
  tenantId: string,
  run: AgentRunRecord,
  limits: AgentRunConfig,
  now: Date,
): Promise<AgentRunRecord> {
  let current = await expireAgentRunIfDue(db, tenantId, run.publicId, {
    queuedStaleMs: limits.queuedStaleMs,
    now,
  });
  if (!isActiveRun(current.status)) {
    return current;
  }

  const job = await getAiJobForRun(db, tenantId, { jobKind: MENU_MANAGER_JOB_KIND, agentRunId: current.id });
  if (!job) {
    return current;
  }

  if (isActiveRun(current.status) && TERMINAL_JOB_STATUSES.has(job.status)) {
    return failRunForWorkerStopped(db, tenantId, current.publicId, now);
  }

  if (
    isActiveRun(current.status) &&
    job.attemptCount >= MENU_MANAGER_MAX_JOB_ATTEMPTS &&
    job.status !== "leased"
  ) {
    return failRunForWorkerStopped(db, tenantId, current.publicId, now);
  }

  if (isActiveRun(current.status) && runningWithoutActiveLease(current, job, now, limits)) {
    return failRunForWorkerStopped(db, tenantId, current.publicId, now);
  }

  if (current.status === "queued" && now.getTime() - Date.parse(current.createdAt) >= limits.queuedStaleMs) {
    const failed = await withTenantContext(db, tenantId, async (tx) => {
      const cancelled = await cancelUnclaimedAiJobInTx(tx, {
        jobPublicId: job.publicId,
        code: NOT_STARTED_IN_TIME_CODE,
        message: NOT_STARTED_IN_TIME_MESSAGE,
      });
      return cancelled
        ? failQueuedAgentRunInTx(tx, tenantId, current.publicId, {
            code: NOT_STARTED_IN_TIME_CODE,
            message: NOT_STARTED_IN_TIME_MESSAGE,
            now,
          })
        : null;
    });
    if (failed) {
      return failed;
    }
    current = await getAgentRun(db, tenantId, current.publicId);
  }

  return current;
}
