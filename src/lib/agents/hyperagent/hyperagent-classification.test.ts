import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { describe, expect, it } from "vitest";

import {
  classifyHyperagentTransportError,
  parseHyperagentToolResult,
  type HyperagentToolCaller,
} from "@/lib/agents/hyperagent/hyperagent-mcp-client";
import { HyperagentProvider } from "@/lib/agents/hyperagent/hyperagent-provider";
import { AgentProviderError } from "@/lib/agents/types";
import { permitsAutomaticResubmission } from "@/lib/ai/provider-outcome";

const AGENT_ID = "cmun4w730017807adjrkbep1t";
const THREAD_ID = "cmthread0000000000000001";

function failingCaller(error: Error) {
  const calls: string[] = [];
  const caller: HyperagentToolCaller = async (name) => {
    calls.push(name);
    throw error;
  };
  return { caller, calls };
}

async function caught(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AgentProviderError);
  return error as AgentProviderError;
}

describe("Hyperagent failure classification", () => {
  it("classifies local validation as not dispatched without calling the transport", async () => {
    const { caller, calls } = failingCaller(new Error("must not be called"));
    const provider = new HyperagentProvider(caller);

    const badAgent = await caught(
      provider.startRun({ providerAgentId: "bad id!", message: "x", idempotencyKey: "k-1234567" }),
    );
    const emptyMessage = await caught(
      provider.startRun({ providerAgentId: AGENT_ID, message: "  ", idempotencyKey: "k-1234567" }),
    );
    const badThread = await caught(provider.getRun({ providerThreadId: "../etc" }));

    for (const error of [badAgent, emptyMessage, badThread]) {
      expect(error.outcome).toBe("not_dispatched");
    }
    expect(calls).toEqual([]);
  });

  it("treats a failed create_thread call as possibly accepted, never auto-resubmittable", () => {
    const error = classifyHyperagentTransportError("create_thread", new Error("socket hang up"), {
      reauthRequired: false,
      phase: "call",
    });
    expect(error).toMatchObject({ code: "provider_request_failed", requiresReauth: false });
    expect(error.classification).toEqual({
      outcome: "submission_unknown",
      retryable: false,
      retryAfterMs: null,
    });
    expect(permitsAutomaticResubmission(error.classification)).toBe(false);
  });

  it("treats a failure before the tool request is sent as not dispatched", () => {
    const error = classifyHyperagentTransportError("create_thread", new Error("ECONNREFUSED"), {
      reauthRequired: false,
      phase: "connect",
    });
    expect(error.classification).toEqual({
      outcome: "not_dispatched",
      retryable: true,
      retryAfterMs: null,
    });
  });

  it("treats failed reads of a known thread as safe-to-repeat read failures", () => {
    for (const name of ["get_thread", "list_agents"]) {
      const error = classifyHyperagentTransportError(name, new Error("timeout"), {
        reauthRequired: false,
        phase: "call",
      });
      expect(error.classification).toMatchObject({ outcome: "read_failed", retryable: true });
    }
  });

  it("classifies authorization failures as rejected and requiring reauth", () => {
    for (const [error, reauthRequired] of [
      [new StreamableHTTPError(401, "Unauthorized"), false],
      [new StreamableHTTPError(403, "Forbidden"), false],
      [new Error("anything"), true],
    ] as const) {
      const classified = classifyHyperagentTransportError("create_thread", error, {
        reauthRequired,
        phase: "call",
      });
      expect(classified).toMatchObject({ code: "provider_reauth_required", requiresReauth: true });
      expect(classified.outcome).toBe("rejected");
      expect(classified.classification.retryable).toBe(false);
    }
  });

  it("does not treat a create_thread tool error or unreadable result as proof of no thread", () => {
    expect(() =>
      parseHyperagentToolResult("create_thread", { isError: true, content: [] }),
    ).toThrow(expect.objectContaining({ outcome: "submission_unknown" }));
    expect(() =>
      parseHyperagentToolResult("create_thread", { content: [{ type: "text", text: "not json" }] }),
    ).toThrow(expect.objectContaining({ outcome: "submission_unknown" }));
    expect(() =>
      parseHyperagentToolResult("get_thread", { isError: true, content: [] }),
    ).toThrow(expect.objectContaining({ outcome: "read_failed" }));
  });

  it("classifies an unexpected create_thread shape as submission_unknown and get_thread as read_failed", async () => {
    const provider = (payload: unknown) => new HyperagentProvider(async () => payload);

    const start = await caught(
      provider({ nope: true }).startRun({
        providerAgentId: AGENT_ID,
        message: "Review",
        idempotencyKey: "k-1234567",
      }),
    );
    expect(start.classification).toMatchObject({ outcome: "submission_unknown", retryable: false });

    const read = await caught(provider({ nope: true }).getRun({ providerThreadId: THREAD_ID }));
    expect(read.classification).toMatchObject({ outcome: "read_failed", retryable: true });

    const mismatched = await caught(
      provider({
        thread: { id: "cmotherthread" },
        messages: [],
        isRunning: true,
        awaitingApproval: false,
      }).getRun({ providerThreadId: THREAD_ID }),
    );
    expect(mismatched.outcome).toBe("read_failed");
  });

  it("propagates already-classified errors from the caller unchanged", async () => {
    const original = new AgentProviderError("provider_not_connected", "Not connected.", {
      outcome: "not_dispatched",
    });
    const { caller } = failingCaller(original);
    await expect(
      new HyperagentProvider(caller).startRun({
        providerAgentId: AGENT_ID,
        message: "Review",
        idempotencyKey: "k-1234567",
      }),
    ).rejects.toBe(original);
  });

  it("defaults an unclassified provider error to the conservative outcome", () => {
    const error = new AgentProviderError("legacy_code", "Legacy.");
    expect(error.classification).toEqual({
      outcome: "submission_unknown",
      retryable: false,
      retryAfterMs: null,
    });
  });
});
