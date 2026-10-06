# Spec: Thin read-only QOS MCP adapter (assessment PR 9)

Owner: QOS-133 / ADR-AI-02 decision 11. Native tools already go through the in-process gateway. This slice adds a thin MCP server over that same gateway. It does not expose a public endpoint, register a client, or decide the external principal model (PR 10).

## Objective

Give QOS an in-process, flag-off MCP adapter that:

1. Lists only the existing read-only tools `menu.get_health` and `menu.get_items`.
2. Executes them only through `invokeAgentTool`.
3. Requires a host-authenticated principal (`tenantId`, `runPublicId`, `subject`). MCP session IDs, menu IDs and thread IDs are not authentication.
4. Does not listen on HTTP, stdio, or DNS. Tests use the SDK `InMemoryTransport`.
5. Stays off unless `AGENT_MCP_ADAPTER_ENABLED` is true.

Success: an in-memory MCP client can list and call the two read tools against a fake gateway; a session ID alone cannot authorize a call; catalogue services and routes do not import the MCP SDK or this adapter.

## Tech stack

Next.js 16 / TypeScript, Vitest. Existing `@modelcontextprotocol/sdk@1.31.0` (already a Hyperagent client dependency). Official 1.31 APIs used:

- `McpServer` + `registerTool` from `@modelcontextprotocol/sdk/server/mcp.js`
- `InMemoryTransport.createLinkedPair()` from `@modelcontextprotocol/sdk/inMemory.js`
- `Client` from `@modelcontextprotocol/sdk/client/index.js`

Sources: https://unpkg.com/@modelcontextprotocol/sdk@1.31.0/README.md , https://unpkg.com/@modelcontextprotocol/sdk@1.31.0/dist/esm/server/mcp.d.ts , https://unpkg.com/@modelcontextprotocol/sdk@1.31.0/dist/esm/inMemory.d.ts

No new dependency. No migration.

## Commands

```
npm run typecheck
npm run lint
npx vitest run src/lib/agents/mcp/qos-mcp-config.test.ts src/lib/agents/mcp/qos-mcp-adapter.test.ts src/lib/architecture/ai-provider-boundaries.test.ts
```

No browser tests. No public MCP server. No OAuth. No Azure.

## Project structure

```
src/lib/agents/mcp/qos-mcp-config.ts
src/lib/agents/mcp/qos-mcp-config.test.ts
src/lib/agents/mcp/qos-mcp-principal.ts
src/lib/agents/mcp/qos-mcp-adapter.ts
src/lib/agents/mcp/qos-mcp-adapter.test.ts
docs/superpowers/specs/2026-10-06-ai-mcp-adapter-design.md
docs/superpowers/plans/2026-10-06-ai-mcp-adapter.md
```

Reuse: `invokeAgentTool`, `AGENT_TOOLS`. Do not copy tool authorization into the adapter.

## Code style

SDK types stay inside `src/lib/agents/mcp/`. The host binds a principal at construction; tool handlers ignore `extra.sessionId`.

```ts
export type QosMcpPrincipal = {
  tenantId: string;
  runPublicId: string;
  subject: string;
};

export const QOS_MCP_ALLOWED_TOOLS = ["menu.get_health", "menu.get_items"] as const;
```

## Testing strategy

- Config: unset flag is off; `true`/`1` enable; unknown values throw.
- Principal: missing tenant/run/subject fails; `sessionId` alone fails; `subject === sessionId` fails.
- Adapter: disabled construction throws; in-memory client lists only the two tools; `callTool` forwards tenant/run to `invokeAgentTool`; a session id on the transport does not change the bound principal; gateway failure returns `isError` without leaking secrets.
- Boundary: MCP SDK allowed under `src/lib/agents/mcp/` and Hyperagent; routes still cannot import the adapter.

## Boundaries

- Always: tests before commit; UTF-8; tools stay read-only; principal is host-injected.
- Ask first: public HTTP/stdio listener; OAuth; approved external client; hostname/DNS; Azure; Linear.
- Never: treat MCP session IDs as auth; add write or image tools; public deployment; stash dirty files in `C:\Dev\qosapp`.

## Architecture

```
host (already authenticated)
  -> createQosMcpAdapter({ principal, invokeTool })
       -> McpServer.registerTool(menu.get_health | menu.get_items)
            -> invokeAgentTool({ tenantId, runPublicId, tool, input })
```

Native Menu Manager still calls the gateway directly. MCP is not an internal dependency of the executor.

## Out of scope

PR 10 (approved client, exposure, OAuth, hostname). Write tools. Public Streamable HTTP. Azure. Paid smoke.

## Success criteria

- [ ] Flag off by default; adapter cannot be constructed when off.
- [ ] Only the two read Menu Manager tools are listed.
- [ ] Calls go through `invokeAgentTool` with the host principal.
- [ ] Session IDs cannot authorize or re-scope a call.
- [ ] No HTTP route, DNS, or OAuth added.
- [ ] Boundary tests updated and passing.

## Open questions

External principal/delegation model, first client and hostname remain owner decisions for PR 10.