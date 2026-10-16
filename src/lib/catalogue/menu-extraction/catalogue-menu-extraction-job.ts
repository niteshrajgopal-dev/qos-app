import { and, eq } from "drizzle-orm";

import type { DbClient } from "@/db/client";
import {
  aiSpendReservations,
  catalogueMenuExtractionCandidates,
  type MenuExtractionCandidatePayload,
} from "@/db/schema";
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
import { readNativeModelConfig } from "@/lib/agents/native/native-model-config";
import {
  CURRENT_CATALOGUE_MENU_EXTRACTION_DEFINITION,
  getCatalogueMenuExtractionDefinition,
} from "@/lib/catalogue/menu-extraction/definition";
import { MENU_EXTRACTION_SYSTEM_INSTRUCTIONS } from "@/lib/catalogue/menu-extraction/prompt";
import type { MenuExtractionReviewRequestSummary } from "@/lib/catalogue/menu-extraction/service";
import { CATALOGUE_MENU_EXTRACTION_JOB_KIND } from "@/lib/catalogue/menu-extraction/service";
import {
  loadMenuExtractionSource,
  readMenuExtractionPageBytes,
} from "@/lib/catalogue/menu-extraction/source-store";
import {
  getMenuExtractionVisionProvider,
  type MenuExtractionVisionProvider,
} from "@/lib/agents/native/menu-extraction-vision-provider";
import { markAiSpendDispatched, recordAiSpendOutcome } from "@/lib/ai/spend/spend-admission";
import { AiJobLeaseLostError, type AiJobStepResult } from "@/lib/ai/jobs/ai-job-queue";
import type { AiJobHandler } from "@/lib/ai/jobs/ai-worker";
import { withTenantContext } from "@/lib/tenant/context";

const WORKER_ACTOR = { subject: "qos.ai-worker", actorClass: "system" as const };

type HandlerOptions = {
  config?: AgentConfig;
  vision?: MenuExtractionVisionProvider;
  now?: () => Date;
};

function parseRequestSummary(run: AgentRunRecord): MenuExtractionReviewRequestSummary | null {
  const summary = run.requestSummary;
  if (summary.schema !== "qos.catalogue_menu_extraction_request.v1") {
    return null;
  }
  return {
    schema: "qos.catalogue_menu_extraction_request.v1",
    sourcePublicId: String(summary.sourcePublicId ?? ""),
    contentHash: String(summary.contentHash ?? ""),
    pageCount: Number(summary.pageCount ?? 0),
    modelId: String(summary.modelId ?? ""),
    promptVersion: String(summary.promptVersion ?? ""),
  };
}

export function createCatalogueMenuExtractionJobHandler(
  db: DbClient,
  options: HandlerOptions = {},
): AiJobHandler {
  const clock = options.now ?? (() => new Date());

  return {
    kind: CATALOGUE_MENU_EXTRACTION_JOB_KIND,
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
        getCatalogueMenuExtractionDefinition(activeRun.definitionVersion) ??
        CURRENT_CATALOGUE_MENU_EXTRACTION_DEFINITION;
      const requestSummary = parseRequestSummary(activeRun);
      if (!requestSummary) {
        await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
          code: "pinned_input_invalid",
          message: "The menu extraction request metadata is invalid.",
          now: clock(),
        });
        return { type: "failed", code: "pinned_input_invalid", message: "Invalid request metadata." };
      }

      const pinned = await loadPinnedRunInput(db, job.tenantId, activeRun.id);
      if (!pinned.ok) {
        await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
          code: "pinned_input_invalid",
          message: "The pinned menu extraction input is missing.",
          now: clock(),
        });
        return { type: "failed", code: "pinned_input_invalid", message: "Pinned input missing." };
      }

      async function spendReservationPublicId() {
        return withTenantContext(db, job.tenantId, async (tx) => {
          const [row] = await tx
            .select({ publicId: aiSpendReservations.publicId })
            .from(aiSpendReservations)
            .where(
              and(
                eq(aiSpendReservations.tenantId, job.tenantId),
                eq(aiSpendReservations.path, "catalogue.menu_extraction"),
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
        const message = "QOS could not confirm whether the model accepted this menu extraction request.";
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

      const nativeConfig = readNativeModelConfig();
      const vision =
        options.vision ??
        (nativeConfig.provider === "mock" ? null : getMenuExtractionVisionProvider(nativeConfig));
      if (!vision) {
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
          message: "The model accepted a menu extraction QOS had already ended.",
        };
      }

      const loaded = await loadMenuExtractionSource(db, job.tenantId, requestSummary.sourcePublicId);
      if (!loaded) {
        await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
          code: "source_not_found",
          message: "The menu source for this extraction no longer exists.",
          now: clock(),
        });
        await settleSpend("failed_after_processing");
        return { type: "failed", code: "source_not_found", message: "Menu source missing." };
      }

      const pages = [];
      for (const page of loaded.pages.sort((a, b) => a.pageNumber - b.pageNumber)) {
        const bytes = await readMenuExtractionPageBytes(job.tenantId, page.storagePath);
        pages.push({
          pageNumber: page.pageNumber,
          mimeType: "image/jpeg" as const,
          base64: bytes.toString("base64"),
          width: page.width,
          height: page.height,
        });
      }

      const message = definition.buildRequest({
        sourcePublicId: requestSummary.sourcePublicId,
        pageCount: requestSummary.pageCount,
        localeHint: "mixed",
      });

      let visionResult;
      try {
        visionResult = await vision.complete({
          modelId: requestSummary.modelId,
          correlationId: activeRun.publicId,
          instructions: MENU_EXTRACTION_SYSTEM_INSTRUCTIONS,
          input: message,
          pages,
        });
      } catch {
        await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
          code: "model_submission_unknown",
          message: "QOS could not confirm whether the model accepted this menu extraction.",
          now: clock(),
        });
        await settleSpend("submission_unknown");
        return {
          type: "operator_review",
          code: "model_submission_unknown",
          message: "Menu extraction outcome unknown.",
          providerOutcome: "submission_unknown",
        };
      }

      const interpreted = definition.interpretReply(visionResult.text, {
        sourcePublicId: requestSummary.sourcePublicId,
        pageCount: requestSummary.pageCount,
      });
      if (!interpreted.ok) {
        await markAgentRunFailed(db, job.tenantId, activeRun.publicId, {
          code: interpreted.code,
          message: interpreted.message,
          now: clock(),
        });
        await settleSpend("failed_after_processing", visionResult.usage);
        return { type: "failed", code: interpreted.code, message: interpreted.message };
      }

      const items = (interpreted.result.items as MenuExtractionCandidatePayload[] | undefined) ?? [];
      await withTenantContext(db, job.tenantId, async (tx) => {
        for (const payload of items) {
          await tx.insert(catalogueMenuExtractionCandidates).values({
            tenantId: job.tenantId,
            agentRunId: activeRun.id,
            candidateKey: payload.candidateKey,
            sectionName: payload.sectionName,
            payload,
            excluded: false,
          });
        }
      });

      await completeAgentRun(db, job.tenantId, activeRun.publicId, {
        result: interpreted.result,
        now: clock(),
      });
      await settleSpend("completed", visionResult.usage);
      return { type: "completed" };
    },
  };
}
