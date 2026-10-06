import { describe, expect, it } from "vitest";

import {
  describeAgentConfig,
  isMenuManagerAvailable,
  readAgentConfig,
} from "@/lib/agents/config";

describe("agent config", () => {
  it("is off by default", () => {
    const config = readAgentConfig({});

    expect(config.enabled).toBe(false);
    expect(config.menuManagerEnabled).toBe(false);
    expect(config.hyperagentMcpUrl).toBeNull();
    expect(config.credentialEncryptionKey).toBeNull();
    expect(isMenuManagerAvailable(config)).toBe(false);
  });

  it("needs both the master switch and the capability flag", () => {
    expect(
      isMenuManagerAvailable(readAgentConfig({ AGENTS_ENABLED: "true" })),
    ).toBe(false);
    expect(
      isMenuManagerAvailable(readAgentConfig({ AGENT_MENU_MANAGER_ENABLED: "true" })),
    ).toBe(false);
    expect(
      isMenuManagerAvailable(
        readAgentConfig({ AGENTS_ENABLED: "true", AGENT_MENU_MANAGER_ENABLED: "1" }),
      ),
    ).toBe(true);
  });

  it("clamps poll timings so polling cannot be made aggressive", () => {
    const config = readAgentConfig({
      AGENT_RUN_POLL_INTERVAL_MS: "10",
      AGENT_RUN_POLL_LEASE_MS: "1",
      AGENT_RUN_TIMEOUT_MS: "999999999",
    });

    expect(config.pollIntervalMs).toBe(2_000);
    expect(config.pollLeaseMs).toBe(5_000);
    expect(config.runTimeoutMs).toBe(60 * 60_000);
  });

  it("admits Menu Manager through Hyperagent unless native is chosen explicitly", () => {
    expect(readAgentConfig({}).menuManagerExecutor).toBe("hyperagent");
    expect(readAgentConfig({ AGENT_MENU_MANAGER_EXECUTOR: " Native " }).menuManagerExecutor).toBe(
      "native",
    );
    expect(() => readAgentConfig({ AGENT_MENU_MANAGER_EXECUTOR: "openai" })).toThrow(
      "must be hyperagent or native",
    );
  });

  it("runs Menu Manager inline unless the worker mode is chosen explicitly", () => {
    expect(readAgentConfig({}).menuManagerExecutionMode).toBe("inline");
    expect(
      readAgentConfig({ AGENT_MENU_MANAGER_EXECUTION_MODE: " Queued_Worker " }).menuManagerExecutionMode,
    ).toBe("queued_worker");
    expect(() => readAgentConfig({ AGENT_MENU_MANAGER_EXECUTION_MODE: "worker" })).toThrow(
      "must be inline or queued_worker",
    );
  });

  it("requires an https MCP URL", () => {
    expect(() => readAgentConfig({ HYPERAGENT_MCP_URL: "http://example.com/mcp" })).toThrow(
      "must use https",
    );
    expect(
      readAgentConfig({ HYPERAGENT_MCP_URL: "https://example.com/mcp" }).hyperagentMcpUrl,
    ).toBe("https://example.com/mcp");
  });

  it("describes configuration without URLs or key material", () => {
    const description = describeAgentConfig(
      readAgentConfig({
        AGENTS_ENABLED: "true",
        HYPERAGENT_MCP_URL: "https://example.com/mcp",
        AGENT_CREDENTIAL_ENCRYPTION_KEY: "c2VjcmV0LWtleS1tYXRlcmlhbA==",
      }),
    );

    expect(description.hyperagentConfigured).toBe(true);
    expect(description.credentialKeyConfigured).toBe(true);
    const serialized = JSON.stringify(description);
    expect(serialized).not.toContain("example.com");
    expect(serialized).not.toContain("c2VjcmV0");
  });
});
