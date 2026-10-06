# AI Native Executor Implementation Plan

**Goal:** Add a native Menu Manager path that uses an injected QOS model, read-only tools, and `menu_manager.native` spend, without changing the Hyperagent default.

**Spec:** `docs/superpowers/specs/2026-10-06-ai-native-executor-design.md`

**Worktree:** `C:\Dev\qosapp-ai-native-executor` on `feature/ai-native-executor`. Do not touch dirty files in `C:\Dev\qosapp`.

## Global constraints

- TDD. `fileParallelism=false` is already configured.
- New files UTF-8.
- Never `qosapp-db-1`. Never print secrets. Never paid OpenAI calls.
- Do not commit unless the owner asks.
- Do not change Hyperagent behaviour when the executor flag is unset.

---

### Task 1: Identity and config

**Files:** `execution-identity.ts` (both), `types.ts`, `config.ts`, `executor-readiness.ts`, their tests.

- Add `agents_sdk` to provider/adapter kinds and the persisted identity table.
- Add `menuManagerExecutor: "hyperagent" | "native"` (default hyperagent).
- Native readiness does not read Hyperagent connections.

### Task 2: QosModel + fake

**Files:** `src/lib/ai/model/*`

- Contract + fake that scripts completed / tool_calls / throws.
- Unit tests only.

### Task 3: Native loop

**Files:** `src/lib/agents/native/native-executor.ts` + test

- Bounded 4-round loop, gateway hook injected, interpret final text.
- No DB, no SDK.

### Task 4: Migration 0045

**Files:** `drizzle/0045_ai_native_executor.sql`, journal idx 45 when `1791800000000`, schema, migration test.

### Task 5: Admission + context

**Files:** `agent-runs.ts`, `execution-context.ts`, `menu-manager-service.ts`, `menu-manager-definition.ts`

- Native create without binding; v2 definition; spend reserve in `onCreated`.
- Context skips binding when `bindingId` is null and provider is `agents_sdk`.

### Task 6: Worker path

**Files:** `menu-manager-job.ts`, `scripts/ai-worker.ts`

- Branch on pinned `executorKind`. Fake/model injected in tests.

### Task 7: Pin SDK + adapter

- `npm install @openai/agents@0.18.0` in the worktree.
- Adapter: `setTracingDisabled(true)`, `OpenAI({ apiKey, maxRetries: 0 })`.
- Update boundary allowlists.

### Task 8: Integration + verify

- Native without Hyperagent; Hyperagent regression; typecheck; lint; focused vitest.

## Risks

| Risk | Mitigation |
|---|---|
| Binding FK rejects null | MATCH SIMPLE; add check for Hyperagent |
| Execution context still requires binding | Skip only for native null binding |
| SDK retries / tracing | Client `maxRetries: 0`, `setTracingDisabled(true)` |
| Accidental default switch | Flag default `hyperagent` |
