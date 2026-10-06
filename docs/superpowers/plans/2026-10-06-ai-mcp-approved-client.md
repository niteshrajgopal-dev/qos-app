# AI MCP Approved Client Implementation Plan

**Goal:** Add the one approved in-process MCP client. No public exposure.

**Spec:** `docs/superpowers/specs/2026-10-06-ai-mcp-approved-client-design.md`

**Worktree:** `C:\Dev\qosapp-ai-mcp-approved-client` on `feature/ai-mcp-approved-client`. Do not touch `C:\Dev\qosapp`.

## Tasks

1. Extend `readQosMcpConfig` with `approvedClient`.
2. Add `connectQosMcpApprovedClient` over the existing adapter.
3. Update `.env.example`. Verify focused tests, typecheck, lint.

## Risks

| Risk | Mitigation |
|---|---|
| Accidental public route | No `src/app` files |
| Arbitrary client names | Hard allowlist of one name |
| Session ID as auth | Reuse `assertQosMcpPrincipal` |