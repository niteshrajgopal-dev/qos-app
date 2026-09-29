import { describe, expect, it } from "vitest";

import {
  HYPERAGENT_ALLOWED_TOOLS,
  parseHyperagentToolResult,
  type HyperagentToolCaller,
  type HyperagentToolName,
} from "@/lib/agents/hyperagent/hyperagent-mcp-client";
import { QosOAuthClientProvider } from "@/lib/agents/hyperagent/hyperagent-oauth";
import {
  HyperagentProvider,
  MAX_FINAL_MESSAGE_CHARS,
} from "@/lib/agents/hyperagent/hyperagent-provider";
import { AgentProviderError } from "@/lib/agents/types";

const AGENT_ID = "cmun4w730017807adjrkbep1t";
const THREAD_ID = "cmthread0000000000000001";

type Call = { name: HyperagentToolName; args: Record<string, unknown> };

function scriptedCaller(responses: Array<unknown | Error>) {
  const calls: Call[] = [];
  const caller: HyperagentToolCaller = async (name, args) => {
    calls.push({ name, args });
    const next = responses.shift();
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { caller, calls };
}

function thread(overrides: Record<string, unknown> = {}) {
  return {
    thread: { id: THREAD_ID, name: "Menu review" },
    messages: [
      { id: "m1", role: "user", content: "Review this menu", createdAt: "2026-09-30T10:00:00Z" },
      { id: "m2", role: "assistant", content: '{"findings":[]}', createdAt: "2026-09-30T10:01:00Z" },
    ],
    isRunning: false,
    awaitingApproval: false,
    ...overrides,
  };
}

describe("HyperagentProvider", () => {
  it("maps list_agents onto provider-neutral descriptors", async () => {
    const { caller } = scriptedCaller([
      {
        agents: [
          { id: AGENT_ID, name: "QOS Menu Manager", description: "Audits menus", executionMode: "auto" },
          { id: "cmother", name: "Other", executionMode: "confirm" },
        ],
      },
    ]);

    await expect(new HyperagentProvider(caller).listAgents()).resolves.toEqual([
      { providerAgentId: AGENT_ID, name: "QOS Menu Manager", description: "Audits menus" },
      { providerAgentId: "cmother", name: "Other", description: null },
    ]);
  });

  it("starts a thread with only the agent id and message", async () => {
    const { caller, calls } = scriptedCaller([{ threadId: THREAD_ID }]);

    await expect(
      new HyperagentProvider(caller).startRun({
        providerAgentId: AGENT_ID,
        message: "Audit this MenuSnapshot",
        idempotencyKey: "idem-12345678",
      }),
    ).resolves.toEqual({ providerThreadId: THREAD_ID });
    expect(calls).toEqual([
      { name: "create_thread", args: { agentId: AGENT_ID, message: "Audit this MenuSnapshot" } },
    ]);
  });

  it("accepts a nested thread id from create_thread", async () => {
    const { caller } = scriptedCaller([{ thread: { id: THREAD_ID } }]);
    const started = await new HyperagentProvider(caller).startRun({
      providerAgentId: AGENT_ID,
      message: "Audit",
      idempotencyKey: "idem-12345678",
    });
    expect(started.providerThreadId).toBe(THREAD_ID);
  });

  it("rejects an invalid agent id or unexpected create_thread shape before trusting it", async () => {
    const invalidAgent = scriptedCaller([]);
    await expect(
      new HyperagentProvider(invalidAgent.caller).startRun({
        providerAgentId: "../agents",
        message: "Audit",
        idempotencyKey: "idem-12345678",
      }),
    ).rejects.toMatchObject({ code: "invalid_agent_id" });
    expect(invalidAgent.calls).toHaveLength(0);

    const badShape = scriptedCaller([{ threadId: "has spaces; drop" }]);
    await expect(
      new HyperagentProvider(badShape.caller).startRun({
        providerAgentId: AGENT_ID,
        message: "Audit",
        idempotencyKey: "idem-12345678",
      }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("reports running while the agent works", async () => {
    const { caller, calls } = scriptedCaller([thread({ isRunning: true })]);
    await expect(
      new HyperagentProvider(caller).getRun({ providerThreadId: THREAD_ID }),
    ).resolves.toEqual({ state: "running" });
    expect(calls).toEqual([
      { name: "get_thread", args: { threadId: THREAD_ID, messageLimit: 20 } },
    ]);
  });

  it("treats awaitingApproval as a pause even while isRunning is still true", async () => {
    for (const isRunning of [true, false]) {
      const { caller } = scriptedCaller([thread({ isRunning, awaitingApproval: true })]);
      await expect(
        new HyperagentProvider(caller).getRun({ providerThreadId: THREAD_ID }),
      ).resolves.toEqual({ state: "awaiting_approval" });
    }
  });

  it("completes with the last assistant message", async () => {
    const { caller } = scriptedCaller([
      thread({
        messages: [
          { role: "user", content: "Review" },
          { role: "assistant", content: "Working on it" },
          { role: "tool", content: "tool output" },
          { role: "assistant", content: '  {"findings":[1]}  ' },
        ],
      }),
    ]);
    await expect(
      new HyperagentProvider(caller).getRun({ providerThreadId: THREAD_ID }),
    ).resolves.toEqual({ state: "completed", finalMessage: '{"findings":[1]}' });
  });

  it("keeps waiting when the agent has not answered the opening message yet", async () => {
    const { caller } = scriptedCaller([
      thread({ messages: [{ role: "user", content: "Review" }] }),
    ]);
    await expect(
      new HyperagentProvider(caller).getRun({ providerThreadId: THREAD_ID }),
    ).resolves.toEqual({ state: "running" });
  });

  it("fails an empty or oversized final message", async () => {
    const empty = scriptedCaller([
      thread({ messages: [{ role: "user", content: "x" }, { role: "assistant", content: "  " }] }),
    ]);
    await expect(
      new HyperagentProvider(empty.caller).getRun({ providerThreadId: THREAD_ID }),
    ).resolves.toMatchObject({ state: "failed", code: "empty_final_message" });

    const huge = scriptedCaller([
      thread({
        messages: [
          { role: "user", content: "x" },
          { role: "assistant", content: "a".repeat(MAX_FINAL_MESSAGE_CHARS + 1) },
        ],
      }),
    ]);
    await expect(
      new HyperagentProvider(huge.caller).getRun({ providerThreadId: THREAD_ID }),
    ).resolves.toMatchObject({ state: "failed", code: "final_message_too_large" });
  });

  it("rejects malformed thread payloads and a different thread", async () => {
    const malformed = scriptedCaller([{ messages: "nope", isRunning: "no" }]);
    await expect(
      new HyperagentProvider(malformed.caller).getRun({ providerThreadId: THREAD_ID }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });

    const other = scriptedCaller([thread({ thread: { id: "cmsomeoneelse" } })]);
    await expect(
      new HyperagentProvider(other.caller).getRun({ providerThreadId: THREAD_ID }),
    ).rejects.toMatchObject({ code: "invalid_provider_response" });
  });

  it("propagates tool errors and reauth errors unchanged", async () => {
    const reauth = new AgentProviderError("provider_reauth_required", "reauth", {
      requiresReauth: true,
    });
    const { caller } = scriptedCaller([
      new AgentProviderError("provider_tool_error", "boom"),
      reauth,
    ]);
    const provider = new HyperagentProvider(caller);

    await expect(provider.getRun({ providerThreadId: THREAD_ID })).rejects.toMatchObject({
      code: "provider_tool_error",
      requiresReauth: false,
    });
    await expect(provider.getRun({ providerThreadId: THREAD_ID })).rejects.toBe(reauth);
  });

  it("never exposes an approval-resolution tool", () => {
    expect(HYPERAGENT_ALLOWED_TOOLS).toEqual(["list_agents", "create_thread", "get_thread"]);
    expect(HYPERAGENT_ALLOWED_TOOLS).not.toContain("resolve_approval");
    expect(HYPERAGENT_ALLOWED_TOOLS).not.toContain("send_message");
    expect("resolveApproval" in new HyperagentProvider(async () => ({}))).toBe(false);
  });
});

describe("parseHyperagentToolResult", () => {
  it("parses JSON text content and prefers structuredContent", () => {
    expect(
      parseHyperagentToolResult("get_thread", {
        content: [{ type: "text", text: '{"a":' }, { type: "text", text: "1}" }],
      }),
    ).toEqual({ a: 1 });
    expect(
      parseHyperagentToolResult("get_thread", {
        structuredContent: { b: 2 },
        content: [{ type: "text", text: "ignored" }],
      }),
    ).toEqual({ b: 2 });
  });

  it("maps tool errors and non-JSON output to provider errors", () => {
    expect(() =>
      parseHyperagentToolResult("create_thread", {
        isError: true,
        content: [{ type: "text", text: "agent not found" }],
      }),
    ).toThrow(expect.objectContaining({ code: "provider_tool_error" }));
    expect(() =>
      parseHyperagentToolResult("get_thread", { content: [{ type: "text", text: "<html>" }] }),
    ).toThrow(expect.objectContaining({ code: "invalid_provider_response" }));
  });
});

describe("QosOAuthClientProvider", () => {
  const redirectUrl = "http://127.0.0.1:33418/oauth/callback";

  it("records reauth instead of redirecting in a runtime session", async () => {
    const provider = new QosOAuthClientProvider({ redirectUrl });
    await provider.redirectToAuthorization(new URL("https://auth.example/authorize"));
    expect(provider.reauthRequired).toBe(true);

    await provider.saveTokens({ access_token: "a", token_type: "Bearer" });
    expect(provider.reauthRequired).toBe(false);
  });

  it("persists every state change and hands out copies", async () => {
    const saved: unknown[] = [];
    const provider = new QosOAuthClientProvider({
      redirectUrl,
      initialState: { tokens: { access_token: "old", token_type: "Bearer" } },
      onStateChanged: async (state) => {
        saved.push(state);
      },
    });

    await provider.saveClientInformation({ client_id: "client-1" });
    await provider.saveTokens({ access_token: "new", token_type: "Bearer", refresh_token: "r" });

    expect(saved).toHaveLength(2);
    expect(saved[1]).toEqual({
      redirectUrl,
      clientInformation: { client_id: "client-1" },
      tokens: { access_token: "new", token_type: "Bearer", refresh_token: "r" },
    });
    const snapshot = provider.snapshot();
    snapshot.tokens!.access_token = "tampered";
    expect(provider.tokens()?.access_token).toBe("new");
    expect(provider.clientMetadata.redirect_uris).toEqual([redirectUrl]);
  });

  it("does not persist invalidated credentials", async () => {
    const saved: unknown[] = [];
    const provider = new QosOAuthClientProvider({
      redirectUrl,
      initialState: { tokens: { access_token: "a", token_type: "Bearer" } },
      onStateChanged: async (state) => {
        saved.push(state);
      },
    });
    provider.invalidateCredentials("tokens");
    expect(provider.tokens()).toBeUndefined();
    expect(saved).toHaveLength(0);
  });
});
