import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createQosMcpAdapter, type QosMcpInvokeTool } from "@/lib/agents/mcp/qos-mcp-adapter";
import { QOS_MCP_APPROVED_CLIENT, type QosMcpConfig } from "@/lib/agents/mcp/qos-mcp-config";
import { assertQosMcpPrincipal, type QosMcpPrincipal } from "@/lib/agents/mcp/qos-mcp-principal";

export { QOS_MCP_APPROVED_CLIENT };

export type QosMcpApprovedClient = {
  readonly clientName: typeof QOS_MCP_APPROVED_CLIENT;
  listTools(): Promise<readonly string[]>;
  callTool(
    name: string,
    input?: unknown,
  ): Promise<{ ok: true; output: unknown } | { ok: false; code: string; message: string }>;
  close(): Promise<void>;
};

function textOf(result: unknown) {
  if (!result || typeof result !== "object" || !("content" in result)) {
    return "";
  }
  const first = Array.isArray(result.content) ? result.content[0] : null;
  return first && typeof first === "object" && "text" in first && typeof first.text === "string"
    ? first.text
    : "";
}

function isToolError(result: unknown) {
  return Boolean(result && typeof result === "object" && "isError" in result && result.isError);
}

export async function connectQosMcpApprovedClient(options: {
  config: QosMcpConfig;
  principal: QosMcpPrincipal;
  clientName: string;
  invokeTool: QosMcpInvokeTool;
}): Promise<QosMcpApprovedClient> {
  if (!options.config.enabled) {
    throw new Error("QOS MCP adapter is disabled.");
  }
  if (!options.config.approvedClient) {
    throw new Error("QOS MCP has no approved client.");
  }
  if (options.clientName !== options.config.approvedClient) {
    throw new Error("QOS MCP client is not the approved client.");
  }
  const principal = assertQosMcpPrincipal(options.principal);
  const adapter = createQosMcpAdapter({
    enabled: true,
    principal,
    invokeTool: options.invokeTool,
  });
  const client = new Client({ name: QOS_MCP_APPROVED_CLIENT, version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await adapter.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    clientName: QOS_MCP_APPROVED_CLIENT,
    async listTools() {
      const listed = await client.listTools();
      return listed.tools.map((tool) => tool.name).sort();
    },
    async callTool(name, input) {
      const result = await client.callTool({ name, arguments: (input ?? {}) as Record<string, unknown> });
      const text = textOf(result);
      if (isToolError(result)) {
        try {
          const parsed = JSON.parse(text) as { code?: string; message?: string };
          return { ok: false, code: parsed.code ?? "tool_failed", message: parsed.message ?? text };
        } catch {
          return { ok: false, code: "tool_failed", message: text || "The tool failed." };
        }
      }
      return { ok: true, output: text ? (JSON.parse(text) as unknown) : null };
    },
    async close() {
      await client.close();
      await adapter.close();
    },
  };
}