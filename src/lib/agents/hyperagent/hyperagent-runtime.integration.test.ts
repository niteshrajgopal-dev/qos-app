import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { readAgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import type { HyperagentToolCaller } from "@/lib/agents/hyperagent/hyperagent-mcp-client";
import type { QosOAuthClientProvider } from "@/lib/agents/hyperagent/hyperagent-oauth";
import { HyperagentProvider } from "@/lib/agents/hyperagent/hyperagent-provider";
import { createPersistedHyperagentToolCaller } from "@/lib/agents/hyperagent/hyperagent-runtime";
import {
  getAgentProviderConnectionStatus,
  loadAgentProviderCredentials,
  saveAgentProviderConnection,
} from "@/lib/agents/provider-connections";
import { getAgentRuntimeProvider } from "@/lib/agents/provider-registry";
import { AgentProviderError } from "@/lib/agents/types";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const SERVER_URL = "https://hyperagent.example/api/mcp";
const REDIRECT_URL = "http://127.0.0.1:33418/oauth/callback";
const credentialKey = parseAgentCredentialKey(randomBytes(32).toString("base64"));

type FakeTransport = (
  authProvider: QosOAuthClientProvider,
  name: string,
  args: Record<string, unknown>,
) => Promise<unknown>;

/** Stands in for the MCP SDK transport; it can drive the OAuth provider like the SDK would. */
function fakeTransport(behaviour: FakeTransport) {
  const seen: Array<{ serverUrl: string; accessToken: string | undefined }> = [];
  const createToolCaller = (options: {
    serverUrl: string;
    authProvider: QosOAuthClientProvider;
  }): HyperagentToolCaller => {
    return async (name, args) => {
      seen.push({
        serverUrl: options.serverUrl,
        accessToken: (await options.authProvider.tokens())?.access_token,
      });
      return behaviour(options.authProvider, name, args);
    };
  };
  return { createToolCaller, seen };
}

integrationDescribe("persisted Hyperagent runtime", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.agent_provider_credentials, qos.agent_provider_connections RESTART IDENTITY CASCADE`;
  });

  async function connect(overrides: Record<string, unknown> = {}) {
    await saveAgentProviderConnection(db, {
      provider: "hyperagent",
      serverUrl: SERVER_URL,
      connectedBySubject: "operator:test",
      credentialKey,
      credentials: {
        redirectUrl: REDIRECT_URL,
        clientInformation: { client_id: "client-1" },
        tokens: { access_token: "access-1", token_type: "Bearer", refresh_token: "refresh-1" },
        ...overrides,
      },
    });
  }

  it("uses the stored session and writes refreshed tokens back with a new version", async () => {
    await connect();
    const transport = fakeTransport(async (authProvider) => {
      await authProvider.saveTokens({
        access_token: "access-2",
        token_type: "Bearer",
        refresh_token: "refresh-2",
      });
      return { agents: [{ id: "cmun4w730017807adjrkbep1t", name: "QOS Menu Manager" }] };
    });
    const provider = new HyperagentProvider(
      createPersistedHyperagentToolCaller({
        db,
        credentialKey,
        serverUrl: SERVER_URL,
        createToolCaller: transport.createToolCaller,
      }),
    );

    await expect(provider.listAgents()).resolves.toHaveLength(1);
    expect(transport.seen).toEqual([{ serverUrl: SERVER_URL, accessToken: "access-1" }]);

    const stored = await loadAgentProviderCredentials(db, "hyperagent", credentialKey);
    expect(stored.version).toBe(2);
    expect(stored.credentials).toMatchObject({
      redirectUrl: REDIRECT_URL,
      clientInformation: { client_id: "client-1" },
      tokens: { access_token: "access-2", refresh_token: "refresh-2" },
    });

    await provider.listAgents();
    expect(transport.seen[1]?.accessToken).toBe("access-2");
  });

  it("still saves refreshed tokens when another replica wrote first", async () => {
    await connect();
    const transport = fakeTransport(async (authProvider) => {
      await saveAgentProviderConnection(db, {
        provider: "hyperagent",
        serverUrl: SERVER_URL,
        connectedBySubject: "operator:test",
        credentialKey,
        credentials: {
          redirectUrl: REDIRECT_URL,
          tokens: { access_token: "other-replica", token_type: "Bearer" },
        },
      });
      await authProvider.saveTokens({ access_token: "mine", token_type: "Bearer" });
      return { agents: [] };
    });

    await new HyperagentProvider(
      createPersistedHyperagentToolCaller({
        db,
        credentialKey,
        serverUrl: SERVER_URL,
        createToolCaller: transport.createToolCaller,
      }),
    ).listAgents();

    const stored = await loadAgentProviderCredentials(db, "hyperagent", credentialKey);
    expect(stored.version).toBe(3);
    expect(stored.credentials).toMatchObject({ tokens: { access_token: "mine" } });
  });

  it("marks the connection needs_reauth and stops calling once reauth is required", async () => {
    await connect();
    const transport = fakeTransport(async () => {
      throw new AgentProviderError("provider_reauth_required", "reauth", { requiresReauth: true });
    });
    const callTool = createPersistedHyperagentToolCaller({
      db,
      credentialKey,
      serverUrl: SERVER_URL,
      createToolCaller: transport.createToolCaller,
    });

    await expect(callTool("list_agents", {})).rejects.toMatchObject({ requiresReauth: true });
    await expect(getAgentProviderConnectionStatus(db, "hyperagent")).resolves.toMatchObject({
      status: "needs_reauth",
      lastErrorCode: "provider_reauth_required",
    });

    await expect(callTool("list_agents", {})).rejects.toMatchObject({
      code: "provider_reauth_required",
      requiresReauth: true,
    });
    expect(transport.seen).toHaveLength(1);
  });

  it("refuses to call a server other than the one the connection was authorized for", async () => {
    await connect();
    const transport = fakeTransport(async () => ({ agents: [] }));
    const callTool = createPersistedHyperagentToolCaller({
      db,
      credentialKey,
      serverUrl: "https://elsewhere.example/api/mcp",
      createToolCaller: transport.createToolCaller,
    });

    await expect(callTool("list_agents", {})).rejects.toMatchObject({
      code: "provider_misconfigured",
    });
    expect(transport.seen).toHaveLength(0);
  });

  it("reports not connected and a session without tokens as provider errors", async () => {
    const transport = fakeTransport(async () => ({ agents: [] }));
    const callTool = createPersistedHyperagentToolCaller({
      db,
      credentialKey,
      serverUrl: SERVER_URL,
      createToolCaller: transport.createToolCaller,
    });

    await expect(callTool("list_agents", {})).rejects.toMatchObject({
      code: "provider_not_connected",
    });

    await connect({ tokens: undefined });
    await expect(callTool("list_agents", {})).rejects.toMatchObject({
      code: "provider_reauth_required",
    });
    expect(transport.seen).toHaveLength(0);
  });

  it("only builds the real provider when agents are enabled and configured", () => {
    const disabled = readAgentConfig({
      HYPERAGENT_MCP_URL: SERVER_URL,
      AGENT_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    });
    expect(() => getAgentRuntimeProvider("hyperagent", { db, config: disabled })).toThrow(
      expect.objectContaining({ code: "provider_unavailable" }),
    );

    const unconfigured = readAgentConfig({ AGENTS_ENABLED: "true" });
    expect(() => getAgentRuntimeProvider("hyperagent", { db, config: unconfigured })).toThrow(
      expect.objectContaining({ code: "provider_unavailable" }),
    );

    const enabled = readAgentConfig({
      AGENTS_ENABLED: "true",
      HYPERAGENT_MCP_URL: SERVER_URL,
      AGENT_CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    });
    expect(getAgentRuntimeProvider("hyperagent", { db, config: enabled })).toBeInstanceOf(
      HyperagentProvider,
    );
  });
});
