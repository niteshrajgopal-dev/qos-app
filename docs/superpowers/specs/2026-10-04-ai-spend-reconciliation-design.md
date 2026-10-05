# Spec: AI spend usage reconciliation (assessment PR 6 leftover)

Owner: QOS-28. Closes the assessment's PR 6: reported vs reserved vs possibly billed, operational metrics, reviewed retention. Admission (PR 3b) and the queued worker (PRs 4-6.1) already exist.

## Objective

Give an operator a host-confirmed CLI that can:

1. Roll up reserved / consumed / released / uncertain reservations against counter totals and any reported usage.
2. List uncertain reservations that still count toward quota.
3. Resolve one uncertain reservation as `billed` or `not_billed` with a reason, using the existing audited `resolveUncertainAiSpend`.

Wake the AI worker while uncertain spend exists (`count_due_ai_work` includes those rows). After the worker settles spend, emit a sanitized `ai_spend.usage_snapshot` for that tenant.

Success: an operator can see application-quota usage, find every uncertain row, and settle it without a UI, without deleting history, and without changing admission rules.

## Tech stack

Next.js 16 / TypeScript, Drizzle, Vitest (`fileParallelism=false`), Postgres (migrations 0041-0043 already present). Next free migration id on `origin/main` is **0044**.

## Commands

```
npm run typecheck
npm run lint
npx vitest run src/lib/ai/spend/spend-reconciliation.test.ts src/lib/ai/spend/spend-reconciliation.integration.test.ts src/lib/ai/jobs/ai-worker.test.ts src/db/ai-spend-reconciliation-migration.test.ts src/lib/ai/jobs/worker-logins.integration.test.ts
# Full suites stay the existing PG16/PG18 integration commands used by prior AI PRs.

npm run ai:spend -- usage --database-host <host> [--tenant <tenantId>] [--path ai_photo.async]
npm run ai:spend -- due-uncertain --database-host <host> [--tenant <tenantId>]
npm run ai:spend -- resolve --database-host <host> --tenant <tenantId> --reservation spr_... --resolution billed|not_billed --reason "..." --operator you@company
```

`DATABASE_URL` must be set. `--database-host` must match its hostname (`assertConfirmedDatabaseHost`). The script never reads `.env`.

## Project structure

```
src/lib/ai/spend/spend-reconciliation.ts
src/lib/ai/spend/spend-reconciliation.test.ts
src/lib/ai/spend/spend-reconciliation.integration.test.ts
src/db/ai-spend-reconciliation-migration.test.ts
scripts/ai-spend-operator-cli.ts
drizzle/0044_ai_spend_reconciliation.sql
docs/superpowers/specs/2026-10-04-ai-spend-reconciliation-design.md
```

Reuse, do not copy: `spend-admission.ts` (`resolveUncertainAiSpend`), `scripts/agent-operator-cli.ts`, worker log union in `ai-worker.ts`.

## Code style

Match spend-admission: tenant transaction, Zod for reported usage already stored, no secrets in logs or CLI output, `quotaKind: "application_quota"` on every rollup. Operator CLI follows `scripts/approve-agent-binding.ts` (host check, message-only errors, `process.exitCode = 1`).

```ts
export type AiSpendUsageBuckets = {
  reserved: number;
  consumed: number;
  released: number;
  uncertain: number;
};

export type AiSpendUsageSummary = {
  path: AiSpendPath;
  asOf: string;
  tenantId: string | null;
  quotaKind: "application_quota";
  reservations: AiSpendUsageBuckets;
  units: AiSpendUsageBuckets;
  reportedUsage: Record<string, number>;
  estimatedCostMicros: number | null;
  uncertain: number;
  counters: {
    platformDaily: number;
    platformMonthly: number;
    platformConcurrency: number;
    providerConcurrency: number;
    tenantDaily: number | null;
    tenantMonthly: number | null;
    tenantConcurrency: number | null;
  };
};
```

CLI prints `JSON.stringify(value, null, 2)` only. Resolve prints the updated reservation public id, state, resolution, and `quotaKind`. Never print `DATABASE_URL`, passwords, prompts, or raw provider payloads.

## Testing strategy

- Unit: bucket totals from fixture rows; empty reported usage; invalid `--resolution` / empty reason fail before a DB call; snapshot event has no prompt/secret keys.
- Integration (existing disposable PG, never `qosapp-db-1`): summarize after reserve/consume/uncertain; list due-uncertain oldest first; resolve `not_billed` returns quota and drops the row from due-uncertain; resolve `billed` keeps quota and leaves state `consumed`; `count_due_ai_work` is 0 with only consumed rows, at least 1 with one uncertain row and no jobs; scaler can execute the count and cannot `SELECT` reservations; worker login cannot execute the count; `qos_app` still has no DELETE on spend tables.
- Worker unit: after a finished step, `log` receives `ai_spend.usage_snapshot` when `summarizeSpend` is wired.
- No browser tests. No real OpenAI calls.

## Boundaries

- Always: tests before commit; host confirmation on the CLI; audit on resolve; application quota labelling; UTF-8 source files.
- Ask first: Azure deploy / migrate 0044 on `psql-qos-dev`; changing KEDA query; any DELETE/retention period; staff or public API; Linear status changes.
- Never: auto-resolve uncertain; release uncertain on a timer; delete reservation or counter history; present counters as an invoice ceiling; print secrets; stash or overwrite unrelated local dirty files; force-push; merge without owner PR.

## Architecture

```
operator CLI -> spend-reconciliation + resolveUncertainAiSpend -> ai_spend_* (RLS)
worker settle -> summarizeAiSpendUsage(tenant) -> ai_spend.usage_snapshot (log)
KEDA scaler  -> qos.count_due_ai_work() -> jobs due + uncertain reservations
```

No new tables. One additive migration.

### Migration 0044

1. `GRANT SELECT ON qos.ai_spend_reservations TO qos_ai_queue_owner`.
2. Policy `ai_spend_reservations_queue_owner` `FOR SELECT TO qos_ai_queue_owner USING (true)` (same pattern as `ai_jobs_queue_owner`; the owner cannot log in).
3. Replace `qos.count_due_ai_work()` so the returned bigint is due jobs plus `count(*)` of `qos.ai_spend_reservations` where `state = 'uncertain'`. Keep `SECURITY DEFINER`, owner `qos_ai_queue_owner`, `search_path = pg_catalog, pg_temp`, `REVOKE ALL FROM PUBLIC`, `GRANT EXECUTE` to `qos_ai_scaler` only.
4. Do not grant the scaler or worker any new table rights. Do not grant DELETE to anyone.

Consequence: while any uncertain reservation exists, KEDA keeps one worker replica. The worker still cannot resolve spend. That is intended.

### Library

- `summarizeAiSpendUsage(tx, { path, tenantId, now })` - reservation state/unit buckets for `path` (and tenant when set); sum integer fields in `reported_usage`; sum `estimated_cost_micros` (null if none); read matching platform/tenant counters for that path's daily/monthly/concurrency keys. Tenant-only fields are null on a platform-wide summary.
- `listDueUncertainAiSpend(tx, { tenantId, now })` - `state = 'uncertain'`, oldest `updated_at` first, cap 200. Fields: `reservationPublicId`, `tenantId`, `path`, `provider`, `subjectType`, `subjectPublicId`, `units`, `reportedUsage`, `updatedAt`, `ageMs`. No other columns.
- Resolve is `resolveUncertainAiSpend` unchanged. CLI supplies `resolvedBy: { subject: operator, actorClass: "operator" }`.

Platform-wide `usage` / `due-uncertain` require a login that can see every tenant (operator / `qosadmin`). With `--tenant`, run inside `withTenantContext`. A `qos_app` or worker login without tenant context must see zero reservation rows (FORCE RLS).

### CLI

`scripts/ai-spend-operator-cli.ts` + `package.json` script `ai:spend`. First positional is the command. `--path` defaults to `ai_photo.async` and must be an `AiSpendPath`. `--reason` is 1 to 500 characters (same as admission). Unknown flags fail.

### Worker metrics

Add to `AiWorkerLogEvent`:

```ts
| {
    event: "ai_spend.usage_snapshot";
    tenantId: string;
    path: string;
    reservations: AiSpendUsageBuckets;
    units: AiSpendUsageBuckets;
    uncertain: number;
    quotaKind: "application_quota";
  }
```

`AiWorkerDeps.summarizeSpend?: (tenantId: string) => Promise<that event | null>`. After `job_stepped` when `result.type` is `completed`, `failed`, or `operator_review`, call it and log. Skip on `reschedule`, `lease_lost`, and `step_crashed`. Runtime wires the function with tenant context; unit tests inject a fake. No prompts, tokens, or reservation public ids in the snapshot.

## Error handling

- Unset/invalid path, missing resolve args, host mismatch: CLI exit 1, stderr message only.
- `resolve` on a non-uncertain row: existing `AiSpendStateError` text, exit 1, no partial counter write.
- `count_due_ai_work` stays count-only. It never returns ids or payloads.

## Out of scope

Staff/admin API or UI. Retention/DELETE. Pricing tables or invoice import. Auto-resolution. Native executor (PR 7). Azure apply/deploy (separate approval). Changing live spend policy numbers. Menu Manager Hyperagent billing (no spend path there today).

## Success criteria

- [ ] `usage` JSON has the four state buckets, unit buckets, reported usage, optional estimate, counters, and `quotaKind: "application_quota"`.
- [ ] `due-uncertain` lists only `state = 'uncertain'`, oldest first.
- [ ] `resolve --resolution not_billed` returns quota, writes `ai_spend.resolved`, removes the row from due-uncertain, and drops `count_due_ai_work` by 1 when no jobs are due.
- [ ] `resolve --resolution billed` keeps quota, state `consumed`.
- [ ] Uncertain work is never released by expiry.
- [ ] Scaler can count and cannot read reservation rows; worker cannot execute the count.
- [ ] Worker logs `ai_spend.usage_snapshot` after a settled step; event has no secrets.
- [ ] No DELETE grants; no new staff routes; no Azure in this PR.

## Open questions

None. Retention stays "delete nothing" until a later owner decision.