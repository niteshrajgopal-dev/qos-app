# Spec: One approved QOS MCP client (assessment PR 10)

Owner: QOS-133 / ADR-AI-02 decision 11. PR 9 added the in-process adapter. This slice adds the only supported client identity. It does not choose a public hostname, OAuth issuer, or DNS.

## Objective

Allow exactly one named client to use the QOS MCP adapter:

1. The approved name is `qos.operator.mcp.v1`.
2. Unset `AGENT_MCP_APPROVED_CLIENT` means no client may connect.
3. Any other name is rejected.
4. The host still injects the principal. Session IDs are not authentication.
5. Connection is in-process (`InMemoryTransport`). No HTTP, stdio listener, DNS, or OAuth.

Success: the approved client can list and call the two read tools; an unknown or unset client cannot connect; routes still do not import the MCP SDK.

## Tech stack

Same as PR 9: `@modelcontextprotocol/sdk@1.31.0`, `Client`, `InMemoryTransport`. No new dependency. No migration.

Sources: https://unpkg.com/@modelcontextprotocol/sdk@1.31.0/README.md , https://unpkg.com/@modelcontextprotocol/sdk@1.31.0/dist/esm/inMemory.d.ts

## Commands

```
npm run typecheck
npx eslint src/lib/agents/mcp src/lib/architecture/ai-provider-boundaries.test.ts
npx vitest run src/lib/agents/mcp/qos-mcp-config.test.ts src/lib/agents/mcp/qos-mcp-approved-client.test.ts src/lib/architecture/ai-provider-boundaries.test.ts
```

## Project structure

```
src/lib/agents/mcp/qos-mcp-config.ts
src/lib/agents/mcp/qos-mcp-approved-client.ts
src/lib/agents/mcp/qos-mcp-approved-client.test.ts
```

Reuse `createQosMcpAdapter`. Do not add `src/app` routes.

## Code style

SDK `Client` stays inside `qos-mcp-approved-client.ts`. The exported surface is QOS-owned:

```ts
export const QOS_MCP_APPROVED_CLIENT = "qos.operator.mcp.v1";

export type QosMcpApprovedClient = {
  readonly clientName: typeof QOS_MCP_APPROVED_CLIENT;
  listTools(): Promise<readonly string[]>;
  callTool(name: string, input?: unknown): Promise<
    | { ok: true; output: unknown }
    | { ok: false; code: string; message: string }
  >;
  close(): Promise<void>;
};
```

## Testing strategy

- Config: unset approved client is null; only `qos.operator.mcp.v1` parses; other values throw.
- Connect: adapter off / client unset / wrong name all refuse.
- Matching name + host principal lists the two tools and forwards a call through the gateway hook.

## Boundaries

- Always: host principal; one client name; in-process only.
- Ask first: public HTTP/stdio; OAuth; hostname/DNS; Azure; Linear.
- Never: treat session IDs as auth; add a second client; deploy MCP.

## Out of scope

Public exposure. OAuth. Hostname. Write tools. Azure.

## Success criteria

- [ ] Unset approved client blocks connection.
- [ ] Only `qos.operator.mcp.v1` can connect.
- [ ] Approved client uses the adapter and host principal.
- [ ] No HTTP route, DNS, or OAuth.