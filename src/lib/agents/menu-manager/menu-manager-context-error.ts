import type { DbClient } from "@/db/client";
import { markAgentRunFailed, type AgentRunRecord } from "@/lib/agents/agent-runs";
import type { AiJobStepResult, ClaimedAiJob } from "@/lib/ai/jobs/ai-job-queue";
import { describePostgresError } from "@/lib/db/postgres-error";

export const MENU_MANAGER_CONTEXT_UNAVAILABLE_CODE = "menu_manager_context_unavailable";
export const MENU_MANAGER_CONTEXT_UNAVAILABLE_MESSAGE =
  "QOS could not load the menu data needed for this review. An administrator may need to update the database grants or migrations.";

export async function failMenuManagerRunForTerminalDatabaseError(
  db: DbClient,
  job: ClaimedAiJob,
  run: AgentRunRecord,
  error: unknown,
  now: Date,
): Promise<AiJobStepResult | null> {
  const details = describePostgresError(error);
  if (!details?.terminal) {
    return null;
  }
  await markAgentRunFailed(db, job.tenantId, run.publicId, {
    code: MENU_MANAGER_CONTEXT_UNAVAILABLE_CODE,
    message: MENU_MANAGER_CONTEXT_UNAVAILABLE_MESSAGE,
    now,
  });
  return {
    type: "failed",
    code: MENU_MANAGER_CONTEXT_UNAVAILABLE_CODE,
    message: MENU_MANAGER_CONTEXT_UNAVAILABLE_MESSAGE,
    providerOutcome: "not_dispatched",
  };
}
