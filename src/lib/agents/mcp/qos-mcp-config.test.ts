import { describe, expect, it } from "vitest";

import { readQosMcpConfig } from "@/lib/agents/mcp/qos-mcp-config";

describe("QOS MCP adapter config", () => {
  it("is off by default", () => {
    expect(readQosMcpConfig({}).enabled).toBe(false);
  });

  it("turns on only for an explicit true flag", () => {
    expect(readQosMcpConfig({ AGENT_MCP_ADAPTER_ENABLED: "true" }).enabled).toBe(true);
    expect(readQosMcpConfig({ AGENT_MCP_ADAPTER_ENABLED: "1" }).enabled).toBe(true);
    expect(readQosMcpConfig({ AGENT_MCP_ADAPTER_ENABLED: "false" }).enabled).toBe(false);
  });

  it("approves no client unless the one allowed name is set", () => {
    expect(readQosMcpConfig({}).approvedClient).toBeNull();
    expect(
      readQosMcpConfig({ AGENT_MCP_APPROVED_CLIENT: " qos.operator.mcp.v1 " }).approvedClient,
    ).toBe("qos.operator.mcp.v1");
    expect(() => readQosMcpConfig({ AGENT_MCP_APPROVED_CLIENT: "cursor" })).toThrow(
      "must be qos.operator.mcp.v1",
    );
  });
});