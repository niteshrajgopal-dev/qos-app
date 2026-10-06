import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { AGENT_TOOLS } from "@/lib/agents/tools/menu-tools";
import type { AgentToolResult } from "@/lib/agents/tools/tool-gateway";
import { assertQosMcpPrincipal, type QosMcpPrincipal } from "@/lib/agents/mcp/qos-mcp-principal";

export const QOS_MCP_ALLOWED_TOOLS = ["menu.get_health", "menu.get_items"] as const;
export const QOS_MCP_ADAPTER_VERSION = "qos-mcp.v1";

const TOOL_DESCRIPTIONS: Record<(typeof QOS_MCP_ALLOWED_TOOLS)[number], string> = {
  "menu.get_health": "Current health of the products accepted for this Menu Manager run.",
  "menu.get_items": "Accepted-snapshot detail for selected products on this run.",
};

export type QosMcpInvokeTool = (request: {
  tenantId: string;
  runPublicId: string;
  tool: string;
  input: unknown;
}) => Promise<AgentToolResult>;

export function createQosMcpAdapter(options: {
  enabled: boolean;
  principal: QosMcpPrincipal;
  invokeTool: QosMcpInvokeTool;
}) {
  if (!options.enabled) {
    throw new Error("QOS MCP adapter is disabled.");
  }
  const principal = assertQosMcpPrincipal(options.principal);
  const server = new McpServer({ name: "qos", version: QOS_MCP_ADAPTER_VERSION });

  for (const name of QOS_MCP_ALLOWED_TOOLS) {
    const tool = AGENT_TOOLS.get(name);
    if (!tool || tool.risk !== "read_only") {
      throw new Error(`QOS MCP cannot expose ${name}.`);
    }
    server.registerTool(
      name,
      {
        description: TOOL_DESCRIPTIONS[name],
        inputSchema: tool.input,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      },
      async (args) => {
        const result = await options.invokeTool({
          tenantId: principal.tenantId,
          runPublicId: principal.runPublicId,
          tool: name,
          input: args ?? {},
        });
        if (!result.ok) {
          return {
            isError: true,
            content: [{ type: "text", text: JSON.stringify({ code: result.code, message: result.message }) }],
          };
        }
        return {
          content: [{ type: "text", text: JSON.stringify(result.output) }],
        };
      },
    );
  }

  return server;
}