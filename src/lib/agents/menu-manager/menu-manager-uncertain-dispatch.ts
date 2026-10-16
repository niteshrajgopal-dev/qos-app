import type { DbClient } from "@/db/client";
import { getAgentRun, START_OUTCOME_UNKNOWN_CODE, type AgentRunRecord } from "@/lib/agents/agent-runs";
import { MENU_MANAGER_MAX_UNCERTAIN_NATIVE_CONTINUE_ATTEMPTS } from "@/lib/agents/menu-manager/menu-manager-worker-limits";
import type { AgentRunStatus } from "@/lib/agents/types";

function isActiveRun(status: AgentRunStatus) {
  return status === "queued" || status === "running";
}

const UNCERTAIN_START_MESSAGE =
  "QOS could not confirm whether the agent service received this review.";

export type UncertainPriorDispatchResolution =
  | { kind: "continue"; run: AgentRunRecord }
  | { kind: "completed" }
  | { kind: "start_unknown"; message: string }
  | { kind: "reclaim_exhausted"; message: string };

/**
 * A reclaimed job whose prior attempt may have reached the provider. When the
 * run is already running with a thread id, the worker should continue rather
 * than treating the reclaim as an unknown start.
 */
export async function resolveUncertainPriorDispatch(
  db: DbClient,
  tenantId: string,
  runPublicId: string,
  input: { attemptNumber: number } = { attemptNumber: 1 },
): Promise<UncertainPriorDispatchResolution> {
  const current = await getAgentRun(db, tenantId, runPublicId);
  if (!isActiveRun(current.status)) {
    return { kind: "completed" };
  }
  if (current.status === "running" && current.providerThreadId) {
    const nativeThread =
      current.providerThreadId.startsWith("native:") ||
      current.executionIdentity?.executorKind === "native";
    if (
      nativeThread &&
      input.attemptNumber > MENU_MANAGER_MAX_UNCERTAIN_NATIVE_CONTINUE_ATTEMPTS
    ) {
      return {
        kind: "reclaim_exhausted",
        message:
          "The AI worker lost contact with this review too many times before it could finish.",
      };
    }
    return { kind: "continue", run: current };
  }
  return { kind: "start_unknown", message: UNCERTAIN_START_MESSAGE };
}

export const UNCERTAIN_START_FAILURE = {
  code: START_OUTCOME_UNKNOWN_CODE,
  message: UNCERTAIN_START_MESSAGE,
} as const;
