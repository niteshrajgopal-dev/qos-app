import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { aiSpendReservations } from "@/db/schema";
import {
  completeAgentRun,
  expireAgentRunIfDue,
  getAgentRunById,
  markAgentRunFailed,
  markAgentRunStarted,
  pollAgentRunOnce,
  START_OUTCOME_UNKNOWN_CODE,
  type AgentRunRecord,
} from "@/lib/agents/agent-runs";
import { readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { buildAgentExecutionContext } from "@/lib/agents/execution-context";
import { getAgentExecutorReadiness } from "@/lib/agents/executor-readiness";
import { getMenuManagerDefinition } from "@/lib/agents/menu-manager/menu-manager-definition";
import {
  completionInterpreter,
  DEFINITION_UNAVAILABLE_CODE,
  EXECUTOR_MISMATCH_CODE,
  executorMatches,
  isActive,
  MENU_MANAGER_JOB_KIND,
  NOT_SENT_MESSAGES,
  NOT_STARTED_IN_TIME_CODE,
  NOT_STARTED_IN_TIME_MESSAGE,
  onReauthRequired,
  pinnedRequest,
  pollingBlockedBy,
  runLimits,
} from "@/lib/agents/menu-manager/menu-manager-service";
import { runNativeExecutor } from "@/lib/agents/native/native-executor";
import { getAgentRuntimeProvider } from "@/lib/agents/provider-registry";
import { AGENT_TOOLS } from "@/lib/agents/tools/menu-tools";
import { invokeAgentTool } from "@/lib/agents/tools/tool-gateway";
import { AgentProviderError, type AgentRuntimeProvider } from "@/lib/agents/types";
import type { QosModel } from "@/lib/ai/model/qos-model";
import { markAiSpendDispatched, recordAiSpendOutcome } from "@/lib/ai/spend/spend-admission";
import { AiJobLeaseLostError, type AiJobStepResult, type ClaimedAiJob } from "@/lib/ai/jobs/ai-job-queue";
import type { AiJobHandler, AiJobStepContext } from "@/lib/ai/jobs/ai-worker";
import { withTenantContext } from "@/lib/tenant/context";

const WORKER_ACTOR = { subject: "qos.ai-worker", actorClass: "system" as const };

type HandlerOptions = {
  config?: AgentConfig;
  /** Tests inject a fake; production resolves the run's registered provider. */
  provider?: AgentRuntimeProvider;
  /** Tests inject a fake model; production wires the Agents SDK adapter. */
  model?: QosModel;
  now?: () => Date;
};

/**
 * Executes queued_worker Menu Manager runs one step at a time: start once,
 * then one provider poll per step until the run ends. Inline runs are never
 * touched. Every pre-dispatch check the inline path makes is repeated here
 * against live state, and dispatch evidence is committed before the provider
 * is contacted.
 */
export function createMenuManagerJobHandler(db: DbClient, options: HandlerOptions = {}): AiJobHandler {
  const clock = options.now ?? (() => new Date());

  function resolveProvider(run: AgentRunRecord) {
    return options.provider ?? getAgentRuntimeProvider(run.provider);
  }

  async function notSent(job: ClaimedAiJob, run: AgentRunRecord, code: string, message: string): Promise<AiJobStepResult> {
    await markAgentRunFailed(db, job.tenantId, run.publicId, { code, message, now: clock() });
    return { type: "failed", code, message, providerOutcome: "not_dispatched" };
  }

  async function start(
    job: ClaimedAiJob,
    context: AiJobStepContext,
    run: AgentRunRecord,
    config: AgentConfig,
  ): Promise<AiJobStepResult> {
    const limits = runLimits(run, config);
    if (job.uncertainPriorDispatch) {
      const message = "QOS could not confirm whether the agent service accepted this review.";
      await markAgentRunFailed(db, job.tenantId, run.publicId, {
        code: START_OUTCOME_UNKNOWN_CODE,
        message,
        now: clock(),
      });
      return { type: "operator_review", code: START_OUTCOME_UNKNOWN_CODE, message, providerOutcome: "submission_unknown" };
    }
    if (clock().getTime() - Date.parse(run.createdAt) >= limits.queuedStaleMs) {
      return notSent(job, run, NOT_STARTED_IN_TIME_CODE, NOT_STARTED_IN_TIME_MESSAGE);
    }

    const request = await pinnedRequest(db, job.tenantId, run);
    if (!request.ok) {
      return notSent(job, run, request.code, request.message);
    }
    const execution = await buildAgentExecutionContext(db, job.tenantId, run, { config });
    if (!execution.ok) {
      return notSent(job, run, execution.reason, NOT_SENT_MESSAGES[execution.reason]);
    }
    const readiness = await getAgentExecutorReadiness(db, run.provider);
    if (!readiness.ready) {
      return { type: "reschedule", delayMs: limits.pollIntervalMs, code: "executor_not_ready" };
    }

    let provider: AgentRuntimeProvider;
    try {
      provider = resolveProvider(run);
    } catch (error) {
      if (error instanceof AgentProviderError) {
        return { type: "reschedule", delayMs: limits.pollIntervalMs, code: "executor_unavailable" };
      }
      throw error;
    }
    if (!executorMatches(run, provider)) {
      return notSent(job, run, EXECUTOR_MISMATCH_CODE, "The QOS agent service changed before this review could be sent.");
    }
    if (context.leaseLost()) {
      throw new AiJobLeaseLostError(job.jobPublicId);
    }

    await context.markDispatched();
    try {
      const started = await provider.startRun({
        providerAgentId: run.providerAgentId,
        message: request.message,
        idempotencyKey: run.publicId,
      });
      const running = await markAgentRunStarted(db, job.tenantId, run.publicId, {
        providerThreadId: started.providerThreadId,
        actor: WORKER_ACTOR,
        pollIntervalMs: limits.pollIntervalMs,
        now: clock(),
      });
      if (running.status !== "running") {
        // The run was ended locally while the provider accepted it.
        return {
          type: "operator_review",
          code: "started_after_run_ended",
          message: "The agent service accepted a review QOS had already ended.",
        };
      }
      return { type: "reschedule", delayMs: limits.pollIntervalMs };
    } catch (error) {
      if (!(error instanceof AgentProviderError)) {
        throw error;
      }
      if (error.requiresReauth) {
        await onReauthRequired(db, run.provider, error);
      }
      if (error.outcome === "submission_unknown") {
        const message = "QOS could not confirm whether the agent service accepted this review.";
        await markAgentRunFailed(db, job.tenantId, run.publicId, {
          code: START_OUTCOME_UNKNOWN_CODE,
          message,
          now: clock(),
        });
        return { type: "operator_review", code: START_OUTCOME_UNKNOWN_CODE, message, providerOutcome: error.outcome };
      }
      const message = "The agent service could not start this review.";
      await markAgentRunFailed(db, job.tenantId, run.publicId, { code: error.code, message, now: clock() });
      return { type: "failed", code: error.code, message, providerOutcome: error.outcome };
    }
  }

  async function poll(job: ClaimedAiJob, found: AgentRunRecord, config: AgentConfig): Promise<AiJobStepResult> {
    const limits = runLimits(found, config);
    const run = await expireAgentRunIfDue(db, job.tenantId, found.publicId, {
      queuedStaleMs: limits.queuedStaleMs,
      now: clock(),
    });
    if (!isActive(run.status)) {
      return { type: "completed" };
    }
    const wait = (code: string): AiJobStepResult => ({ type: "reschedule", delayMs: limits.pollIntervalMs, code });

    const blocked = await pollingBlockedBy(db, job.tenantId, run, config);
    if (blocked) {
      return wait(blocked);
    }
    const definition = getMenuManagerDefinition(run.definitionVersion);
    if (!definition) {
      return wait("definition_unavailable");
    }
    let provider: AgentRuntimeProvider;
    try {
      provider = resolveProvider(run);
    } catch (error) {
      if (error instanceof AgentProviderError) {
        return wait("executor_unavailable");
      }
      throw error;
    }
    if (!executorMatches(run, provider)) {
      return wait(EXECUTOR_MISMATCH_CODE);
    }

    const polled = await pollAgentRunOnce(db, job.tenantId, run.publicId, {
      provider,
      owner: `ai-worker:${job.leaseToken}`,
      pollIntervalMs: limits.pollIntervalMs,
      leaseMs: limits.pollLeaseMs,
      queuedStaleMs: limits.queuedStaleMs,
      now: clock,
      interpretCompletion: completionInterpreter(run, definition),
      onReauthRequired: (error) => onReauthRequired(db, run.provider, error),
    });
    if (!isActive(polled.run.status)) {
      return { type: "completed" };
    }
    const nextPollAt = polled.run.nextPollAt ? Date.parse(polled.run.nextPollAt) : null;
    const delayMs = nextPollAt === null ? limits.pollIntervalMs : Math.max(0, nextPollAt - clock().getTime());
    return { type: "reschedule", delayMs };
  }

  return {
    kind: MENU_MANAGER_JOB_KIND,
    async step(job, context) {
      const config = options.config ?? readAgentConfig();
      const run = job.agentRunId ? await getAgentRunById(db, job.tenantId, job.agentRunId) : null;
      if (!run) {
        return { type: "failed", code: "run_missing", message: "The run for this job no longer exists." };
      }
      if (run.executionMode !== "queued_worker") {
        return { type: "failed", code: "execution_mode_mismatch", message: "Only queued_worker runs execute on the worker." };
      }
      if (!isActive(run.status)) {
        return { type: "completed" };
      }
      if (run.provider === "agents_sdk" || run.executionIdentity?.executorKind === "native") {
        return nativeStep(job, context, run, config);
      }
      return run.status === "queued" ? start(job, context, run, config) : poll(job, run, config);
    },
  };

  async function nativeStep(
    job: ClaimedAiJob,
    context: AiJobStepContext,
    run: AgentRunRecord,
    config: AgentConfig,
  ): Promise<AiJobStepResult> {
    async function nativeSpendReservationPublicId() {
      const fromSummary =
        typeof run.requestSummary.spendReservationPublicId === "string"
          ? run.requestSummary.spendReservationPublicId
          : null;
      if (fromSummary) {
        return fromSummary;
      }
      return withTenantContext(db, job.tenantId, async (tx) => {
        const [row] = await tx
          .select({ publicId: aiSpendReservations.publicId })
          .from(aiSpendReservations)
          .where(
            and(
              eq(aiSpendReservations.tenantId, job.tenantId),
              eq(aiSpendReservations.path, "menu_manager.native"),
              eq(aiSpendReservations.subjectType, "agent_run"),
              eq(aiSpendReservations.subjectPublicId, run.publicId),
            ),
          )
          .limit(1);
        return row?.publicId ?? null;
      });
    }

    async function settleSpend(
      outcome: Parameters<typeof recordAiSpendOutcome>[1]["outcome"],
      reportedUsage?: Record<string, number> | null,
    ) {
      const reservationPublicId = await nativeSpendReservationPublicId();
      if (!reservationPublicId) {
        return;
      }
      await withTenantContext(db, job.tenantId, async (tx) => {
        if (outcome === "submission_unknown") {
          await markAiSpendDispatched(tx, { tenantId: job.tenantId, reservationPublicId, now: clock() });
        }
        await recordAiSpendOutcome(tx, {
          tenantId: job.tenantId,
          reservationPublicId,
          outcome,
          reportedUsage,
          actor: WORKER_ACTOR,
          now: clock(),
        });
      });
    }

    if (job.uncertainPriorDispatch) {
      const message = "QOS could not confirm whether the model accepted this review.";
      await markAgentRunFailed(db, job.tenantId, run.publicId, {
        code: START_OUTCOME_UNKNOWN_CODE,
        message,
        now: clock(),
      });
      await settleSpend("submission_unknown");
      return { type: "operator_review", code: START_OUTCOME_UNKNOWN_CODE, message, providerOutcome: "submission_unknown" };
    }

    const definition = getMenuManagerDefinition(run.definitionVersion);
    if (!definition) {
      return notSent(job, run, DEFINITION_UNAVAILABLE_CODE, "The review definition is not available.");
    }
    const request = await pinnedRequest(db, job.tenantId, run);
    if (!request.ok) {
      return notSent(job, run, request.code, request.message);
    }
    const execution = await buildAgentExecutionContext(db, job.tenantId, run, { config });
    if (!execution.ok) {
      return notSent(job, run, execution.reason, NOT_SENT_MESSAGES[execution.reason]);
    }
    const model = options.model;
    if (!model) {
      return { type: "reschedule", delayMs: runLimits(run, config).pollIntervalMs, code: "executor_unavailable" };
    }
    if (context.leaseLost()) {
      throw new AiJobLeaseLostError(job.jobPublicId);
    }

    await context.markDispatched();
    const reservationPublicId = await nativeSpendReservationPublicId();
    if (reservationPublicId) {
      await withTenantContext(db, job.tenantId, (tx) =>
        markAiSpendDispatched(tx, { tenantId: job.tenantId, reservationPublicId, now: clock() }),
      );
    }

    const started = await markAgentRunStarted(db, job.tenantId, run.publicId, {
      providerThreadId: `native:${run.publicId}`,
      actor: WORKER_ACTOR,
      pollIntervalMs: runLimits(run, config).pollIntervalMs,
      now: clock(),
    });
    if (started.status !== "running") {
      await settleSpend("submission_unknown");
      return {
        type: "operator_review",
        code: "started_after_run_ended",
        message: "The model accepted a review QOS had already ended.",
      };
    }

    const result = await runNativeExecutor({
      model,
      instructions: definition.version,
      input: request.message,
      tools: definition.allowedTools.map((name) => ({
        name,
        description: name,
        inputSchema: {},
      })),
      runTool: async (name, input) => {
        const tool = await invokeAgentTool(
          db,
          { tenantId: job.tenantId, runPublicId: run.publicId, tool: name, input },
          { config, registry: AGENT_TOOLS },
        );
        return tool.ok
          ? { ok: true, output: tool.output }
          : { ok: false, code: tool.code, message: tool.message };
      },
      interpret: (text) => {
        const interpreted = definition.interpretReply(text, {
          menuPublicId: run.subjectPublicId,
          productPublicIds: Array.isArray(run.requestSummary.productPublicIds)
            ? run.requestSummary.productPublicIds.filter((id): id is string => typeof id === "string")
            : [],
          menuVersion: run.subjectVersion,
          snapshotSha256:
            typeof run.requestSummary.snapshotSha256 === "string" ? run.requestSummary.snapshotSha256 : null,
        });
        return interpreted.ok
          ? { ok: true, result: interpreted.result }
          : {
              ok: false,
              code: interpreted.code,
              message: interpreted.message,
              rawResultExcerpt: interpreted.rawResultExcerpt,
            };
      },
    });

    if (result.kind === "completed") {
      await completeAgentRun(db, job.tenantId, run.publicId, {
        result: result.output,
        now: clock(),
      });
      await settleSpend("completed", result.usage);
      return { type: "completed" };
    }

    await markAgentRunFailed(db, job.tenantId, run.publicId, {
      code: result.code,
      message: result.message,
      now: clock(),
    });
    await settleSpend(result.outcome === "submission_unknown" ? "submission_unknown" : "failed_after_processing");
    if (result.outcome === "submission_unknown") {
      return {
        type: "operator_review",
        code: result.code,
        message: result.message,
        providerOutcome: result.outcome,
      };
    }
    return { type: "failed", code: result.code, message: result.message, providerOutcome: result.outcome };
  }
}
