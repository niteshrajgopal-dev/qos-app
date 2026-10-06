import { describe, expect, it } from "vitest";

import {
  executionIdentityForNative,
  executionIdentityForPersistedProvider,
  NATIVE_ADAPTER_VERSION,
  NATIVE_PROVIDER_AGENT_ID,
} from "@/lib/agents/execution-identity";

describe("execution identity", () => {
  it("keeps Hyperagent as an external executor with unknown model", () => {
    expect(executionIdentityForPersistedProvider("hyperagent")).toEqual({
      executorKind: "external",
      executorAdapter: "hyperagent",
      adapterVersion: "hyperagent-mcp.v1",
      modelProvider: null,
      modelId: null,
    });
  });

  it("records native identity from config, never by guessing a model", () => {
    expect(executionIdentityForPersistedProvider("agents_sdk")).toMatchObject({
      executorKind: "native",
      executorAdapter: "agents_sdk",
      adapterVersion: NATIVE_ADAPTER_VERSION,
      modelProvider: null,
      modelId: null,
    });
    expect(executionIdentityForNative({ provider: "mock", modelId: "fake-model" })).toEqual({
      executorKind: "native",
      executorAdapter: "agents_sdk",
      adapterVersion: NATIVE_ADAPTER_VERSION,
      modelProvider: "mock",
      modelId: "fake-model",
    });
    expect(NATIVE_PROVIDER_AGENT_ID).toBe("qos.menu_manager");
  });
});
