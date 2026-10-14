import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import { aiSpendReservations } from "@/db/schema";
import {
  completeAgentRun,
  getAgentRunById,
  loadPinnedRunInput,
  markAgentRunFailed,
  markAgentRunStarted,
  START_OUTCOME_UNKNOWN_CODE,
  type AgentRunRecord,
} from "@/lib/agents/agent-runs";
import { readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { runNativeExecutor } from "@/lib/agents/native/native-executor";
import {
  getCatalogueTranslationDefinition,
  CURRENT_CATALOGUE_TRANSLATION_DEFINITION,
} from "@/lib/catalogue/translation-review/definition";
import { TRANSLATION_SYSTEM_INSTRUCTIONS } from "@/lib/catalogue/translation-review/prompt";
import type { TranslationReviewRequestSummary } from "@/lib/catalogue/translation-review/service";
import { CATALOGUE_TRANSLATION_JOB_KIND } from "@/lib/catalogue/translation-review/service";
import type { QosModel } from "@/lib/ai/model/qos-model";
import { markAiSpendDispatched, recordAiSpendOutcome } from "@/lib/ai/spend/spend-admission";
import { AiJobLeaseLostError, type AiJobStepResult } from "@/lib/ai/jobs/ai-job-queue";
import type { AiJobHandler } from "@/lib/ai/jobs/ai-worker";
import { withTenantContext } from "@/lib/tenant/context";

const WORKER_ACTOR = { subject: "qos.ai-worker", actorClass: "system" as const };

type HandlerOptions = {
  config?: AgentConfig;
  model?: QosModel;
  now?: () => Date;
};

function parseRequestSummary(run: AgentRunRecord): TranslationReviewRequestSummary | null {
  const summary = run.requestSummary;
  if (summary.schema !== "qos.catalogue_translation_request.v1") {
    return null;
  }
  if (summary.sourceLocale !== "en" && summary.sourceLocale !== "ar") {
    return null;
  }
  if (summary.targetLocale !== "en" && summary.targetLocale !== "ar") {
    return null;
  }
  return {
    schema: "qos.catalogue_translation_request.v1",
    sourceLocale: summary.sourceLocale,
    targetLocale: summary.targetLocale,
    sourceTranslationVersion: Number(summary.sourceTranslationVersion),
    targetTranslationVersion: Number(summary.targetTranslationVersion),
    productVersion: Number(summary.productVersion),
    modelId: String(summary.modelId ?? ""),
    promptVersion: String(summary.promptVersion ?? ""),
  };
}

export function createCatalogueTranslationJobHandler(
  db: DbClient,
  options: HandlerOptions = {},
): AiJobHandler {
  const clock = options.now ?? (() => new Date());

  return {
    kind: CATALOGUE_TRANSLATION_JOB_KIND,
    async step(job, context): Promise<AiJobStepResult> {
      const config = options.config ?? readAgentConfig();
      const run = job.agentRunId ? await getAgentRunById(db, job.tenantId, job.agentRunId) : null;
      if (!run) {
        return { type: "failed", code: "run_missing", message: "The run for this job no longer exists." };
      }
      const activeRun = run;
      if (activeRun.executionMode !== "queued_worker") {
        return {
          type: "failed",
          code: "execution_mode_mismatch",
          message: "Only queued_worker runs execute on the worker.",
        };
      }
      if (activeRun.status !== "queued" && activeRun.status !== "running") {
        return { type: "completed" };
      }

      const definition =
        getCatalogueTranslationDefinition(activeRun.definitionVersion) ??
        CURRENT_CATALOGUE_TRANSLATION_DEFINITION;
      const requestSummary = parseRequestSummary(activeRun);
      if (!requestSummary) {
        await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
          code: "pinned_input_invalid",
          message: "The translation request metadata is invalid.",
          now: clock(),
        });
        return { type: "failed", code: "pinned_input_invalid", message: "Invalid request metadata." };
      }

      const pinned = await loadPinnedRunInput(db, job.tenantId, activeRun.id);
      if (!pinned.ok) {
        await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
          code: "pinned_input_invalid",
          message: "The pinned translation input is missing.",
          now: clock(),
        });
        return { type: "failed", code: "pinned_input_invalid", message: "Pinned input missing." };
      }

      let sourceFields: { displayName: string; description: string | null };
      try {
        const parsed = JSON.parse(pinned.payload) as {
          fields?: { displayName?: string; description?: string | null };
        };
        sourceFields = {
          displayName: String(parsed.fields?.displayName ?? ""),
          description:
            parsed.fields?.description === null || typeof parsed.fields?.description === "string"
              ? parsed.fields.description
              : null,
        };
      } catch {
        await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
          code: "pinned_input_invalid",
          message: "The pinned translation input is invalid.",
          now: clock(),
        });
        return { type: "failed", code: "pinned_input_invalid", message: "Invalid pinned input." };
      }

      async function spendReservationPublicId() {
        return withTenantContext(db, job.tenantId, async (tx) => {
          const [row] = await tx
            .select({ publicId: aiSpendReservations.publicId })
            .from(aiSpendReservations)
            .where(
              and(
                eq(aiSpendReservations.tenantId, job.tenantId),
                eq(aiSpendReservations.path, "catalogue.translation"),
                eq(aiSpendReservations.subjectType, "agent_run"),
                eq(aiSpendReservations.subjectPublicId, activeRun.publicId),
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
        const reservationPublicId = await spendReservationPublicId();
        if (!reservationPublicId) {
          return;
        }
        await withTenantContext(db, job.tenantId, async (tx) => {
          if (outcome === "submission_unknown") {
            await markAiSpendDispatched(tx, {
              tenantId: job.tenantId,
              reservationPublicId,
              now: clock(),
            });
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
        const message = "QOS could not confirm whether the model accepted this translation.";
        await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
          code: START_OUTCOME_UNKNOWN_CODE,
          message,
          now: clock(),
        });
        await settleSpend("submission_unknown");
        return {
          type: "operator_review",
          code: START_OUTCOME_UNKNOWN_CODE,
          message,
          providerOutcome: "submission_unknown",
        };
      }

      const model = options.model;
      if (!model) {
        return { type: "reschedule", delayMs: config.pollIntervalMs, code: "executor_unavailable" };
      }
      if (context.leaseLost()) {
        throw new AiJobLeaseLostError(job.jobPublicId);
      }

      await context.markDispatched();
      const reservationPublicId = await spendReservationPublicId();
      if (reservationPublicId) {
        await withTenantContext(db, job.tenantId, (tx) =>
          markAiSpendDispatched(tx, {
            tenantId: job.tenantId,
            reservationPublicId,
            now: clock(),
          }),
        );
      }

      const started = await markAgentRunStarted(db, job.tenantId, activeRun.publicId, {
        providerThreadId: `native:${activeRun.publicId}`,
        actor: WORKER_ACTOR,
        pollIntervalMs: config.pollIntervalMs,
        now: clock(),
      });
      if (started.status !== "running") {
        await settleSpend("submission_unknown");
        return {
          type: "operator_review",
          code: "started_after_run_ended",
          message: "The model accepted a translation QOS had already ended.",
        };
      }

      const correlatedModel: QosModel = {
        provider: model.provider,
        modelId: model.modelId,
        complete: (request) => model.complete({ ...request, correlationId: activeRun.publicId }),
      };

      const message = definition.buildRequest({
        sourceLocale: requestSummary.sourceLocale,
        targetLocale: requestSummary.targetLocale,
        source: sourceFields,
      });

      const result = await runNativeExecutor({
        model: correlatedModel,
        instructions: TRANSLATION_SYSTEM_INSTRUCTIONS,
        input: message,
        tools: [],
        runTool: async () => ({
          ok: false,
          code: "tool_unavailable",
          message: "No tools for translation.",
        }),
        interpret: (text) => {
          const interpreted = definition.interpretReply(text, {
            sourceLocale: requestSummary.sourceLocale,
            targetLocale: requestSummary.targetLocale,
            source: sourceFields,
            sourceTranslationVersion: requestSummary.sourceTranslationVersion,
            targetTranslationVersion: requestSummary.targetTranslationVersion,
          });
          if (!interpreted.ok) {
            return {
              ok: false,
              code: interpreted.code,
              message: interpreted.message,
              rawResultExcerpt: interpreted.rawResultExcerpt,
            };
          }
          const output = {
            ...interpreted.result,
            modelId: requestSummary.modelId,
            promptVersion: requestSummary.promptVersion,
          };
          return { ok: true, result: output };
        },
      });

      if (result.kind === "completed") {
        await completeAgentRun(db, job.tenantId, activeRun.publicId, {
          result: result.output,
          now: clock(),
        });
        await settleSpend("completed", result.usage);
        return { type: "completed" };
      }

      await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
        code: result.code,
        message: result.message,
        failureDiagnostics: result.failureDiagnostics ?? undefined,
        now: clock(),
      });
      await settleSpend(
        result.outcome === "submission_unknown" ? "submission_unknown" : "failed_after_processing",
      );
      if (result.outcome === "submission_unknown") {
        return {
          type: "operator_review",
          code: result.code,
          message: result.message,
          providerOutcome: result.outcome,
        };
      }
      return { type: "failed", code: result.code, message: result.message, providerOutcome: result.outcome };
    },
  };
}
