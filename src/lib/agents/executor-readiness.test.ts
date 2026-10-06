import { beforeEach, describe, expect, it, vi } from "vitest";

import type { DbClient } from "@/db/client";
import {
  DEFAULT_AGENT_PROVIDER,
  getAgentExecutorReadiness,
  reportAgentExecutorReauthRequired,
} from "@/lib/agents/executor-readiness";
import type { AgentConnectionStatus } from "@/lib/agents/types";

const connections = vi.hoisted(() => ({
  getAgentProviderConnectionStatus: vi.fn(),
  markAgentProviderConnectionStatus: vi.fn(),
}));
const nativeModel = vi.hoisted(() => ({
  isNativeModelConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/agents/provider-connections", () => connections);
vi.mock("@/lib/agents/native/native-model-config", () => nativeModel);

const db = {} as DbClient;

function connectionRow(status: AgentConnectionStatus) {
  return {
    provider: "hyperagent",
    status,
    accountLabel: "ops@example.com",
    connectedAt: null,
    lastCheckedAt: "2026-10-02T10:00:00.000Z",
    lastErrorCode: null,
  };
}

describe("agent executor readiness", () => {
  beforeEach(() => {
    connections.getAgentProviderConnectionStatus.mockReset();
    connections.markAgentProviderConnectionStatus.mockReset();
    nativeModel.isNativeModelConfigured.mockReset();
    nativeModel.isNativeModelConfigured.mockReturnValue(false);
  });

  it("keeps Hyperagent as the binding-less readiness lookup", () => {
    expect(DEFAULT_AGENT_PROVIDER).toBe("hyperagent");
  });

  it.each<[AgentConnectionStatus, boolean]>([
    ["connected", true],
    ["disconnected", false],
    ["needs_reauth", false],
    ["error", false],
  ])("Hyperagent with a %s connection is ready=%s", async (status, ready) => {
    connections.getAgentProviderConnectionStatus.mockResolvedValue(connectionRow(status));

    await expect(getAgentExecutorReadiness(db, "hyperagent")).resolves.toEqual({
      provider: "hyperagent",
      ready,
      connection: { status, lastCheckedAt: "2026-10-02T10:00:00.000Z" },
    });
    expect(connections.getAgentProviderConnectionStatus).toHaveBeenCalledWith(db, "hyperagent");
  });

  it("does not expose account details in readiness", async () => {
    connections.getAgentProviderConnectionStatus.mockResolvedValue(connectionRow("connected"));
    const readiness = await getAgentExecutorReadiness(db, "hyperagent");
    expect(JSON.stringify(readiness)).not.toContain("ops@example.com");
  });

  it("treats native as ready only when a model is configured, without reading Hyperagent connections", async () => {
    await expect(getAgentExecutorReadiness(db, "agents_sdk")).resolves.toEqual({
      provider: "agents_sdk",
      ready: false,
      connection: { status: "disconnected", lastCheckedAt: null },
    });
    expect(connections.getAgentProviderConnectionStatus).not.toHaveBeenCalled();
  });

  it("records reauth on the executor's own connection", async () => {
    await reportAgentExecutorReauthRequired(db, "hyperagent", "provider_reauth_required");
    expect(connections.markAgentProviderConnectionStatus).toHaveBeenCalledWith(db, "hyperagent", {
      status: "needs_reauth",
      errorCode: "provider_reauth_required",
    });
  });
});
