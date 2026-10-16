import { beforeEach, describe, expect, it, vi } from "vitest";

import { failMenuManagerRunForTerminalDatabaseError } from "@/lib/agents/menu-manager/menu-manager-context-error";
import type { AgentRunRecord } from "@/lib/agents/agent-runs";
import type { ClaimedAiJob } from "@/lib/ai/jobs/ai-job-queue";

vi.mock("@/lib/agents/agent-runs", () => ({
  markAgentRunFailed: vi.fn(),
}));

import { markAgentRunFailed } from "@/lib/agents/agent-runs";

const run = { publicId: "run_1" } as AgentRunRecord;
const job = { tenantId: "tenant-1" } as ClaimedAiJob;

describe("failMenuManagerRunForTerminalDatabaseError", () => {
  beforeEach(() => {
    vi.mocked(markAgentRunFailed).mockClear();
  });

  it("fails the run for permission denied without rethrowing", async () => {
    const result = await failMenuManagerRunForTerminalDatabaseError(
      {} as never,
      job,
      run,
      { code: "42501", message: "permission denied for table catalogue_menu_translations" },
      new Date(),
    );
    expect(result).toMatchObject({ type: "failed", code: "menu_manager_context_unavailable" });
    expect(markAgentRunFailed).toHaveBeenCalledWith(
      {},
      "tenant-1",
      "run_1",
      expect.objectContaining({ code: "menu_manager_context_unavailable" }),
    );
  });

  it("returns null for non-terminal database errors", async () => {
    await expect(
      failMenuManagerRunForTerminalDatabaseError(
        {} as never,
        job,
        run,
        { code: "40001", message: "serialization failure" },
        new Date(),
      ),
    ).resolves.toBeNull();
    expect(markAgentRunFailed).not.toHaveBeenCalled();
  });
});
