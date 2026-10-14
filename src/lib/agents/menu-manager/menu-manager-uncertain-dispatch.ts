import type { DbClient } from "@/db/client";
import { getAgentRun, START_OUTCOME_UNKNOWN_CODE, type AgentRunRecord } from "@/lib/agents/agent-runs";
import { isActive } from "@/lib/agents/menu-manager/menu-manager-service";

const UNCERTAIN_START_MESSAGE =
  "QOS could not confirm whether the agent service received this review.";

export type UncertainPriorDispatchResolution =
  | { kind: "continue"; run: AgentRunRecord }
  | { kind: "completed" }
  | { kind: "start_unknown"; message: string };

/**
 * A reclaimed job whose prior attempt may have reached the provider. When the
 * run is already running with a thread id, the worker should continue rather
 * than treating the reclaim as an unknown start.
 */
export async function resolveUncertainPriorDispatch(
  db: DbClient,
  tenantId: string,
  runPublicId: string,
): Promise<UncertainPriorDispatchResolution> {
  const current = await getAgentRun(db, tenantId, runPublicId);
  if (!isActive(current.status)) {
    return { kind: "completed" };
  }
  if (current.status === "running" && current.providerThreadId) {
    return { kind: "continue", run: current };
  }
  return { kind: "start_unknown", message: UNCERTAIN_START_MESSAGE };
}

export const UNCERTAIN_START_FAILURE = {
  code: START_OUTCOME_UNKNOWN_CODE,
  message: UNCERTAIN_START_MESSAGE,
} as const;
