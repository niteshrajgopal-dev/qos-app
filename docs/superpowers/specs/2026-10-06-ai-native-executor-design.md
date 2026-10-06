# Spec: Native Menu Manager executor (assessment PR 7)

Owner: QOS-129 / ADR-AI-02 decisions 2, 8, 11–13. Adds the native executor, an injected QOS model boundary, and a read-only native Menu Manager path. Hyperagent stays the default. PR 8 is the default switch.

## Objective

Give QOS a native Menu Manager that:

1. Runs on the existing AI worker, not inside the HTTP request.
2. Talks to a QOS-owned model interface. Tests inject a fake model. The Agents SDK stays inside one adapter.
3. Calls only the existing read tools `menu.get_health` and `menu.get_items` through the tool gateway.
4. Works with Hyperagent credentials, bindings and MCP configuration absent.
5. Reserves `menu_manager.native` spend on admission. Unset policy keeps the path off.

Success: an operator can enable native admission with flags and spend policy; a fake model completes a Menu Manager review without catalogue changes or a Hyperagent runtime; existing Hyperagent runs keep their pinned executor.

## Tech stack

Next.js 16 / TypeScript, Drizzle, Vitest (`fileParallelism=false`), Postgres. Next free migration id on `origin/main` is **0045**.

Pinned after verification (2026-10-06 official docs):

- `@openai/agents@0.18.0` — MIT, Node 22+, depends on `@openai/agents-core`, `@openai/agents-openai`, `@openai/agents-realtime`, `debug`, `openai@^7.2.0`. Zod v4 already in the repo.
- Tracing is on by default; the adapter must call `setTracingDisabled(true)` before any run.
- The injected OpenAI client must set `maxRetries: 0`. QOS is the only retry owner.
- Sources: https://www.npmjs.com/package/@openai/agents , https://openai.github.io/openai-agents-js/guides/config/ , https://openai.github.io/openai-agents-js/guides/models/

## Commands

```
npm run typecheck
npm run lint
npx vitest run src/lib/ai/model/qos-model.test.ts src/lib/agents/native/native-executor.test.ts src/lib/agents/native/native-model-config.test.ts src/lib/agents/execution-identity.test.ts src/lib/architecture/ai-provider-boundaries.test.ts src/lib/agents/menu-manager/menu-manager-definition.test.ts src/lib/agents/config.test.ts
npx vitest run src/lib/agents/native/native-menu-manager.integration.test.ts src/lib/db/ai-native-executor-migration.test.ts src/lib/agents/menu-manager/menu-manager-worker.integration.test.ts src/lib/agents/tools/tool-gateway.integration.test.ts
```

No browser tests. No real OpenAI calls. No paid evaluation.

## Project structure

```
src/lib/ai/model/qos-model.ts
src/lib/ai/model/qos-model.test.ts
src/lib/ai/model/fake-qos-model.ts
src/lib/agents/native/native-executor.ts
src/lib/agents/native/native-executor.test.ts
src/lib/agents/native/native-model-config.ts
src/lib/agents/native/native-model-config.test.ts
src/lib/agents/native/agents-sdk-model.ts
src/lib/agents/native/native-menu-manager.integration.test.ts
src/db/ai-native-executor-migration.test.ts
drizzle/0045_ai_native_executor.sql
docs/superpowers/specs/2026-10-06-ai-native-executor-design.md
```

Reuse, do not copy: tool gateway, execution context, Menu Manager result interpreter, spend admission, AI job handler, Hyperagent provider.

## Code style

Match spend-admission and Menu Manager: tenant transaction, Zod at the model-response boundary, no secrets in logs. Native identity is pinned on the run. SDK types (`Agent`, `Runner`, `Model`, session objects) never leave `src/lib/agents/native/agents-sdk-model.ts`.

```ts
export type QosModelRequest = {
  modelId: string;
  instructions: string;
  input: string;
  tools: ReadonlyArray<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
  toolResults?: ReadonlyArray<{ callId: string; output: unknown }>;
};

export type QosModelResult =
  | { type: "completed"; text: string; usage: Record<string, number> | null }
  | { type: "tool_calls"; calls: ReadonlyArray<{ callId: string; name: string; input: unknown }>; usage: Record<string, number> | null };

export type QosModel = {
  readonly provider: "openai" | "mock";
  readonly modelId: string;
  complete(request: QosModelRequest): Promise<QosModelResult>;
};

export const NATIVE_ADAPTER_VERSION = "agents-sdk.v1";
export const NATIVE_PROVIDER_AGENT_ID = "qos.menu_manager";
export const NATIVE_MENU_MANAGER_DEFINITION_VERSION = "menu_manager.v2";
```

## Testing strategy

- Unit: fake model returns completed JSON; native loop interprets it with the existing Menu Manager schema; tool-call then completed; max 4 tool rounds then fail `too_many_tool_rounds` as `failed_after_processing`; invalid JSON is `failed_after_processing`; model throw after send is `submission_unknown`; snapshot/event has no prompt/key; config refuses production mock; unknown model id throws before a network call; `agents-sdk-model` constructs `OpenAI({ maxRetries: 0 })` and calls `setTracingDisabled(true)` (asserted by reading source / a test double).
- Integration: native admission with Hyperagent env unset and no binding creates a `queued_worker` run, provider `agents_sdk`, `bindingId` null, spend reservation on `menu_manager.native`; worker step with fake model completes and consumes spend; uncertain prior dispatch goes to operator review and does not call the model again; Hyperagent admission is unchanged when the executor flag is unset; `qos_app` still has no DELETE on agent tables; scaler/worker grants unchanged.
- Boundary: `@openai/agents` and `openai` allowed only under `src/lib/agents/native/`; `OPENAI_API_KEY` allowed in photo config and native model config; routes still cannot import the provider registry.
- No real provider HTTP.

## Boundaries

- Always: tests before commit; host-confirmed operator CLIs unchanged; UTF-8 source; flags select new admissions only; pinned executor never rewritten; application quota labelling on spend.
- Ask first: Azure apply/deploy; changing live spend policy numbers; paid evaluation / real-provider smoke; Linear status; activating native as the default (PR 8); adding write or image tools.
- Never: auto-fallback from native to Hyperagent; inline native execution; agent-initiated image generation; install other model SDKs; print secrets; stash or overwrite unrelated dirty files in `C:\Dev\qosapp`; force-push; merge without owner PR.

## Architecture

```
askMenuManager (native flag)
  -> spend reserve menu_manager.native + createAgentRun (binding_id null) + enqueue
       -> AI worker menu_manager.run
            -> native executor (QOS loop, max 4 tool rounds)
                 -> QosModel (fake | Agents SDK adapter)
                 -> tool gateway (menu.get_health, menu.get_items)
            -> interpretMenuManagerReply
```

Hyperagent path is untouched when `AGENT_MENU_MANAGER_EXECUTOR` is unset or `hyperagent`.

### Migration 0045

1. `ALTER TYPE qos.agent_provider ADD VALUE IF NOT EXISTS 'agents_sdk';`
2. `ALTER TABLE qos.agent_runs ALTER COLUMN binding_id DROP NOT NULL;`
3. Check `agent_runs_binding_for_provider`: Hyperagent rows must have a binding; `agents_sdk` rows may be null.
4. Keep the composite FK. MATCH SIMPLE already allows a null `binding_id`.
5. No new table grants. No DELETE. No snapshot json.

### Identity

- `AgentProviderKind` and `ExecutorAdapter` gain `agents_sdk`.
- `PERSISTED_AGENT_PROVIDER_IDENTITY.agents_sdk` = `{ executorKind: "native", executorAdapter: "agents_sdk", adapterVersion: "agents-sdk.v1", modelProvider, modelId }` where model fields come from native config, never guessed for Hyperagent.
- `DEFAULT_AGENT_PROVIDER` stays `hyperagent`.
- Native readiness is “model configured”, not `agent_provider_connections`.

### Admission

New config:

- `AGENT_MENU_MANAGER_EXECUTOR` = `hyperagent` (default) | `native`
- `AGENT_NATIVE_MODEL_PROVIDER` = `openai` (default) | `mock` (refused in production)
- `AGENT_NATIVE_MODEL` = allowlisted id, default `gpt-4.1-mini` (`/^[a-z0-9][a-z0-9.-]{0,64}$/`)

Native is admissible only when: agents + Menu Manager flags on, executor `native`, execution mode `queued_worker`, spend policy for `menu_manager.native` + `openai` admissible, and the model is configured. Otherwise throw; do not fall back to Hyperagent.

`createAgentRun` accepts either a Hyperagent binding or a native admission `{ capability, provider: "agents_sdk", providerAgentId: "qos.menu_manager" }`. Native runs store `bindingId: null`.

`buildAgentExecutionContext` skips the binding check when `run.bindingId` is null and `run.provider === "agents_sdk"`. It still rechecks tenant active, membership and menu access.

Spend: reserve 1 unit on the menu public id in the creating transaction; store `spendReservationPublicId` in `requestSummary`. Worker `markDispatched` then `recordAiSpendOutcome`. Uncertain prior dispatch 뿯↽ operator review, no second model call.

### Definition

Keep `menu_manager.v1` for Hyperagent (`allowedTools: []`). Add `menu_manager.v2` with `allowedTools: ["menu.get_health", "menu.get_items"]` and pin `toolSchemaVersions` from `AGENT_TOOLS`. Native new runs use v2. Same input snapshot and result schema.

### Native loop

QOS owns the loop (ADR-AI-02 decision 13). One worker step runs up to 4 model rounds. `markDispatched` commits before the first `complete()`. Tools go through `executeAgentTool`. Final text is `interpretMenuManagerReply`. Cancellation is `local_stop_only`.

`ExecutorStepResult` is the assessment shape, mapped to `AiJobStepResult` by the job handler.

## Error handling

- Native + inline mode: fail admission, no run, no spend.
- Native + spend unset: existing `AiSpendAdmissionError`.
- Native + missing model key (openai): not dispatched, no spend.
- Invalid model JSON / too many tool rounds: fail run, spend `failed_after_processing`.
- Timeout/reset after the first model send: `submission_unknown`, operator review.
- Hyperagent flag path: existing errors only.

## Out of scope

Default switch (PR 8). Paid smoke. Native inline. Write tools. `media.create_image_candidate`. MCP (PRs 9/10). Azure apply. Retention/DELETE. Changing Hyperagent behaviour. Video worker.

## Success criteria

- [ ] Fake model + v2 definition completes a Menu Manager run with no Hyperagent env, binding or connection.
- [ ] Catalogue services and routes do not import `@openai/agents` or `openai`.
- [ ] Native admission is off unless flags + spend policy + queued_worker are set; no Hyperagent fallback.
- [ ] Existing Hyperagent inline and queued paths still pass their tests.
- [ ] Spend reserve/consume/uncertain follows admission rules; timer does not release uncertain.
- [ ] SDK adapter disables tracing and OpenAI client retries.
- [ ] No DELETE grants; no Azure; no paid calls.

## Open questions

None that block this PR. Exact production model id can change via `AGENT_NATIVE_MODEL` before anyone turns the path on. Paid evaluation remains an owner gate for PR 8.
