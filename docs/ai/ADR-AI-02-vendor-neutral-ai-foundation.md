# ADR-AI-02 — QOS Vendor-Neutral AI Foundation

**Status:** Proposed. Not accepted until the owner approves this ADR and its PR.
**Date:** 2 October 2026
**Base commit assessed:** `1f900d2eae980f738ccf6f5f651b7397290b8ca6` (`main`)
**Relates to:** ADR-AI-01 (partially superseded, see below); ADR-SF-01 (unchanged).
**Companion documents:** [assessment](./vendor-neutral-ai-assessment.md), [owner brief](../QOS_Cursor_Vendor_Neutral_AI_Brief.md), [owner review](../QOS_Cursor_ADR_AI_02_Review_and_Next_Step.md).

## Context

ADR-AI-01 made Hyperagent the runtime for every QOS agent and made QOS MCP the path by which agents reach QOS data. The shipped slices (QOS-139 Menu Manager, QOS-140 AI photos) showed that the business value sits in QOS-owned parts: tenant-scoped snapshotting, deterministic menu health, strict output validation, private quarantine, provenance and human review. A mandatory external runtime adds a second credential, configuration and tenancy surface, and the current implementation leaves durability and uncertain-outcome gaps (see the assessment, section A).

## Decision

1. **QOS owns** business capabilities, authentication, authorization, tenant isolation, run and job state, budgets, approvals, audit, run history and operational configuration. External AI services are replaceable implementations behind QOS-owned contracts.

2. **Executor, framework and model provider are separate identities.** Contracts and persisted configuration distinguish:
   - `executorKind`: `native` (QOS runs the loop) or `external` (a remote runtime runs it);
   - `executorAdapter`: the framework or runtime adapter, e.g. `hyperagent` today and an Agents SDK adapter later;
   - `adapterVersion`: the adapter implementation/configuration version;
   - `modelProvider` and `modelId`: which vendor and model served the request, or `null` when an external runtime does not disclose it. Unknown is recorded as unknown, never fabricated;
   - `agentDefinitionVersion`: the immutable QOS definition version.

   The existing persisted `agent_provider` value maps to this identity through a documented compatibility table (`src/lib/agents/execution-identity.ts`). A native executor receives an injected QOS-owned model boundary; SDK `Model`, `Runner`, response and session objects stay inside the adapter. Replacing a model provider must not require replacing the executor, and replacing the executor must not require rewriting menu business logic.

3. **Capabilities are declared, not assumed.** Each adapter declares structured output, tool calls, cancellation, continuation, usage reporting, external execution and submit idempotency. Unsupported capabilities fail clearly. Nothing silently weakens behaviour, and no adapter pretends to support cancellation it cannot perform.

4. **Provider failures are classified per operation.** Every provider error carries one of:
   - `not_dispatched` — proven pre-dispatch failure;
   - `rejected` — the provider confirmed it did not process the request;
   - `submission_unknown` — the request may have been accepted, with no confirmed result or reference;
   - `failed_after_processing` — the provider confirmed failure, refusal or invalid output, possibly billed;
   - `read_failed` — a safe read or poll of a known reference failed.

   Two further states are success-side and belong to run state, not errors: a known accepted remote operation with a durable reference, and a successful provider response whose local persistence failed. A generic timeout, connection error or HTTP 5xx never implies safe resubmission. A correlation or request ID is not an idempotency guarantee unless the provider documents that for the endpoint. **Synchronous model and image requests can have uncertain paid outcomes too**; "synchronous" does not make idempotency inapplicable.

5. **One retry owner per provider operation.** Other layers' automatic retries (SDK clients, transports) are disabled where necessary and verified by tests. Retries are bounded, jittered and respect supported retry-delay headers. There is no automatic replacement-provider fallback for paid or mutating work.

6. **Known operations are reconciled, not resubmitted.** Polling a known external reference is a safe read and may be retried. Unknown submission blocks automatic resubmission of the logical request, including through a new browser idempotency key. `outcome_unknown` has an explicit recovery process (decision 7); it is not a dead end.

7. **`outcome_unknown` recovery.** Each attempt records its evidence (dispatch time, adapter identity, any reference, any reported usage). Resolution is an explicit, audited transition by an authorized actor or a reconciliation job: confirm completed (with result), confirm failed, or acknowledge-and-abandon. A deliberate new attempt after uncertainty requires authorized acknowledgement and a new budget reservation. Cancelled and completed runs are never silently reopened.

8. **One default model-provider setup.** Initially OpenAI, via one operator-owned key and an explicit per-task model allowlist, serving image generation and, later, the native Menu Manager. No normal tenant configures a provider or links an external workspace. The product is presented as QOS Intelligence, not provider dashboards.

9. **Versioned agent definitions in source.** Stable key, version, instructions, allowed tools, output schema and limits. A run pins its definition, executor identity, model configuration, tool schema versions, requested resources, operational limits and the minimum bounded immutable input (or a reference to a versioned private snapshot, with checksum and schema version). Queued work never silently runs against a newer definition; old definitions and adapters are retained for the drain window, or affected runs are terminated explicitly.

10. **Pinning does not freeze permissions.** Live tenant status, membership, location/resource access, entitlement and emergency restrictions are rechecked before provider dispatch, every tool call, result access and any side effect. Effective authority is the intersection of the originally authorized scope and current permissions: a later role grant cannot widen an accepted run; revocation or suspension stops subsequent work, though it cannot retract data already sent to a provider.

11. **One in-process tool gateway.** It performs authorization, validation, budget checks, service invocation, output validation and audit. Each tool declares whether it reads the accepted snapshot or current authoritative data; current reads return version/freshness evidence, and existing stale-context checks remain before human acceptance of generated media. Native agents call the gateway directly. QOS MCP is a later thin external adapter over the same gateway, never an internal dependency.

12. **The first native Menu Manager is read/analyse/propose only.** Agent-initiated image generation stays disabled until a separate owner decision. Before any chargeable tool exists, each logical action gets a stable QOS operation identity with persisted intent, resource scope, request fingerprint and outcome, and idempotency is enforced in the QOS application service, so a regenerated SDK tool-call ID cannot bypass deduplication.

13. **A durable queue does not checkpoint an agent loop.** A database job around an in-memory SDK run does not checkpoint individual model calls or tool actions. The first native version records enough attempt evidence to avoid blindly replaying a possibly completed paid run after a crash, and uses the conservative recovery in decision 7. A small attempt/action record is added only where the task requires it; no general workflow engine.

14. **Durable execution** uses a bounded Postgres-backed queue and a dedicated AI worker, using the video worker as a *pattern only*. The production video worker is not modified as part of the AI rollout. The queue design must cover atomic admission (authorization + budget reservation + run creation + enqueue), atomic claim with bounded leases and no transaction held across provider calls, heartbeats, lease fencing on authoritative writes, recovery for expired leases and uncertain submissions, global/provider/tenant/job-kind concurrency across replicas, fair scheduling, a terminal operator-review state, graceful shutdown, alerts, and an external wake-up signal that sees queued work, due polls, expired leases and reconciliation work after scale-to-zero.

15. **Privileges are a security boundary.** API runtime, AI worker, scaler, migration/admin, privileged-function owners and credential reader/writer get separately designed privileges. Prefer a distinct restricted worker login. The API does not receive global claim privileges; the scaler receives only an aggregate count. Every `SECURITY DEFINER` function has reviewed ownership, a fixed trusted `search_path`, schema-qualified references, narrow grants and explicit `PUBLIC` revocation. A caller-settable session flag is not an authorization boundary against a caller that can set it. Deployed roles and grants are verified before worker activation.

16. **Basic spend admission precedes new paid paths.** Before any new paid execution path is activated: race-safe atomic tenant *and* platform reservations (consistent lock ordering or an equivalent atomic mechanism), explicit per-run bounds, and global/provider/tenant concurrency limits. Queued reservations and uncertain attempts count. Request quotas, model bounds, estimated monetary reservations, reported usage and unknown potentially billed usage are tracked separately. An application quota or estimate is never presented as an external invoice ceiling. When a required policy is unset, the new paid path stays disabled. Uncertain paid work is never released just because a timer expired.

17. **Feature flags select how new work is admitted.** Every accepted run/job records its execution mode and adapter configuration. Flags never move existing work between inline and worker execution or between executors. Queued or uncertain work is never resent through a legacy path; a running native job is never switched to Hyperagent; Hyperagent is never re-enabled automatically.

18. **Hyperagent is optional and frozen in scope.** Retained as an explicitly enabled external executor until the native replacement is accepted, then disabled by default. Shared-workspace use is not expanded until cross-tenant isolation of workspace memories, files and history is demonstrated; backend RLS does not establish that.

19. **Privacy.** SDK tracing export is off by default; prompts, responses, tool payloads and credentials are not exported through runtime hooks; operational events are sanitized. `store: false` is used where the endpoint supports it but is not described as zero data retention. Retention and cleanup periods are owner decisions; nothing historical is deleted without approval. Encrypted database storage for rotating OAuth credentials remains acceptable subject to its threat model and a planned key-rotation procedure.

20. **Migrations are forward-only**, with additive, backward-compatible application changes. Application rollback never requires a down migration.

21. **Evidence discipline.** Implemented, tested and deployed are reported separately. Owner-reported UI success is user-reported evidence. Redacted, authorized real-provider smoke evidence is recorded before any default changes; paid smoke tests never run in CI. A fake adapter proves interface isolation, not real-provider equivalence.

## What this supersedes in ADR-AI-01

| ADR-AI-01 section | Status under ADR-AI-02 |
|---|---|
| Decision: "Hyperagent is an external orchestration/agent runtime" for QOS capabilities | Superseded by decisions 2, 8 and 18. Native execution is the intended default; Hyperagent is optional. |
| Target architecture (Gateway → Hyperagent → QOS MCP chain) | Superseded by decision 11 and the architecture in the assessment, section C. |
| Integration direction B as the route by which QOS agents reach data | Superseded: QOS MCP is a later external adapter (decision 11). |
| Provider abstraction (`listAgents`, `startRun`, `getRun`, `sendMessage`) | Replaced by separate executor and model/image contracts with declared capabilities and classified outcomes (decisions 2–4). `listAgents` remains Hyperagent operator tooling; `sendMessage` is not added until a continuation requirement exists. |
| Persistence: `AgentApproval`, `AgentAuditEvent` | Superseded: existing review flows and append-only `tenant_audit_events`. No duplicate audit tables. |
| Hyperagent workspace strategy and productisation gate | Off the core path. Shared-workspace scope frozen (decision 18); QOS-138 deferred. |
| Event integration via Hyperagent webhooks; "manually create agent in Hyperagent" in phases 9.4–9.6 | Superseded for the core path. Future capabilities default to native execution. |
| QOS-132 acceptance "migration is reversible" | Superseded by decision 20. |

**Retained from ADR-AI-01:** QOS as system of record and authorization boundary; no direct database, Key Vault or payment access for any provider; server-side tenant resolution; no generic CRUD or SQL tools; deterministic validation plus explicit approval for protected writes; kill switches per tenant, capability and provider; mandatory cross-tenant negative tests; core QOS working with AI disabled.

## Consequences

- One new SDK dependency later (native executor PR), selected and pinned only after verifying release, licence, Node compatibility, transitive dependencies and retry behaviour against current official documentation.
- One new worker deployment later, with its own privilege, recovery and scaling design reviewed before activation.
- An evaluation harness and authorized real-provider smoke evidence are required before any default changes.
- Provider portability means a bounded adapter plus compatibility evaluation, not identical behaviour, and in-flight opaque provider state is not portable.

## Unresolved owner decisions

These do not block the behaviour-preserving boundary work:

- paid monthly, daily and per-run limits, and whether unset limits disable a path (QOS-28 decision D28);
- activation of agent-initiated image generation;
- the exact model and SDK release at their implementation gate;
- retention periods and external data policy;
- worker deployment and scale settings;
- tenant entitlement and which roles may start paid runs;
- external MCP principal model, client and domain;
- any destruction of historical Hyperagent or QOS data.
