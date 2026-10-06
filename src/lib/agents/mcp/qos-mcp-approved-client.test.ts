import { afterEach, describe, expect, it, vi } from "vitest";

import {
  connectQosMcpApprovedClient,
  QOS_MCP_APPROVED_CLIENT,
} from "@/lib/agents/mcp/qos-mcp-approved-client";
import type { QosMcpConfig } from "@/lib/agents/mcp/qos-mcp-config";
import type { AgentToolResult } from "@/lib/agents/tools/tool-gateway";

const PRINCIPAL = { tenantId: "ten_1", runPublicId: "run_1", subject: "admin@test" };
const ENABLED: QosMcpConfig = { enabled: true, approvedClient: QOS_MCP_APPROVED_CLIENT };

function ok(output: unknown): AgentToolResult {
  return {
    ok: true,
    tool: "menu.get_health",
    version: "menu.get_health.v1",
    output,
    evidence: {
      dataSource: "current",
      menuVersion: 1,
      acceptedMenuVersion: 1,
      asOf: "2026-10-06T00:00:00.000Z",
      snapshotSha256: null,
    },
  };
}

describe("QOS MCP approved client", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length > 0) {
      await closers.pop()!();
    }
  });

  it("refuses to connect unless the adapter is on and the approved client is configured", async () => {
    const invokeTool = vi.fn();
    await expect(
      connectQosMcpApprovedClient({
        config: { enabled: false, approvedClient: QOS_MCP_APPROVED_CLIENT },
        principal: PRINCIPAL,
        clientName: QOS_MCP_APPROVED_CLIENT,
        invokeTool,
      }),
    ).rejects.toThrow("disabled");
    await expect(
      connectQosMcpApprovedClient({
        config: { enabled: true, approvedClient: null },
        principal: PRINCIPAL,
        clientName: QOS_MCP_APPROVED_CLIENT,
        invokeTool,
      }),
    ).rejects.toThrow("no approved client");
    expect(invokeTool).not.toHaveBeenCalled();
  });

  it("refuses a client that is not the approved name", async () => {
    await expect(
      connectQosMcpApprovedClient({
        config: ENABLED,
        principal: PRINCIPAL,
        clientName: "cursor",
        invokeTool: vi.fn(),
      }),
    ).rejects.toThrow("not the approved client");
  });

  it("lists and calls the read tools through the host principal", async () => {
    const invokeTool = vi.fn(async () => ok({ menuPublicId: "men_1" }));
    const client = await connectQosMcpApprovedClient({
      config: ENABLED,
      principal: PRINCIPAL,
      clientName: QOS_MCP_APPROVED_CLIENT,
      invokeTool,
    });
    closers.push(() => client.close());

    expect(client.clientName).toBe("qos.operator.mcp.v1");
    await expect(client.listTools()).resolves.toEqual(["menu.get_health", "menu.get_items"]);
    await expect(client.callTool("menu.get_health", {})).resolves.toEqual({
      ok: true,
      output: { menuPublicId: "men_1" },
    });
    expect(invokeTool).toHaveBeenCalledWith({
      tenantId: "ten_1",
      runPublicId: "run_1",
      tool: "menu.get_health",
      input: {},
    });
  });
});