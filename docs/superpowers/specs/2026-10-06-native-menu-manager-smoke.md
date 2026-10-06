# Spec: authorized native Menu Manager smoke

Owner-gated item 1 after PRs 0–10: record redacted real-provider evidence for native Menu Manager. This is not CI, not a fake-adapter proof, and not an invoice.

## Objective

Give an operator a host-confirmed CLI that can run **one** paid native Menu Manager review against a named tenant menu and print **allowlisted** evidence: run status, spend settlement, latency, reported token usage, and the tools the definition allows. Prompts, snapshots, tool payloads, keys, and operator emails never appear.

Success: `npm test` still never calls OpenAI; `npm run agents:native-smoke` refuses unless `AGENT_NATIVE_SMOKE` and `--confirm` are set; CI does not invoke the script.

## Tech stack

Existing native admission (`askMenuManager` → `menu_manager.native` reservation → `menu_manager.run` job) and `createMenuManagerJobHandler` with `createAgentsSdkModel`. No new tables. No CI job.

## Commands

```
npm run typecheck
npm run lint
npx vitest run src/lib/agents/native/native-smoke.test.ts src/lib/architecture/ai-provider-boundaries.test.ts src/lib/agents/menu-manager/menu-manager-native.integration.test.ts

npm run agents:native-smoke -- --confirm --tenant <tenantId> --menu <menuPublicId> --operator <staff-subject> --database-host <host>
```

`DATABASE_URL` must be set. The script never loads `.env`. `--database-host` must match (`assertConfirmedDatabaseHost`). The process must be able to `SET ROLE qos_ai_worker` for the one in-process claim (local `qos` after that grant, or the worker login). Spend policy `AI_SPEND_MENU_MANAGER_NATIVE_*` plus platform/provider concurrency must already be admissible. Mock provider is refused.

## Project structure

```
src/lib/agents/native/native-smoke.ts
src/lib/agents/native/native-smoke.test.ts
scripts/native-menu-manager-smoke.ts
```

## Public API

```ts
nativeSmokeReadiness(source: EnvSource): { ready: true; modelId: string; provider: "openai" } | { ready: false; missing: string[] }
parseNativeSmokeArgs(argv: string[]): { confirm: boolean; tenantId: string; menuPublicId: string; operator: string; databaseHost: string }
redactNativeSmokeEvidence(raw: Record<string, unknown>): NativeSmokeEvidence
```

Missing-key reasons never include the `OPENAI_API_KEY` token. Evidence allowlist: `event`, `authorized`, `ci`, `provider`, `modelId`, `executor`, `executionMode`, `definitionVersion`, `runStatus`, `jobResult`, `spendState`, `spendOutcome`, `reportedUsage`, `latencyMs`, `productCount`, `snapshotTruncated`, `toolsAllowed`. `event` is `native_menu_manager.smoke`. `ci` is always `false`.

## Native spend usage

When the native worker step completes, `recordAiSpendOutcome` receives the model's reported usage (integer token fields). Evidence reads that reservation; it does not reprint the model reply.

## Error handling

Unset smoke flag, missing `--confirm`, mock provider, unset spend policy, unconfigured OpenAI, or host mismatch: throw and exit 1 without contacting the provider. CI workflow text must not contain `agents:native-smoke` or `AGENT_NATIVE_SMOKE`.

## Out of scope

AI photo paid smoke; writing a filled evidence markdown with invented numbers; public MCP; Azure apply; Linear; changing Menu Manager defaults.
