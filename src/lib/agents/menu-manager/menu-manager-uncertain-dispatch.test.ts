import { describe, expect, it, vi } from "vitest";

import type { AgentRunRecord } from "@/lib/agents/agent-runs";
import { resolveUncertainPriorDispatch } from "@/lib/agents/menu-manager/menu-manager-uncertain-dispatch";
import { MENU_MANAGER_MAX_UNCERTAIN_NATIVE_CONTINUE_ATTEMPTS } from "@/lib/agents/menu-manager/menu-manager-worker-limits";

vi.mock("@/lib/agents/agent-runs", () => ({
  getAgentRun: vi.fn(),
  START_OUTCOME_UNKNOWN_CODE: "start_outcome_unknown",
}));

import { getAgentRun } from "@/lib/agents/agent-runs";

function runningNative(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
  return {
    publicId: "run_test",
    status: "running",
    providerThreadId: "native:run_test",
    executionIdentity: { executorKind: "native", executorAdapter: "agents_sdk" },
    ...overrides,
  } as AgentRunRecord;
}

describe("resolveUncertainPriorDispatch", () => {
  it("stops continuing native runs after too many reclaim attempts", async () => {
    vi.mocked(getAgentRun).mockResolvedValue(runningNative());

    const resolution = await resolveUncertainPriorDispatch({} as never, "tenant", "run_test", {
      attemptNumber: MENU_MANAGER_MAX_UNCERTAIN_NATIVE_CONTINUE_ATTEMPTS + 1,
    });

    expect(resolution).toMatchObject({ kind: "reclaim_exhausted" });
  });

  it("continues a running native run on early reclaim attempts", async () => {
    const run = runningNative();
    vi.mocked(getAgentRun).mockResolvedValue(run);

    const resolution = await resolveUncertainPriorDispatch({} as never, "tenant", "run_test", {
      attemptNumber: 2,
    });

    expect(resolution).toEqual({ kind: "continue", run });
  });
});
