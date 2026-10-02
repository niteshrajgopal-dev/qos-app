# QOS vendor-neutral AI foundation — assessment (amended)

**Status:** Assessment for owner review. The ADR it proposes ([ADR-AI-02](./ADR-AI-02-vendor-neutral-ai-foundation.md)) is **Proposed**, not accepted.
**Base commit assessed:** `1f900d2eae980f738ccf6f5f651b7397290b8ca6` (`main`, merge of PR #33 / QOS-141). Main had not moved when the owner review was applied.
**Inputs:** [owner brief](../QOS_Cursor_Vendor_Neutral_AI_Brief.md), [owner review and corrections](../QOS_Cursor_ADR_AI_02_Review_and_Next_Step.md), QOS-129/132/133/134/139/140/28/33, ADR-AI-01, ADR-SF-01, the Menu Manager fast-track handoff and the execution protocol.

## Amendment log

| # | Original assessment | Amended position | Where |
|---|---|---|---|
| 1 | "Idempotent submit: not applicable (synchronous)" for native OpenAI | Wrong. Synchronous model and image requests can have uncertain paid outcomes. Every adapter classifies failures per operation; no adapter claims submit idempotency it does not have. | ADR decisions 4–5; C.2 |
| 2 | A post-dispatch lease expiry becomes `outcome_unknown` and is never resubmitted | Known references are reconciled/polled, not resubmitted. `outcome_unknown` has an explicit recovery process. | ADR 6–7; C.5 |
| 3 | Native execution "finishes in one step" inside a durable job | A queue does not checkpoint the agent loop. Native v1 is read/analyse/propose only and records attempt evidence; chargeable tools need QOS operation identities first. | ADR 12–13 |
| 4 | "Native OpenAI executor", `agent_provider = 'openai'` | Executor kind, executor adapter, model provider and model ID are separate identities, with a compatibility mapping for the existing `agent_provider` column. | ADR 2; C.1 |
| 5 | Worker runs as `qos_app`; claim/count as SECURITY DEFINER | A privilege matrix with separate API, worker, scaler, migration, function-owner and credential roles. Deployed grants verified before activation. | ADR 15; C.6 |
| 6 | Budgets in PR 6 | Basic race-safe tenant + platform reservations and concurrency limits are required before any new paid path activates. PR 6 becomes usage reconciliation, not the first spend control. | ADR 16; D |
| 7 | "Turn the flag off and return to inline" rollback | Flags select new admissions only. Accepted work keeps its recorded execution mode and adapter. | ADR 17; C.7 |
| 8 | Snapshot hash stored is enough to pin the run | A hash cannot recreate input. Pin the bounded input (or a versioned private snapshot reference) with checksum and schema version, and recheck live permissions. | ADR 9–10 |
| 9 | Extract a shared polling loop from `video-worker.ts` | The production video worker is not modified in the AI rollout. The AI worker copies the pattern. | ADR 14; D |
| 10 | ESLint `no-restricted-imports` for SDKs | SDK imports **and** direct provider HTTP endpoints and provider credential env names are restricted, enforced by a repository-scanning test (`src/lib/architecture/ai-provider-boundaries.test.ts`). | C.3 |
| 11 | Hyperagent "not expanded until isolation demonstrated" | Explicit freeze of the shared workspace at its current approved scope. No public MCP deployment, DNS or OAuth client work. | ADR 18; C.8 |
| 12 | Migrations `0040`–`0042` named | No IDs reserved. The next free ID is checked on main at implementation time. | D |
| 13 | `@openai/agents 0.18.0` recommended | Agents SDK in principle only. Release, licence, Node compatibility, transitive dependencies and retry behaviour are verified at the native-executor PR, then pinned with the lockfile. | ADR consequences; D |
| 14 | One Linear issue per PR | Prefer updating existing owners; add children only where genuinely needed. | E |
| 15 | Proposed numeric targets (4 concurrent jobs, 20/day…) | Not owner-approved. The hidden `AI_PHOTO_DAILY_LIMIT_PER_TENANT = 20` default conflicts with D28 and is flagged, not adopted. | F |

## A. Current state (evidence at `1f900d2`)

Section A of the original assessment stands; the amended points are marked.

1. **Menu Manager → Hyperagent.** `POST .../agent-runs` → `askMenuManager` (`src/lib/agents/menu-manager/menu-manager-service.ts`). Checks: env flags, an operator-approved binding, a Hyperagent connection check, then menu/location access in `loadMenuSnapshotForAgent`. `createAgentRun` inserts a queued row (tenant-scoped idempotency), then `provider.startRun` runs **inline in the request** (MCP `create_thread`, 20 s timeout). Progress advances only when the browser polls `GET .../agent-runs/[runPublicId]` (`pollAgentRunOnce` with a DB lease). Replies pass `interpretMenuManagerReply` (strict Zod, menu ID match, unknown product IDs rejected).
2. **Images → OpenAI.** `generateMenuAiPhoto` runs synchronously in the request. One transaction checks admin role and location access, takes a per-tenant advisory lock, enforces per-product single flight and a rolling 24 h count, then creates the upload grant and audit event. The provider call happens outside the transaction via raw `fetch` with no retries; the result is re-encoded and ingested into private quarantine; acceptance requires confirmation and a fresh context hash.
3. **Abstractions.** `AgentRuntimeProvider` (Hyperagent only), `AiPhotoProvider` (OpenAI + mock), `agent_runs` lifecycle with trigger guard, provider registries with test overrides, `FakeAgentProvider`. Missing at assessment time: a model boundary, versioned definitions, a tool gateway, declared capabilities, classified failures, import/endpoint boundaries.
4. **AuthZ.** Verified session → active membership in the route's tenant → location access. RLS with FORCE on agent tables; credential rows visible only inside `withAgentCredentialAccess`. **Gaps:** tenant suspension is not enforced anywhere (platform-wide); Menu Manager has no role restriction.
5. **Durability.** Menu Manager state survives restarts but nothing advances without a polling browser. Image generation is not durable; a killed replica leaves a `pending_upload` asset until a later request abandons it.
6. **Uncertain outcomes (amended).** Both paths can produce uncertain paid outcomes, not only Hyperagent:
   - Hyperagent `create_thread` timeout or an unparsable response marks the run `failed`, though the thread may exist; a user retry creates a second paid thread. A crash between `create_thread` and `markAgentRunStarted` leaves an orphaned remote thread.
   - An OpenAI image timeout, connection reset after send, or HTTP 5xx may still be billed. Today's quota counts timeouts as billed and does not retry, which is honest; but `provider_unreachable` is treated as **unbilled** (`UNBILLED_FAILURE_CODES`), although a reset after the request body was sent is not proof of non-dispatch. This tranche classifies it honestly in the error contract without changing quota behaviour; the quota discrepancy is an owner/next-PR item.
   - Polling errors are treated as "still running" until the deadline.
   - Credential key rotation is unsupported: a fingerprint mismatch throws an unmapped error (HTTP 500, run left queued).
7. **Storage.** OpenAI key in `OPENAI_API_KEY` (how Azure sets it is unverified). Hyperagent OAuth tokens AES-256-GCM in `agent_provider_credentials`, single key. Menu Manager prompt **not stored** (hash and IDs only). Results in `agent_runs.result`. Image prompt/model/usage in private `generation_metadata`. Audit in append-only `tenant_audit_events`. No retention limits or cleanup. All tenants' snapshots go to one shared Hyperagent workspace whose cross-thread memory is unverified.
8. **Spend/concurrency.** Images: per-tenant rolling count under a lock, per-product single flight, model allowlist, off by default. Menu Manager: one active run per menu only. No platform cap, provider concurrency limit or token limits. The 20/day default conflicts with D28.
9. **Hyperagent disabled.** Menu Manager stops (new and in-flight). Bug: `refreshMenuManagerRun` returns before the deadline is applied, so in-flight runs show "running" forever. Everything else, including AI photos, keeps working.

**Implemented vs tested vs deployed.** Implemented and CI-tested: the above. Deployed evidence: QOS-140 QA was blocked on dev before PR #31; there is no recorded real-provider generate → accept after it. QOS-139 has no recorded real Hyperagent end-to-end evidence; the owner's reported success is user-reported evidence.

**Not verified:** deployed Container App settings, database roles used by the API, which migrations are applied. `infra/container-app.bicep` references `postgres-admin-user`; that is a reason to inspect, not proof of admin use.

## B. ADR-AI-02

See [ADR-AI-02](./ADR-AI-02-vendor-neutral-ai-foundation.md) (Proposed). It lists the ADR-AI-01 sections it supersedes and those it retains.

## C. Recommended architecture (amended)

```text
Staff UI ──► authenticated route ──► application service
                                      │ authorize + reserve budget + create run/asset + enqueue (one tx)
                                      ▼
                         Postgres AI queue ◄── external wake-up (count-only scaler identity)
                                      ▼
                         AI worker (own restricted DB login)
                          ├─ rebuild trusted ExecutionContext; recheck live permissions
                          ├─ Agent executor ── native (Agents SDK adapter + injected QOS model boundary) | Hyperagent (optional, frozen scope) | fake
                          │      └─ tool calls ──► in-process ToolGateway ──► existing services
                          └─ Image provider ── OpenAI | mock ──► existing quarantine/ingest pipeline
Later:  one approved MCP client ──► thin read-only MCP adapter ──► same ToolGateway
```

### C.1 Contracts and identity (implemented in this tranche)

- **Shared failure classification** — `src/lib/ai/provider-outcome.ts`: `ProviderOutcome` (`not_dispatched | rejected | submission_unknown | failed_after_processing | read_failed`), `classifyProviderFailure` (enforces that `submission_unknown` and `failed_after_processing` are never retryable) and `permitsAutomaticResubmission`.
- **Execution identity** — `src/lib/ai/execution-identity.ts` defines `ExecutorKind`, `ExecutorAdapter`, `ModelProvider` and `AgentExecutionIdentity`. `src/lib/agents/execution-identity.ts` maps the persisted `agent_provider` value to identity: `hyperagent → { external, hyperagent, adapterVersion: "hyperagent-mcp.v1", modelProvider: null, modelId: null }`. Hyperagent's model is unknown and recorded as such. `agents_sdk` is deliberately not added until the native executor exists.
- **Agent executor** — `AgentRuntimeProvider` gains `identity` and `capabilities` (`structuredOutput`, `toolCalls`, `cancellation`, `continuation`, `usageReporting`, `submitIdempotency`). Hyperagent declares prompted JSON, no tools, no cancellation, no continuation, no usage, no submit idempotency. `AgentProviderError` gains a classification (`outcome`, `retryable`, `retryAfterMs`).
- **Image provider** — `AiPhotoProvider` gains `capabilities` (`submitIdempotency`, `usageReporting`, `network`). `AiPhotoProviderError` gains a classification derived from the code, overridable where the adapter has better evidence (for example `ECONNREFUSED` proves non-dispatch). The OpenAI adapter moves to its own file (`openai-photo-provider.ts`), so the boundary module (`provider.ts`) holds only the contract, mock and registry. Quota codes and behaviour are unchanged.
- **Readiness placement** — the Hyperagent connection check is no longer hard-coded in the Menu Manager service or settings view. It sits behind `getAgentExecutorReadiness(db, provider)` / `reportAgentExecutorReauthRequired(db, provider, code)` in `src/lib/agents/executor-readiness.ts` (which imports no adapter code), selected by the binding's or run's provider, with `DEFAULT_AGENT_PROVIDER = "hyperagent"` when no binding exists. Behaviour and selection are unchanged.
- **Hyperagent transport phase** — a failure while connecting, before the tool request is sent, is `not_dispatched`; after that, `create_thread` failures are `submission_unknown` and reads are `read_failed`.
- **Not built yet:** the executor `step()` method. Its shape is fixed here so PR 4 implements it without redesign:

```ts
type ExecutorStepResult =
  | { kind: "completed"; output: unknown; usage: UsageReport | null }
  | { kind: "pending"; reference: string; nextCheckAt: Date }            // known accepted operation → poll, never resubmit
  | { kind: "awaiting_approval"; reference: string }
  | { kind: "outcome_unknown"; evidence: AttemptEvidence }              // blocks automatic resubmission
  | { kind: "failed"; outcome: ProviderOutcome; code: string; billedPossible: boolean }
  | { kind: "cancelled"; how: "provider_confirmed" | "local_stop_only" };
```

### C.2 Retry ownership

- One retry owner per provider operation: the AI worker (later). Today the OpenAI image adapter has no retries, and a contract test asserts exactly one dispatch per `generate`. The MCP SDK's internal reconnection behaviour is unverified; it must be verified (and disabled if needed) before Hyperagent submissions are retried by the worker.
- Only `not_dispatched`, retryable `rejected` (e.g. 429 with `Retry-After`) and `read_failed` may be retried automatically, bounded and jittered. `Retry-After` / `retry-after-ms` are captured as `retryAfterMs`.

### C.3 Architecture boundaries (implemented in this tranche)

`src/lib/architecture/ai-provider-boundaries.test.ts` scans `src/` and `scripts/` and fails when:

- a provider SDK (`openai`, `@openai/*`, `@anthropic-ai/*`, `@google/genai`, `@google/generative-ai`, `@ai-sdk/*`, `ai`, `@modelcontextprotocol/sdk*`) is imported outside its designated adapter;
- a provider endpoint host (`api.openai.com`, `hyperagent.com`, `api.anthropic.com`, `generativelanguage.googleapis.com`) appears in non-test code outside its adapter;
- `OPENAI_API_KEY` is read outside the AI photo config module;
- an adapter module (`src/lib/agents/hyperagent/**`, `openai-photo-provider.ts`) is imported from anywhere except its registry, its own directory, operator scripts and tests;
- routes and UI (`src/app/**`) import the agent provider registry or any adapter.

The scanner has its own tests on synthetic violations, so the check cannot pass vacuously.

### C.4 Tool gateway, pinning and live authorization (PR 3)

As in the original assessment, plus: each tool declares whether it reads the accepted snapshot or current authoritative data, and current reads return version/freshness evidence. `ExecutionContext` is rebuilt from the persisted run on every attempt and rechecks live tenant status, membership, location access, entitlement and emergency restrictions. Effective authority is the intersection of the accepted scope and current permissions. Initial tools are read-only (`menu.get_health`, `menu.get_items`). `media.create_image_candidate` is not built until agent-initiated spend is approved and QOS operation identities exist.

### C.5 Run states and `outcome_unknown` recovery (PR 4 design)

- Run states: `queued → running → completed | failed | cancelled | outcome_unknown` (legacy `awaiting_approval` kept). Terminal states remain final under the trigger.
- An append-only attempt record per dispatch: attempt number, executor identity, dispatched-at, provider reference (if any), reported usage, classified outcome, lease generation.
- Resolution of `outcome_unknown`, by an authorized administrator or a reconciliation job, is an explicit audited transition with evidence:
  - a reference later becomes known → poll it (never resubmit);
  - confirmed completed → `completed` with the validated result;
  - confirmed failed → `failed` (usage stays counted as possibly billed);
  - acknowledge and abandon → `failed` with `resolution = abandoned_after_unknown`, then an optional new run that needs explicit acknowledgement and a **new** budget reservation.
- A new browser idempotency key does not bypass the block: admission checks for an unresolved `outcome_unknown` attempt on the same logical subject.

### C.6 Privilege matrix (design; verified against deployed roles before worker activation)

| Identity | Needs | Must not have |
|---|---|---|
| API runtime (`qos_app` today) | Tenant-scoped CRUD under FORCE RLS; admission function (authorize + reserve + create + enqueue) for its tenant only | Global claim, cross-tenant job payloads, credential read outside opt-in scope, BYPASSRLS, ownership |
| AI worker (new restricted login) | Execute claim/heartbeat/complete functions; tenant-scoped reads/writes under tenant context per job; credential read only for adapters it runs | DDL, BYPASSRLS, superuser, video-job functions |
| Scaler / wake-up (count-only) | Execute one function returning aggregate counts of due work (queued, due polls, expired leases, reconciliation) | Any table access, payloads, credentials |
| Migration / admin | DDL, function ownership changes | Use by any runtime |
| Privileged function owner (dedicated NOLOGIN role) | Exactly the tables each function touches | Login; functions get a fixed `search_path`, schema-qualified references, `REVOKE ALL … FROM PUBLIC`, narrow `GRANT EXECUTE` |
| Credential reader/writer | Today: any `qos_app` session that sets the opt-in flag. That flag is not a boundary against code that can set it; the real boundary is which code paths call `withAgentCredentialAccess`. A key-rotation design (key IDs, active + previous decrypt keys, bounded re-encryption, mapped errors) is required. | Provider credentials in logs, prompts or model-visible context |

### C.7 Flags, rollout and rollback

Every accepted run/job records execution mode and adapter configuration. Flags affect admission only. The rollout/rollback runbook covers: admission freeze → supported-version check → drain or explicit cancellation → `outcome_unknown` reconciliation → read-compatible application rollback. Backfills only touch rows with proven provider references, and are idempotent. The "running forever when disabled" bug is fixed independently of provider availability (PR 2).

### C.8 Privacy, Hyperagent, MCP

Tracing export off by default; sanitized structured events only; `store: false` where supported, documented separately from retention. Hyperagent shared-workspace use frozen at current scope. QOS MCP: later, read-only, one approved client, no public deployment/DNS/OAuth client now.

## D. Incremental PR plan (amended sequence)

| PR | Scope | Migration | Gate |
|---|---|---|---|
| 0 | This assessment, ADR-AI-02 (Proposed), the brief and the review | None | Owner review |
| 1 | Provider/executor boundaries, identity separation, classified failures, readiness placement, contract tests, boundary checks. No behaviour change. | None | Owner review (this tranche) |
| 2 | Versioned Menu Manager definition; pinned run configuration and bounded input (snapshot or private reference + checksum + schema version); fix "running forever when disabled" | Next free ID, additive | — |
| 3 | Tool gateway, `ExecutionContext`, read tools, central reusable tenant-active check consumed by AI (separate platform issue for wider suspension) | None expected | — |
| 3b | Minimum spend admission: race-safe tenant + platform reservations, per-run bounds, global/provider/tenant concurrency limits; unset policy keeps new paid paths disabled; existing explicit settings preserved | Next free ID | D28 policy values from owner |
| — | Privilege matrix verified against deployed roles; recovery design reviewed | — | Separately authorized Azure read |
| 4 | Durable AI queue and dedicated AI worker (pattern copied, video worker untouched); executor `step()`; attempt records; `outcome_unknown` recovery; Menu Manager admission through the queue for new runs only | Next free ID | 3b in place; worker login provisioned |
| 5 | Asynchronous image processing and server-side batches with the same dedup/reservation rules; compatible or versioned API response | Possibly none | 3b in place |
| 6 | Usage reconciliation (reported vs estimated vs possibly billed), operational metrics, reviewed retention/cleanup | As needed | Retention decisions |
| 7 | Native executor: verify SDK release/licence/Node/transitive deps/retry behaviour, pin, commit lockfile; injected QOS model boundary; fake-model isolation tests; read-only Menu Manager v1 | Identity columns if needed | SDK verification; paid evaluation approval |
| 8 | Default switch after accepted evaluation and redacted real-provider smoke evidence; in-flight runs drain on their pinned executor; Hyperagent optional, no automatic fallback | None expected | Owner acceptance |
| 9/10 | Thin read-only MCP adapter, then one approved client | — | Principal/delegation and exposure decisions |

Each PR is forward-only and read-compatible with the previous application version.

## E. Linear reconciliation (proposal only; nothing changed)

As originally proposed, amended to prefer updating existing issues: QOS-129 points to ADR-AI-02 once accepted; QOS-132 re-scoped to PRs 1–5 (evidence comment for what QOS-139 already delivered; drop `AgentApproval`, `AgentAuditEvent` and "reversible migration"); QOS-133 re-scoped as the later thin read-only adapter; QOS-134 evidence comment and re-scope to "conform to executor contract plus uncertain-submit handling"; QOS-139/140 stay Done with a request for real end-to-end evidence; QOS-33 evidence comment, remains open; QOS-28 stays "Needs decision" and owns PR 3b and PR 6, with the 20/day conflict flagged; QOS-135–138 note native default, QOS-138 deferred. Only genuinely necessary children are added (likely one for the platform-wide tenant-suspension gap).

## F. Owner decisions (unresolved; none block PR 0/1)

1. Paid monthly, daily and per-run limits; whether unset means disabled (D28) and what happens to the existing 20/day default.
2. Whether `provider_unreachable` should stay unbilled for quota purposes when it may follow dispatch.
3. Activation of agent-initiated image generation.
4. Exact model and SDK release at their implementation gate; paid evaluation and smoke runs.
5. Retention periods and provider data policy; offboarding.
6. Worker deployment, scale-to-zero vs always-on, and provisional targets (to be load tested).
7. Tenant entitlement for native Menu Manager and which roles may start paid runs.
8. Hyperagent retirement timing after the rollback window.
9. External MCP principal/delegation model, first client and hostname.
10. Any destruction of historical Hyperagent or QOS data.

## Minimum acceptance tests (carried into PRs 2–8)

1. Menu Manager definition works with an injected fake model provider without catalogue changes or a runtime replacement.
2. With Hyperagent credentials and configuration absent, native Menu Manager plus reviewed image generation work with provider fakes. Real-provider smoke is separate and authorized.
3. Accepted jobs progress without browser polling and recover conservatively after restart.
4. A known provider operation is polled, not resubmitted, after a recoverable worker failure.
5. Unknown paid submission blocks automatic resubmission even with a different browser request key.
6. Lost leases prevent stale authoritative writes; external calls already in flight are treated honestly.
7. Cross-tenant/location access, revoked membership, suspended tenants, guessed IDs and stale image context are denied.
8. API and scaler identities cannot exercise worker-only claim or credential privileges.
9. Two tenants racing for the final platform allowance cannot both reserve it.
10. An in-flight run is not moved to another provider or inline path during flag changes or rollback.
11. Prompt injection cannot alter allowed tools, tenant scope, budgets or protected-write rules.
12. Normal menu editing/publishing continues with AI disabled.
13. No secrets, raw prompts or tool payloads reach disallowed logs/traces.
14. Load tests report queue delay, fairness, DB pool use, provider concurrency and total observed latency, including cold start where relevant.

PR 1 covers the contract and boundary portions that precede these: classified failures and no hidden retries (prerequisites for 4–6), and the provider-isolation boundary (prerequisite for 1–2).
