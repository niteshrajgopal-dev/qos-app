import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createQosMcpAdapter } from "@/lib/agents/mcp/qos-mcp-adapter";
import type { AgentToolResult } from "@/lib/agents/tools/tool-gateway";

const PRINCIPAL = { tenantId: "ten_1", runPublicId: "run_1", subject: "admin@test" };

function ok(tool: string, output: unknown): AgentToolResult {
  return {
    ok: true,
    tool,
    version: `${tool}.v1`,
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

describe("QOS MCP adapter", () => {
  const closers: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (closers.length > 0) {
      await closers.pop()!();
    }
  });

  async function connect(invokeTool: (request: {
    tenantId: string;
    runPublicId: string;
    tool: string;
    input: unknown;
  }) => Promise<AgentToolResult>) {
    const adapter = createQosMcpAdapter({ enabled: true, principal: PRINCIPAL, invokeTool });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "qos-test", version: "1.0.0" });
    await adapter.connect(serverTransport);
    await client.connect(clientTransport);
    closers.push(async () => {
      await client.close();
      await adapter.close();
    });
    return { client, invokeTool };
  }

  it("refuses to construct when the adapter flag is off", () => {
    expect(() =>
      createQosMcpAdapter({ enabled: false, principal: PRINCIPAL, invokeTool: vi.fn() }),
    ).toThrow("disabled");
  });

  it("lists only the two read-only Menu Manager tools", async () => {
    const { client } = await connect(async () => ok("menu.get_health", {}));
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name).sort()).toEqual(["menu.get_health", "menu.get_items"]);
    expect(listed.tools.every((tool) => tool.annotations?.readOnlyHint === true)).toBe(true);
  });

  it("forwards a tool call through the host principal to the tool gateway", async () => {
    const invokeTool = vi.fn(async () => ok("menu.get_health", { menuPublicId: "men_1" }));
    const { client } = await connect(invokeTool);

    const result = await client.callTool({ name: "menu.get_health", arguments: {} });
    expect(invokeTool).toHaveBeenCalledWith({
      tenantId: "ten_1",
      runPublicId: "run_1",
      tool: "menu.get_health",
      input: {},
    });
    expect(result.isError).not.toBe(true);
    expect(JSON.stringify(result.content)).toContain("men_1");
  });

  it("returns a gateway failure as an MCP tool error without leaking the principal", async () => {
    const { client } = await connect(async () => ({
      ok: false,
      tool: "menu.get_items",
      code: "out_of_scope",
      message: "Only products accepted for this run may be requested.",
    }));

    const result = await client.callTool({
      name: "menu.get_items",
      arguments: { productPublicIds: ["prd_secret"] },
    });
    expect(result.isError).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).toContain("out_of_scope");
    expect(serialized).not.toContain("ten_1");
    expect(serialized).not.toContain("admin@test");
  });
});