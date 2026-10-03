import { afterEach, describe, expect, it, vi } from "vitest";

import { createHyperagentToolCaller } from "@/lib/agents/hyperagent/hyperagent-mcp-client";
import { QosOAuthClientProvider } from "@/lib/agents/hyperagent/hyperagent-oauth";
import { HyperagentProvider } from "@/lib/agents/hyperagent/hyperagent-provider";
import { AgentProviderError } from "@/lib/agents/types";
import { permitsAutomaticResubmission } from "@/lib/ai/provider-outcome";

/**
 * Drives the production MCP chain (createHyperagentToolCaller → MCP Client →
 * StreamableHTTPClientTransport → QosOAuthClientProvider) against an
 * in-process fake of Hyperagent's HTTP surface. Only `fetch` is replaced, so
 * every request the SDK would put on the wire is counted by category.
 */

const ORIGIN = "https://hyperagent.test";
const SERVER_URL = `${ORIGIN}/api/mcp`;
const AGENT_ID = "cmun4w730017807adjrkbep1t";
const THREAD_ID = "cmthread0000000000000001";

type ToolBehaviour =
  | { kind: "result"; payload: unknown }
  | { kind: "status"; status: number }
  | { kind: "network_error" }
  | { kind: "hang" }
  | { kind: "sse_priming_then_drop" };

type Script = {
  initialize?: "ok" | "status_500" | "network_refused";
  /** Behaviour per successive tools/call for a given tool. */
  tools?: Partial<Record<"create_thread" | "get_thread", ToolBehaviour[]>>;
  token?: "refresh_ok" | "refresh_invalid_grant";
};

type Counts = {
  initialize: number;
  initialized: number;
  sseGet: number;
  resumptionGet: number;
  cancelled: number;
  oauthDiscovery: number;
  tokenRefresh: number;
  tools: Record<string, number>;
  toolAttempts: Array<{ tool: string; authorization: string | null }>;
};

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
}

function connectionRefused() {
  return new TypeError("fetch failed", { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
}

function fakeHyperagent(script: Script) {
  const counts: Counts = {
    initialize: 0,
    initialized: 0,
    sseGet: 0,
    resumptionGet: 0,
    cancelled: 0,
    oauthDiscovery: 0,
    tokenRefresh: 0,
    tools: {},
    toolAttempts: [],
  };
  const queues = {
    create_thread: [...(script.tools?.create_thread ?? [])],
    get_thread: [...(script.tools?.get_thread ?? [])],
  };

  const fetchImpl = async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);

    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) {
      counts.oauthDiscovery += 1;
      return json({ resource: SERVER_URL, authorization_servers: [ORIGIN] });
    }
    if (url.pathname.startsWith("/.well-known/")) {
      counts.oauthDiscovery += 1;
      return json({
        issuer: ORIGIN,
        authorization_endpoint: `${ORIGIN}/authorize`,
        token_endpoint: `${ORIGIN}/token`,
        registration_endpoint: `${ORIGIN}/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "refresh_token"],
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["none"],
      });
    }
    if (url.pathname === "/token") {
      counts.tokenRefresh += 1;
      return script.token === "refresh_ok"
        ? json({ access_token: "access-2", refresh_token: "refresh-2", token_type: "Bearer", expires_in: 3600 })
        : json({ error: "invalid_grant" }, { status: 400 });
    }
    if (url.pathname !== "/api/mcp") {
      return new Response("not found", { status: 404 });
    }

    if (method === "GET") {
      if (headers.get("last-event-id")) {
        counts.resumptionGet += 1;
      } else {
        counts.sseGet += 1;
      }
      return new Response(null, { status: 405 });
    }
    if (method === "DELETE") {
      return new Response(null, { status: 200 });
    }

    const message = JSON.parse(String(init.body)) as {
      id?: number;
      method: string;
      params?: { name?: string };
    };

    if (message.method === "initialize") {
      counts.initialize += 1;
      if (script.initialize === "network_refused") {
        throw connectionRefused();
      }
      if (script.initialize === "status_500") {
        return new Response("boom", { status: 500 });
      }
      return json(
        {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: { name: "fake-hyperagent", version: "0" },
          },
        },
        { headers: { "mcp-session-id": "session-1" } },
      );
    }
    if (message.method === "notifications/initialized") {
      counts.initialized += 1;
      return new Response(null, { status: 202 });
    }
    if (message.method === "notifications/cancelled") {
      counts.cancelled += 1;
      return new Response(null, { status: 202 });
    }
    if (message.method === "tools/call") {
      const tool = message.params?.name ?? "unknown";
      counts.tools[tool] = (counts.tools[tool] ?? 0) + 1;
      counts.toolAttempts.push({ tool, authorization: headers.get("authorization") });
      const queue = queues[tool as keyof typeof queues] ?? [];
      const behaviour = queue.length > 1 ? queue.shift()! : queue[0];
      if (!behaviour) {
        return new Response("unscripted", { status: 500 });
      }
      switch (behaviour.kind) {
        case "result":
          return json({
            jsonrpc: "2.0",
            id: message.id,
            result: { content: [{ type: "text", text: JSON.stringify(behaviour.payload) }] },
          });
        case "status":
          return new Response("error", {
            status: behaviour.status,
            headers: behaviour.status === 401 ? { "www-authenticate": 'Bearer error="invalid_token"' } : {},
          });
        case "network_error":
          throw Object.assign(new TypeError("fetch failed"), {
            cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
          });
        case "hang":
          return new Promise<Response>((_, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
          });
        case "sse_priming_then_drop":
          // A priming event with an id, then the stream ends before any result.
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode("id: evt-1\nretry: 20\ndata: \n\n"));
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } },
          );
      }
    }
    return new Response("unexpected", { status: 400 });
  };

  return { counts, fetchImpl };
}

function authProvider() {
  return new QosOAuthClientProvider({
    redirectUrl: "http://127.0.0.1:53682/callback",
    initialState: {
      clientInformation: { client_id: "qos-client" },
      tokens: { access_token: "access-1", refresh_token: "refresh-1", token_type: "Bearer" },
    },
  });
}

function setup(script: Script, requestTimeoutMs = 2_000) {
  const server = fakeHyperagent(script);
  vi.stubGlobal("fetch", server.fetchImpl);
  const auth = authProvider();
  const callTool = createHyperagentToolCaller({ serverUrl: SERVER_URL, authProvider: auth, requestTimeoutMs });
  return { server, auth, provider: new HyperagentProvider(callTool) };
}

const START = { providerAgentId: AGENT_ID, message: "Review this menu.", idempotencyKey: "idem-12345678" };

async function failure(promise: Promise<unknown>) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(AgentProviderError);
  return error as AgentProviderError;
}

describe("Hyperagent MCP transport: create_thread submission count", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends exactly one create_thread on success, separate from initialization", async () => {
    const { server, provider } = setup({ tools: { create_thread: [{ kind: "result", payload: { threadId: THREAD_ID } }] } });
    await expect(provider.startRun(START)).resolves.toEqual({ providerThreadId: THREAD_ID });
    expect(server.counts).toMatchObject({ initialize: 1, initialized: 1, tokenRefresh: 0, tools: { create_thread: 1 } });
  });

  it.each([
    ["HTTP 500", { kind: "status", status: 500 } as const],
    ["HTTP 502", { kind: "status", status: 502 } as const],
    ["connection reset after send", { kind: "network_error" } as const],
  ])("does not resend create_thread after %s and reports submission_unknown", async (_label, behaviour) => {
    const { server, provider } = setup({ tools: { create_thread: [behaviour] } });
    const error = await failure(provider.startRun(START));
    expect(error.outcome).toBe("submission_unknown");
    expect(permitsAutomaticResubmission(error.classification)).toBe(false);
    expect(server.counts.tools).toEqual({ create_thread: 1 });
  });

  it("does not resend create_thread after a request timeout", async () => {
    const { server, provider } = setup({ tools: { create_thread: [{ kind: "hang" }] } }, 150);
    const error = await failure(provider.startRun(START));
    expect(error.outcome).toBe("submission_unknown");
    expect(server.counts.tools).toEqual({ create_thread: 1 });
  });

  it("resumes a dropped SSE response with GET + Last-Event-ID, never a second create_thread POST", async () => {
    const { server, provider } = setup({ tools: { create_thread: [{ kind: "sse_priming_then_drop" }] } }, 400);
    const error = await failure(provider.startRun(START));
    expect(error.outcome).toBe("submission_unknown");
    expect(server.counts.tools).toEqual({ create_thread: 1 });
    expect(server.counts.resumptionGet).toBeGreaterThanOrEqual(1);
  });

  it("sends no create_thread when initialization fails, and classifies it as not dispatched", async () => {
    for (const initialize of ["status_500", "network_refused"] as const) {
      const { server, provider } = setup({ initialize });
      const error = await failure(provider.startRun(START));
      expect(error.outcome).toBe("not_dispatched");
      expect(server.counts.tools).toEqual({});
      vi.unstubAllGlobals();
    }
  });

  it("replays create_thread exactly once after a 401 and a successful token refresh", async () => {
    const { server, provider, auth } = setup({
      token: "refresh_ok",
      tools: {
        create_thread: [{ kind: "status", status: 401 }, { kind: "result", payload: { threadId: THREAD_ID } }],
      },
    });
    await expect(provider.startRun(START)).resolves.toEqual({ providerThreadId: THREAD_ID });
    // Two POSTs reach the wire; the first was rejected at authentication.
    expect(server.counts.tools).toEqual({ create_thread: 2 });
    expect(server.counts.toolAttempts.map((attempt) => attempt.authorization)).toEqual([
      "Bearer access-1",
      "Bearer access-2",
    ]);
    expect(server.counts.tokenRefresh).toBe(1);
    expect(auth.reauthRequired).toBe(false);
  });

  it("stops after one replay when the refreshed token is also rejected", async () => {
    const { server, provider } = setup({
      token: "refresh_ok",
      tools: { create_thread: [{ kind: "status", status: 401 }] },
    });
    const error = await failure(provider.startRun(START));
    expect(error).toMatchObject({ code: "provider_reauth_required", requiresReauth: true });
    expect(error.outcome).toBe("rejected");
    expect(server.counts.tools).toEqual({ create_thread: 2 });
  });

  it("does not replay create_thread when the token refresh fails", async () => {
    const { server, provider, auth } = setup({
      token: "refresh_invalid_grant",
      tools: { create_thread: [{ kind: "status", status: 401 }] },
    });
    const error = await failure(provider.startRun(START));
    expect(error).toMatchObject({ code: "provider_reauth_required", requiresReauth: true });
    expect(error.outcome).toBe("rejected");
    expect(server.counts.tools).toEqual({ create_thread: 1 });
    expect(auth.reauthRequired).toBe(true);
  });

  it("never sends create_thread while polling, even when get_thread fails", async () => {
    for (const behaviour of [
      { kind: "status", status: 500 },
      { kind: "network_error" },
      { kind: "result", payload: { unexpected: true } },
    ] as const) {
      const { server, provider } = setup({ tools: { get_thread: [behaviour] } });
      const error = await failure(provider.getRun({ providerThreadId: THREAD_ID }));
      expect(error.outcome).toBe("read_failed");
      expect(server.counts.tools).toEqual({ get_thread: 1 });
      vi.unstubAllGlobals();
    }
  });
});
