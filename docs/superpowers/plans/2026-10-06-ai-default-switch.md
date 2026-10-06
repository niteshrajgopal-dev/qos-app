# AI Default Switch Implementation Plan

**Goal:** Make native the Menu Manager admission default. Hyperagent becomes opt-in. In-flight runs drain on their pinned executor.

**Spec:** `docs/superpowers/specs/2026-10-06-ai-default-switch-design.md`

**Worktree:** `C:\Dev\qosapp-ai-default-switch` on `feature/ai-default-switch`. Do not touch dirty files in `C:\Dev\qosapp`.

## Global constraints

- TDD. `fileParallelism=false` is already configured.
- New files UTF-8.
- Never `qosapp-db-1`. Never print secrets. Never paid OpenAI calls.
- Do not commit unless the owner asks.
- No migration. No Azure. No Linear.

---

### Task 1: Config defaults (unit)

**Files:** `src/lib/agents/config.ts`, `src/lib/agents/config.test.ts`

- Unset executor → `native`.
- Unset mode → `queued_worker` when executor is native, else `inline`.
- Explicit mode always wins.

### Task 2: Pin Hyperagent suites

Add `AGENT_MENU_MANAGER_EXECUTOR=hyperagent` to Hyperagent fixtures that omitted it. Pin native inline-refusal to explicit `inline`.

### Task 3: Default-switch and drain regressions

**Files:** native + pinning integration tests

- Unset executor admits native.
- Missing model/spend does not fall back to Hyperagent.
- Changing process config after admission does not rewrite the pinned executor.

### Task 4: Docs

`.env.example` and config comments: native is the default; Hyperagent is opt-in.

### Task 5: Verify

Focused vitest, typecheck, lint. Skip the full integration DROP SCHEMA suite.

## Risks

| Risk | Mitigation |
|---|---|
| Hyperagent tests silently take the native path | Pin executor on every Hyperagent fixture |
| Unset mode + native becomes queued_worker and hides the inline-native 409 | Keep an explicit `inline` fixture |
| Operators enable agents without spend/model | Same refuse-closed path as PR 7; default does not invent a fallback |