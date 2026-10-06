# AI MCP Adapter Implementation Plan

**Goal:** Add a flag-off, in-process, read-only QOS MCP adapter over the existing tool gateway. No public exposure.

**Spec:** `docs/superpowers/specs/2026-10-06-ai-mcp-adapter-design.md`

**Worktree:** `C:\Dev\qosapp-ai-mcp-adapter` on `feature/ai-mcp-adapter`. Do not touch dirty files in `C:\Dev\qosapp`.

## Global constraints

- TDD. New files UTF-8.
- Do not commit unless the owner asks.
- No HTTP listener, OAuth, DNS, Azure, Linear, or paid calls.

---

### Task 1: Config and principal

**Files:** `qos-mcp-config.ts`, `qos-mcp-principal.ts`, their tests.

- `AGENT_MCP_ADAPTER_ENABLED` default false.
- Host principal required; session IDs rejected.

### Task 2: Adapter

**Files:** `qos-mcp-adapter.ts` + test

- `McpServer` + `registerTool` for the two read tools only.
- Injected `invokeTool` hook (production wires `invokeAgentTool`).
- In-memory client/server pair for protocol tests.

### Task 3: Boundaries and docs

- Allow MCP SDK under `src/lib/agents/mcp/`.
- Adapter import rule: only `mcp/` and tests.
- `.env.example` comment: off, not a public endpoint.

### Task 4: Verify

Focused vitest, typecheck, lint.

## Risks

| Risk | Mitigation |
|---|---|
| Accidental public route | Do not add `src/app` or stdio entrypoints |
| Session ID treated as auth | Bind principal at construction; ignore `extra.sessionId` |
| Tool catalogue creep | Hard allowlist of two names, even if `AGENT_TOOLS` grows |