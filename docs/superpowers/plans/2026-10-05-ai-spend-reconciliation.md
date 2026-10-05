# AI Spend Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give an operator a host-confirmed CLI to roll up AI spend, list uncertain reservations, and resolve them, and wake the worker while uncertain spend exists.

**Architecture:** No new tables. A library reads existing `ai_spend_*` rows. CLI wraps the library plus `resolveUncertainAiSpend`. Migration 0044 lets `qos.count_due_ai_work()` also count `state = 'uncertain'`. The worker logs a tenant-scoped `ai_spend.usage_snapshot` after a settled step.

**Tech Stack:** TypeScript, Drizzle, Vitest, Postgres, existing operator CLI helpers.

**Spec:** `docs/superpowers/specs/2026-10-04-ai-spend-reconciliation-design.md`

## Global Constraints

- Work in an isolated git worktree from `origin/main` at `C:\Dev\qosapp-ai-spend-reconciliation` on branch `feature/ai-spend-reconciliation`. Do not touch the dirty files in `C:\Dev\qosapp`.
- Copy the spec into the worktree if it is not on `origin/main`.
- New files must be UTF-8 (the Write tool may emit UTF-16; convert).
- Never `qosapp-db-1`. Integration tests use the existing disposable PG helper.
- Never print secrets. Every rollup includes `quotaKind: "application_quota"`.
- Do not auto-resolve, delete history, add UI/API, or deploy Azure.
- Do not commit unless the owner asks. Do not stash the original tree.
- TDD: failing test first. `fileParallelism=false` is already configured.

## File map

| File | Responsibility |
|---|---|
| `src/lib/ai/spend/spend-reconciliation.ts` | summarize, list due-uncertain, snapshot event, CLI arg parse |
| `src/lib/ai/spend/spend-reconciliation.test.ts` | unit tests (no DB) |
| `src/lib/ai/spend/spend-reconciliation.integration.test.ts` | DB behavior |
| `src/db/ai-spend-reconciliation-migration.test.ts` | 0044 privileges + count |
| `drizzle/0044_ai_spend_reconciliation.sql` | grant, owner RLS policy, replace count |
| `drizzle/meta/_journal.json` | idx 44, when 1791700000000 |
| `src/lib/ai/jobs/ai-worker.ts` | optional `summarizeSpend`, snapshot after settled steps |
| `src/lib/ai/jobs/ai-worker.test.ts` | snapshot / skip cases |
| `scripts/ai-worker.ts` | wire `summarizeSpend` for `ai_photo.async` |
| `scripts/ai-spend-operator-cli.ts` | usage / due-uncertain / resolve |
| `package.json` | `ai:spend` |
| `.env.example` | operator CLI docs |

No Dockerfile or KEDA query-string change. `AI_WORKER_SCALE_QUERY` stays `SELECT qos.count_due_ai_work()`.

---

### Task 1: Isolated worktree and spec

**Files:**
- Create worktree `C:\Dev\qosapp-ai-spend-reconciliation` from `origin/main`
- Copy spec + this plan into the worktree if missing

**Interfaces:**
- Consumes: approved spec
- Produces: clean tree on `feature/ai-spend-reconciliation`

- [ ] **Step 1: Fetch and create the worktree**

```powershell
git -C C:\Dev\qosapp fetch origin main
git -C C:\Dev\qosapp worktree add C:\Dev\qosapp-ai-spend-reconciliation -b feature/ai-spend-reconciliation origin/main
```

Copy spec and plan into the worktree `docs/superpowers/` tree if they are not on `origin/main`. Expected: dirty files in `C:\Dev\qosapp` unchanged.

- [ ] **Step 2: Install and confirm HEAD**

```powershell
cd C:\Dev\qosapp-ai-spend-reconciliation
npm install
git log -1 --oneline
git status --short
```

Expected: HEAD is `origin/main`. All later tasks run in this worktree.

---

### Task 2: Unit library (no DB)

**Files:**
- Create: `src/lib/ai/spend/spend-reconciliation.ts`
- Create: `src/lib/ai/spend/spend-reconciliation.test.ts`

**Interfaces:**
- Consumes: `AiSpendPath` / `isAiSpendPath` from `spend-policy.ts`; `DbTransaction` from `@/lib/tenant/context`
- Produces:

```ts
export const AI_SPEND_QUOTA_KIND = "application_quota" as const;
export type AiSpendUsageBuckets = { reserved: number; consumed: number; released: number; uncertain: number };
export type AiSpendUsageSummary = {
  path: AiSpendPath; asOf: string; tenantId: string | null; quotaKind: typeof AI_SPEND_QUOTA_KIND;
  reservations: AiSpendUsageBuckets; units: AiSpendUsageBuckets;
  reportedUsage: Record<string, number>; estimatedCostMicros: number | null; uncertain: number;
  counters: { platformDaily: number; platformMonthly: number; platformConcurrency: number; providerConcurrency: number;
    tenantDaily: number | null; tenantMonthly: number | null; tenantConcurrency: number | null };
};
export type AiSpendDueUncertain = {
  reservationPublicId: string; tenantId: string; path: string; provider: string;
  subjectType: string; subjectPublicId: string; units: number;
  reportedUsage: Record<string, number> | null; updatedAt: Date; ageMs: number;
};
export type AiSpendUsageSnapshotEvent = {
  event: "ai_spend.usage_snapshot"; tenantId: string; path: string;
  reservations: AiSpendUsageBuckets; units: AiSpendUsageBuckets; uncertain: number;
  quotaKind: typeof AI_SPEND_QUOTA_KIND;
};
export type AiSpendOperatorCommand =
  | { command: "usage"; databaseHost: string; tenantId?: string; path: AiSpendPath }
  | { command: "due-uncertain"; databaseHost: string; tenantId?: string }
  | { command: "resolve"; databaseHost: string; tenantId: string; reservationPublicId: string;
      resolution: "billed" | "not_billed"; reason: string; operator: string };

export function emptyAiSpendUsageBuckets(): AiSpendUsageBuckets
export function addAiSpendReservationToBuckets(buckets: { reservations: AiSpendUsageBuckets; units: AiSpendUsageBuckets }, state: keyof AiSpendUsageBuckets, units: number): void
export function mergeReportedUsage(into: Record<string, number>, usage: unknown): void
export function usageSnapshotEvent(summary: AiSpendUsageSummary): AiSpendUsageSnapshotEvent
export function parseAiSpendOperatorArgs(argv: string[]): AiSpendOperatorCommand
export async function summarizeAiSpendUsage(tx: DbTransaction, input: { path: AiSpendPath; tenantId?: string; now?: Date; provider?: "openai" }): Promise<AiSpendUsageSummary>
export async function listDueUncertainAiSpend(tx: DbTransaction, input?: { tenantId?: string; now?: Date; limit?: number }): Promise<AiSpendDueUncertain[]>
```

- [ ] **Step 1: Write failing unit tests** for empty buckets; add reserved 2 + consumed 1 + uncertain 3; `mergeReportedUsage` sums `total_tokens` and ignores bad keys; `usageSnapshotEvent` requires tenantId and JSON has no prompt/secret/password keys; parse defaults path to `ai_photo.async`; unknown path / bad resolution / blank reason / unknown flag throw.

- [ ] **Step 2: Run** `npx vitest run src/lib/ai/spend/spend-reconciliation.test.ts` — expected FAIL.

- [ ] **Step 3: Implement** the unit surface. `addAiSpendReservationToBuckets` increments reservation count by 1 and units by `units`. `mergeReportedUsage` only accepts own keys `/^[a-z][a-z0-9_]{0,63}$/` with nonnegative integers, max 32 keys. `parseAiSpendOperatorArgs` uses `parseArgs({ allowPositionals: true, strict: true })`. `--path` defaults to `ai_photo.async`. Resolve requires tenant, reservation, billed|not_billed, reason 1-500, operator. Leave summarize/list throwing until Task 3.

- [ ] **Step 4: Re-run unit tests** — PASS.

---

### Task 3: Summarize and list (integration)

**Files:**
- Modify: `src/lib/ai/spend/spend-reconciliation.ts`
- Create: `src/lib/ai/spend/spend-reconciliation.integration.test.ts`

**Interfaces:**
- Consumes: Task 2 helpers; spend tables; `reserveAiSpend`, `markAiSpendDispatched`, `recordAiSpendOutcome`, `resolveUncertainAiSpend`
- Produces: working summarize/list

Counter keys must match admission: `platform:concurrency`, `provider:openai:concurrency` on `1970-01-01`; `path:${path}:daily|monthly`; tenant `path:${path}:concurrency|daily|monthly`.

- [ ] **Step 1: Write failing integration tests** using the same `resetAndMigrate` / quotes+flowers / `policy()` pattern as `spend-admission.integration.test.ts`.
  1. Tenant summarize after consume + uncertain + released-unstarted: buckets, `reportedUsage.total_tokens`, tenant daily counts consumed+uncertain, `quotaKind`.
  2. Platform summarize (no tenantId, admin login) includes both tenants.
  3. `listDueUncertainAiSpend` only uncertain, oldest first, spec fields, cap 200.
  4. `not_billed` drops due-uncertain and returns quota; `billed` keeps quota and `consumed`.
  5. Timer does not release uncertain.

- [ ] **Step 2: Run integration file** — FAIL on stubs if integration DB is set.

- [ ] **Step 3: Implement** drizzle select/fold. Tenant counters null on platform summarize. `ageMs = now - updatedAt`. Do not bypass RLS.

- [ ] **Step 4: Re-run** — PASS when integration DB is available.

---

### Task 4: Migration 0044

**Files:**
- Create: `drizzle/0044_ai_spend_reconciliation.sql`
- Modify: `drizzle/meta/_journal.json` (idx 44, when `1791700000000`, tag `0044_ai_spend_reconciliation`)
- Create: `src/db/ai-spend-reconciliation-migration.test.ts`

**Interfaces:**
- Consumes: 0042 `count_due_ai_work`
- Produces: count = due jobs + uncertain reservations

- [ ] **Step 1: Write failing tests:** owner SELECT policy; queue owner SELECT only; scaler no table grant; worker keeps 0043 SELECT/UPDATE; function owner/search_path/EXECUTE scaler-only; qos_app no DELETE; scaler count is 1 with one uncertain and no jobs, 0 after not_billed; scaler cannot SELECT reservations; worker cannot execute count.

- [ ] **Step 2: Run** — FAIL missing 0044.

- [ ] **Step 3: Write SQL:** GRANT SELECT to `qos_ai_queue_owner`; policy `ai_spend_reservations_queue_owner` FOR SELECT USING (true); replace `count_due_ai_work` as due jobs plus `count(*)` where `state = 'uncertain'`; re-apply owner (GRANT CREATE / ALTER OWNER / REVOKE CREATE), REVOKE PUBLIC, GRANT EXECUTE to scaler. No snapshot json (0036-0043 had none).

- [ ] **Step 4: Re-run 0044 tests plus `ai-job-queue-migration.test.ts` and `worker-logins.integration.test.ts`.**

---

### Task 5: Worker snapshot

**Files:**
- Modify: `src/lib/ai/jobs/ai-worker.ts`
- Modify: `src/lib/ai/jobs/ai-worker.test.ts`
- Modify: `scripts/ai-worker.ts`

**Interfaces:**
- Consumes: `usageSnapshotEvent`, `summarizeAiSpendUsage`
- Produces: log after settled steps

- [ ] **Step 1: Failing tests:** completed logs snapshot; reschedule / crash / lease_lost do not call `summarizeSpend`; failed and operator_review do; if `summarizeSpend` throws, still `job_stepped` and not `step_crashed`.

- [ ] **Step 2: Run `npx vitest run src/lib/ai/jobs/ai-worker.test.ts`** — FAIL.

- [ ] **Step 3: Add snapshot to `AiWorkerLogEvent`. `summarizeSpend?: (tenantId: string) => Promise<snapshot | null>`. After finish + `job_stepped`, if type is completed|failed|operator_review, try/catch summarize and log. Wire `scripts/ai-worker.ts` with `withTenantContext` + `summarizeAiSpendUsage({ path: "ai_photo.async", tenantId })` + `usageSnapshotEvent`.

- [ ] **Step 4: Re-run worker tests** — PASS.

---

### Task 6: Operator CLI

**Files:**
- Create: `scripts/ai-spend-operator-cli.ts`
- Modify: `package.json` (`"ai:spend": "tsx scripts/ai-spend-operator-cli.ts"`)
- Modify: `.env.example` (comment-only)

**Interfaces:**
- Consumes: parse/summarize/list/resolve, `assertConfirmedDatabaseHost`, `createDbClient`, `withTenantContext`

- [ ] **Step 1: Unit test** that `package.json` has `ai:spend`, the script imports `assertConfirmedDatabaseHost`, and it does not contain `.env`.

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Implement CLI** like `approve-agent-binding.ts`. Host check. usage/due-uncertain use tenant context when `--tenant` is set, otherwise `db.transaction` for operator/admin. resolve always tenant-scoped with `actorClass: "operator"`. JSON only. Errors set `process.exitCode = 1`. Document commands in `.env.example`. Totals are application quotas, not an invoice. Nothing is deleted.

- [ ] **Step 4: Re-run unit tests** — PASS.

---

### Task 7: Verification

- [ ] **Step 1:** `npm run typecheck` and `npm run lint` — clean.
- [ ] **Step 2:** focused vitest listed in the spec, plus `ai-job-queue-migration` and `spend-admission.integration`.
- [ ] **Step 3:** Report files, tests, and that Azure was not touched. After the owner asks to commit/push, give title/description plus `/pull/new/feature/ai-spend-reconciliation`.

## Risks

| Risk | Mitigation |
|---|---|
| CREATE OR REPLACE changes function owner | Re-apply owner + grants like 0042 |
| FORCE RLS hides platform summarize for qos_app | Operator/admin for cross-tenant; `--tenant` uses context |
| Snapshot throws and fails jobs | try/catch around summarizeSpend |
| Uncertain pins a replica at 1 | Specified and accepted |

## Self-review

- Spec CLI, library, 0044, snapshot, no-delete, scaler isolation, worker event: Tasks 2-6.
- No TBD placeholder steps.
- Names match: `summarizeAiSpendUsage`, `listDueUncertainAiSpend`, `usageSnapshotEvent`, `parseAiSpendOperatorArgs`, `ai_spend.usage_snapshot`.
