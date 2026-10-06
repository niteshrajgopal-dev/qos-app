# Spec: Native Menu Manager default (assessment PR 8)

Owner: QOS-129 / ADR-AI-02 decisions 2, 17. PR 7 added the native executor with Hyperagent still the admission default. This slice flips that default after the isolated native path exists. Paid OpenAI evaluation remains an owner gate and is not this PR.

## Objective

New Menu Manager admissions use the native executor and the AI worker unless an operator opts back into Hyperagent.

1. Unset `AGENT_MENU_MANAGER_EXECUTOR` means `native`.
2. Unset `AGENT_MENU_MANAGER_EXECUTION_MODE` means `queued_worker` when the resolved executor is native, otherwise `inline`.
3. An explicit mode always wins, including `native` + `inline`, which admission still refuses.
4. Hyperagent is opt-in: `AGENT_MENU_MANAGER_EXECUTOR=hyperagent`.
5. Flags select new admissions only. In-flight runs keep the pinned executor and mode.
6. Native never falls back to Hyperagent when spend, model, or queued_worker is missing.

Success: enabling the existing agent flags plus a configured model and `menu_manager.native` spend admits a native queued run. Unset spend policy still keeps paid work off. Existing Hyperagent tests pass when they pin the Hyperagent executor.

## Tech stack

Next.js 16 / TypeScript, Drizzle, Vitest (`fileParallelism=false`), Postgres. No migration. No new dependency.

## Commands

```
npm run typecheck
npm run lint
npx vitest run src/lib/agents/config.test.ts src/lib/agents/execution-identity.test.ts src/lib/agents/menu-manager/menu-manager-definition.test.ts
npx vitest run src/lib/agents/menu-manager/menu-manager-native.integration.test.ts src/lib/agents/menu-manager/menu-manager-pinning.integration.test.ts src/lib/agents/menu-manager/menu-manager-worker.integration.test.ts
```

No browser tests. No real OpenAI calls. No Azure apply. No Linear status change.

## Project structure

```
src/lib/agents/config.ts
src/lib/agents/config.test.ts
src/lib/agents/menu-manager/menu-manager-native.integration.test.ts
src/lib/agents/menu-manager/menu-manager-pinning.integration.test.ts
.env.example
docs/superpowers/specs/2026-10-06-ai-default-switch-design.md
docs/superpowers/plans/2026-10-06-ai-default-switch.md
```

Reuse: native admission, spend reserve, worker branch on pinned `executorKind`, Hyperagent path when the executor flag is `hyperagent`.

## Code style

Match PR 7 config parsing: trim, lowercase, throw on unknown values. Parse executor first so the unset mode can depend on it.

```ts
const executor = parseExecutor(source.AGENT_MENU_MANAGER_EXECUTOR);
const mode = parseExecutionMode(source.AGENT_MENU_MANAGER_EXECUTION_MODE, executor);
```

## Testing strategy

- Unit: unset executor is native; explicit `hyperagent` still works; unset mode is `queued_worker` for native and `inline` for Hyperagent; explicit `inline` on native still parses as `inline`; unknown values still throw.
- Integration: unset executor + model + spend admits `agents_sdk` / `queued_worker`; native refuse (no model / inline) does not create a Hyperagent run even when a binding exists; a Hyperagent run admitted before a flag flip still polls/completes on Hyperagent; a native run still executes on the worker when the process config is later Hyperagent.
- Hyperagent suites that omitted the executor flag pin `AGENT_MENU_MANAGER_EXECUTOR=hyperagent`.

## Boundaries

- Always: tests before commit; flags select new admissions only; pinned executor never rewritten; UTF-8 source.
- Ask first: Azure apply/deploy; paid evaluation / real-provider smoke; Linear status; changing live spend policy numbers.
- Never: auto-fallback from native to Hyperagent; migrate existing runs; print secrets; stash or overwrite dirty files in `C:\Dev\qosapp`; force-push.

## Architecture

```
unset AGENT_MENU_MANAGER_EXECUTOR
  -> native
     unset AGENT_MENU_MANAGER_EXECUTION_MODE -> queued_worker
     askNativeMenuManager (spend + model required; no Hyperagent fallback)

AGENT_MENU_MANAGER_EXECUTOR=hyperagent
  -> Hyperagent
     unset AGENT_MENU_MANAGER_EXECUTION_MODE -> inline
```

No schema change. `DEFAULT_AGENT_PROVIDER` stays `hyperagent` for binding-less Hyperagent readiness lookups; admission no longer uses that default.

## Error handling

Unchanged from PR 7: native + inline → 409; native + missing model → 503; native + unset spend → existing spend admission error. None of those open the Hyperagent path.

## Out of scope

Paid smoke. Azure. Linear. MCP (PRs 9/10). Write tools. Changing Hyperagent runtime behaviour. Settings UI redesign. Migration of in-flight runs.

## Success criteria

- [ ] Unset executor admits native queued_worker when flags, spend policy, and model are present.
- [ ] Unset executor without spend or model refuses new paid work and does not start Hyperagent.
- [ ] Explicit Hyperagent still admits through the existing binding path.
- [ ] In-flight Hyperagent and native runs keep their pinned executor after the process default changes.
- [ ] No migration. No paid calls. No Azure.

## Open questions

None that block this PR. Owner-gated paid evaluation can happen after merge; this slice proves the switch with fakes.