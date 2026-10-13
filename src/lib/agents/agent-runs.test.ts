import { describe, expect, it } from "vitest";

import { isRemoteOutcomeUnknown, QOS_WAIT_DEADLINE_CODE, START_OUTCOME_UNKNOWN_CODE } from "@/lib/agents/agent-runs";

describe("isRemoteOutcomeUnknown", () => {
  it("marks only outcomes where the remote may still finish or bill", () => {
    expect(
      isRemoteOutcomeUnknown({
        status: "failed",
        failureCode: QOS_WAIT_DEADLINE_CODE,
        providerThreadId: "thread_1",
      }),
    ).toBe(true);
    expect(
      isRemoteOutcomeUnknown({
        status: "failed",
        failureCode: START_OUTCOME_UNKNOWN_CODE,
        providerThreadId: null,
      }),
    ).toBe(true);
    expect(
      isRemoteOutcomeUnknown({
        status: "failed",
        failureCode: "provider_reauth_required",
        providerThreadId: "thread_1",
      }),
    ).toBe(true);
  });

  it("does not treat a queued start timeout as an unknown remote outcome", () => {
    expect(
      isRemoteOutcomeUnknown({
        status: "failed",
        failureCode: "start_not_recorded",
        providerThreadId: null,
      }),
    ).toBe(false);
    expect(
      isRemoteOutcomeUnknown({
        status: "failed",
        failureCode: "not_started_in_time",
        providerThreadId: null,
      }),
    ).toBe(false);
  });
});
