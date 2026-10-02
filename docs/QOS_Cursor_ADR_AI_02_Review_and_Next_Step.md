# QOS — Review of the vendor-neutral AI assessment and next Cursor task

## How to use this document

This is a proposed owner instruction for Cursor, based on the uploaded **QOS vendor-neutral AI foundation: assessment and proposed plan**. It becomes the execution instruction when Nitesh sends it to Cursor. It does not record approval of paid usage, cloud deployment, data-retention periods or public MCP exposure.

The assessment reports commit `1f900d2eae980f738ccf6f5f651b7397290b8ca6` on `main`. Its repository observations have not been independently verified by this review. Check the current commit before editing; reconcile any changes since that baseline. Do not restart broad discovery unless the repository has materially changed.

## Decision and immediate scope

Proceed with the vendor-neutral direction, with the corrections below. Preserve the working Menu Manager, deterministic menu health and reviewed image-generation experience. Do not rewrite QOS or build a generic AI platform product.

**Immediate implementation scope: the assessment's PR 0 and PR 1 only, as one bounded review tranche.** Produce updated architecture documentation plus behavior-preserving provider boundaries and contract tests. Use separate commits for documentation and code. Stop for review before migrations, worker implementation, new paid calls or changes to production behavior.

The intended end state is:

- QOS owns authorization, tenant isolation, business tools, run/job state, budgets, audit and operational configuration.
- Core AI functionality has one default model-provider setup; Hyperagent is optional.
- Replacing a model provider does not require replacing the agent execution framework.
- Replacing an execution framework does not require rewriting menu business logic.
- Native agents use authorized in-process tools. MCP is a later external adapter over the same tools.
- Provider switching requires adapter compatibility and evaluation, not a claim of identical behavior.

The architecture direction is accepted for preparation of the next PR. Keep **ADR-AI-02 Proposed** in the repository until Nitesh approves the corrected ADR/PR. Do not mark old work complete or update Linear without separate approval.

---

## 1. Preserve the useful architecture already identified

Retain the assessment's section structure A–F and existing module locations where practical. Update the affected sections and record an explicit amendment log rather than replacing the assessment with an unrelated plan.

Retain:

- `AiPhotoProvider` and the current media quarantine, normalization, provenance, review, stale-context and accept/reject mechanisms.
- Existing QOS authentication, location checks, tenant context, RLS and append-only tenant audit.
- Existing provider fakes and dependency-injection patterns.
- Forward-only migrations with additive, backward-compatible application changes.
- A versioned Menu Manager definition in QOS source.
- The proposed Postgres-backed AI worker direction, subject to a reviewed security, recovery and deployment design.
- One default OpenAI configuration initially; no normal tenant must configure an external agent workspace.
- Hyperagent only as an optional, explicitly enabled executor.

Do not add another database, queue SaaS, workflow SaaS, agent marketplace, prompt-management SaaS, tracing platform or browser platform to deliver this foundation.

## 2. Separate executor, framework and model-provider identity

The assessment separates these in principle but recombines them in implementation as a native OpenAI executor and an `agent_provider = openai` value.

Use separate concepts in QOS-owned contracts and persisted configuration, for example:

    executorKind: native | external
    executorAdapter: agents_sdk | hyperagent
    modelProvider: openai | another-supported-provider
    modelId: the selected model identifier
    agentDefinitionVersion: immutable version
    adapterVersion: implementation/configuration version

These are illustrative names, not mandatory new columns. Reuse existing fields through a documented compatibility mapping where reasonable. For an external runtime, model identity or usage may be unknown; record that honestly rather than fabricating values.

The native executor must receive a QOS-owned model/provider factory or equivalent injected boundary. Keep SDK-specific `Model`, `Runner`, response and session objects inside the adapter layer. The shared Menu Manager definition and tool gateway must not depend on them.

A fake model-provider implementation must demonstrate that the same Menu Manager definition and tool registry run without changing catalogue services or replacing the executor. This is an isolation test, not proof that another real vendor produces equivalent results.

Using the OpenAI Agents SDK is the recommended implementation choice in principle. Before adding it in its later PR, verify the exact release, license, Node compatibility, direct/transitive dependencies and retry behavior against current official documentation. Do not treat version numbers from the assessment as pre-approved or automatically current. Pin the selected version and commit the lockfile.

Do not build unused model-provider methods or several real adapters. Implement the smallest model boundary required by Menu Manager.

### Import and endpoint boundaries

An SDK import restriction alone is insufficient: the assessment says the image adapter currently uses raw `fetch`.

Test both SDK imports and direct provider HTTP access. Provider calls belong only in designated adapters; catalogue services, routes and UI must not embed provider URLs, headers or credentials. Ensure SDK types do not leak through exported domain contracts.

Resolve the runtime hard-coded Hyperagent connection check only inside the selected Hyperagent adapter/readiness path. In the immediate tranche, preserve current selection and behavior; default changes happen later.

## 3. Correct submission, timeout and retry semantics

The assessment contains a contradiction: it calls native idempotency “not applicable (synchronous)” but treats uncertain remote submission as important for Hyperagent. Synchronous model and image requests can also have uncertain outcomes.

Separate:

1. Proven pre-dispatch failure.
2. Confirmed provider rejection with documented safe retry semantics.
3. Submission that may have been accepted but has no confirmed result/reference.
4. A known accepted remote operation with a durable reference.
5. A successful provider response whose local persistence failed.
6. A confirmed failure/refusal/invalid response, potentially with billed usage.

Do not infer safe resubmission from a generic timeout, connection exception or HTTP 5xx. Use an operation-specific provider error contract. A correlation/request ID is not an idempotency guarantee unless the provider explicitly documents that behavior for the endpoint.

Require:

- One retry owner per provider operation; disable other layers' automatic retries where necessary and verify this with tests.
- Bounded, jittered retries and respect for supported retry-delay headers.
- No automatic replacement-provider fallback for paid or mutating work.
- Unknown submission blocks automatic resubmission for the logical request, including through a new browser request key.
- Polling a known external reference is different from resubmitting work. Safe read polls can be retried without creating another job at the provider.
- Reconcile known references where possible instead of treating every post-dispatch lease expiry as unrecoverable.
- Distinguish estimated/reserved usage, actual reported usage, and usage that may have been billed.

`outcome_unknown` needs a recovery process, not an indefinite dead end. Define either an explicit controlled reconciliation transition or an append-only attempt-resolution record with an effective resolved status. Preserve attempt evidence and do not silently reopen cancelled/completed runs. A deliberate new attempt after uncertainty requires authorized acknowledgement and a new budget reservation.

The executor outcome contract must carry uncertainty, blocking and cancellation honestly. A discriminated `step()` result is acceptable, but do not hide these in a generic `failed` string or pretend that unsupported cancellation is available.

## 4. Make the agent loop and queue genuinely recoverable

A database job around an in-memory SDK call does not, by itself, checkpoint the individual model calls and tool actions.

For the first native version, use bounded read-only analysis. Keep agent-initiated image generation disabled. Record enough attempt evidence to avoid replaying an entire possibly completed paid run after a crash. Unknown paid execution must use the conservative recovery path above.

Before adding a chargeable tool:

- Assign each logical action a stable QOS-owned operation identity.
- Persist its validated intent, resource scope, request fingerprint and outcome.
- Enforce idempotency in the QOS application service, not only at the agent-run level.
- A new SDK tool-call ID or a regenerated call must not bypass logical-action deduplication.
- Checkpoint/reconcile completed actions before allowing continuation or replay.

Do not build a general workflow engine. Use a small durable attempt/action record only where the actual task requires it.

### Worker requirements

Use the existing video worker as a pattern, not as permission to refactor it. The assessment says the video worker is untouched but later proposes extracting and changing it. **Do not modify the production video worker as part of the AI worker rollout.** Any shared-helper extraction is a separate justified change with regression tests.

The AI queue design must specify:

- Atomic request authorization, budget reservation, run/candidate creation and enqueueing.
- Atomic claim and bounded lease; no database transaction held open during provider HTTP calls.
- Heartbeats or lease-extension rules for long calls.
- Lease-generation/fencing checks for authoritative persistence and before further tool side effects.
- Awareness that a DB lease cannot cancel or fence an already-dispatched external request.
- Recovery for expired leases, abandoned jobs, cancelled work and uncertain submissions.
- Global, provider, tenant and job-kind concurrency controls enforced across replicas.
- Fair scheduling without allowing one tenant or job kind to starve others.
- A defined terminal/dead-letter or operator-review representation for exhausted jobs.
- Graceful shutdown, backlog/oldest-job alerts and worker-health evidence.
- Wake-up rules that cover queued work, due polls, expired leases and reconciliation work even after scale-to-zero.

If all replicas are zero, a timer inside the worker cannot wake itself. Show how the external scaler/scheduler will see the due work and how its DB access is restricted.

Use load tests to validate the proposed limits. The assessment's tenant counts, latency targets, cold-start times and cost figures are provisional, not capacity guarantees.

## 5. Pin inputs and execution configuration without freezing permissions

The assessment reports that only a snapshot hash and selected IDs are stored for Menu Manager. A hash alone cannot recreate the original input after menu data changes.

For native version 1, persist the minimum bounded immutable input needed for the accepted job, or a reference to a versioned snapshot in approved private storage. Store its checksum and schema version. Do not place the full snapshot in ordinary logs or tenant audit metadata.

Record and retain the relevant versions/configuration for a run, including agent definition, executor, model-provider configuration, model, tool schemas, requested resources and operational limits. Retain old definitions/adapters for the in-flight drain window, or terminate affected runs explicitly; do not silently run queued work against a new definition.

State whether each tool reads the accepted snapshot or current authoritative data. When current data is read, return version/freshness evidence and retain existing stale-context checks before any human acceptance of generated media.

Configuration pinning must not freeze security. Recheck live tenant status, membership, location/resource access, entitlement and emergency restrictions before provider dispatch, every tool call, result access and any side effect. Effective authority is no broader than both the original authorized scope and current permissions.

A later role grant must not expand the resources of an already accepted run. Revocation or suspension must stop subsequent work; it cannot retract data already sent to a provider.

Keep SDK histories, caches, context objects and conversation state tenant/run isolated. Do not introduce shared learning, a vector database or global merchant memory for this task.

## 6. Treat queue and credential privileges as a security boundary

The assessment proposes running the AI worker as `qos_app` and global claim/count functions as `SECURITY DEFINER`. Do not assume RLS alone makes those safe.

Produce a privilege matrix for:

- API runtime role;
- AI worker runtime role;
- scaler/count-only identity;
- migration/administrative role;
- owner of each privileged function;
- credential reader/writer.

Prefer a distinct restricted worker database login/role. Ordinary API code should not receive global claim privileges or cross-tenant job payload access. The scaler should receive only the minimum aggregate queue signal, not business data or credentials.

Every privileged function must have reviewed ownership, a trusted fixed `search_path`, schema-qualified references where appropriate, narrow grants, and explicit revocation of unwanted default `PUBLIC` execution. Document how the function interacts with FORCE RLS. Do not give API/worker roles superuser, database-owner or broad BYPASSRLS privileges to make tests pass.

A caller-set database session flag is not an independent authorization boundary against a caller that can set that same flag. Inspect the actual credential-access design and document its threat model rather than declaring it safe solely because a helper uses an opt-in setting.

Verify deployed database roles and grants before activating the worker. The reported stale Bicep reference is a reason to inspect, not proof that the deployed application uses administrator credentials. Report safe role/permission metadata; never print secrets. Azure reads and writes remain separately authorized.

Tenant suspension should be enforced through a reusable central authorization check, consumed by AI immediately. Record a separate focused platform remediation for the wider suspension gap, with tests for intended public/staff behavior. Do not silently change unrelated storefront behavior in this PR.

## 7. Bring minimum spend controls forward

Do not wait until the assessment's PR 6 to establish the controls required by the worker and asynchronous paid jobs in PRs 4–5.

Before enabling new paid execution paths, require atomically reserved tenant and platform budgets, explicit per-run bounds, and global/provider/tenant concurrency controls.

A per-tenant lock plus a platform count is not enough: two different tenants can observe the same remaining platform allowance. Use a race-safe reservation design and a consistent lock ordering or equivalent atomic mechanism. Include queued reservations and uncertain attempts in accounting.

Define separately:

- request/job quotas;
- model input/output bounds and turn/tool-call limits;
- estimated monetary reservations based on versioned provider pricing/configuration;
- reported actual usage/cost where available;
- unknown potentially billed usage.

Do not present an application quota or an estimate as a guaranteed external invoice ceiling. Define conservative admission behavior when usage or pricing is unavailable.

Expired reservations for definitely unstarted work can be released under a tested policy. Do not release uncertain paid work simply because its lease or reservation timer expired.

No new numeric allowance is approved in this instruction. Do not adopt the hidden 20/day default or the assessment's proposed concurrency values as owner-approved policy. Show effective configuration, preserve existing explicitly configured settings pending review, and block new paid-path activation when its required policy is unset.

The first native Menu Manager release remains read/analyse/propose only. Existing human-requested image generation and human approval are preserved. Agent-initiated image spend requires a separate explicit decision.

## 8. Make feature flags and rollback safe for in-flight work

The assessment's “turn the flag off and return to inline” rollback is incomplete.

Record the execution mode and adapter configuration for every accepted run/job. Flags select how **new** work is admitted; they do not transfer existing work between inline and worker execution.

Never:

- resend a queued/uncertain job through the legacy path when a flag changes;
- switch a running native job to Hyperagent;
- recreate the same logical image request under a second mode;
- re-enable Hyperagent automatically if its credentials or isolation are not approved.

A rollout/rollback runbook must cover admission freeze, supported-version checks, draining or explicit cancellation, uncertain-outcome reconciliation and read-compatible application rollback.

Backfill legacy queued/running/awaiting-approval rows only with proven provenance. Rows without a confirmed provider reference must not be resubmitted blindly. Make backfills idempotent.

When changing an API to return 202 or accept arrays, preserve compatible behavior for already-open clients or version the request/response contract. Both paths must use the same deduplication and reservation rules.

Fix the feature-disabled “running forever” behavior independently of provider availability. Preserve access to already-authorized historical run results, while continuing to enforce current resource access.

## 9. Privacy, secret rotation and production evidence

Keep tracing export disabled by default. Verify SDK/runtime hooks do not export prompts, responses, tool payloads or credentials unintentionally. Use sanitized structured operational events; do not use raw AI output as a log message or executable markup.

Use `store: false` where supported by the selected provider endpoint, but do not label it zero data retention. Document provider-side application-state, abuse-monitoring, file, cache and tracing controls separately. Provider data controls require endpoint-specific verification.

Design retention and cleanup for private snapshots, results, raw diagnostic excerpts, prompts, failed/rejected blobs and offboarded tenants. Preserve accepted image provenance under the appropriate asset/audit policy. Do not silently choose retention periods or delete historical data before owner approval.

Keep encrypted DB credential storage if it satisfies the reviewed threat model; do not require an additional SaaS credential product. Add a planned, tested key-rotation procedure: key identifiers, active/previous decrypt keys or equivalent, bounded re-encryption, safe error mapping and redacted diagnostics. Missing/rotated keys must not strand runs or expose secrets.

Freeze expansion of the current shared Hyperagent workspace until its cross-tenant isolation is demonstrated. Backend RLS does not establish isolation of external workspace memories, files or history. Keep its use within its current approved scope pending the native transition.

Retain the assessment's distinction between implemented, tested and deployed. The owner's reported successful UI use is valid user-reported evidence, not an independently observed deployment test. Record redacted, authorized real-provider smoke evidence before changing the default; never fabricate it or run paid smoke tests in CI.

## 10. QOS MCP stays later and small

Keep QOS-133 as a thin external adapter over the same authorized tools. Start with read-only tools and one explicitly approved client after the internal boundary is proven.

Do not deploy public MCP, create DNS, configure OAuth clients or add external scopes in the immediate tranche.

External credentials must establish a validated principal/delegation scope. Model-visible prompt values, menu IDs, thread IDs and MCP session IDs are not authentication. Do not revive the earlier shared-agent secret-in-prompt runContext design as the default tenant security mechanism.

The user-facing product remains **QOS Intelligence**, not a collection of provider dashboards. Provider setup is operator-level; normal tenants receive governed product capabilities without choosing a model vendor or linking a Hyperagent workspace.

---

## Amended sequence using the assessment's PR labels

### Immediate: PR 0 + PR 1

Update sections B–F and ADR-AI-02 with this review. Add the minimal executor/model/image boundaries, capability/error contracts, adapter readiness placement, fake-provider contract tests and architecture-boundary checks. Keep current defaults, routes and behavior unchanged.

Do not install the new native SDK yet merely to define contracts. No migration, real provider call, secret change, cloud resource, video-worker edit, merge or deploy.

### Before worker activation: targeted safety work + PR 2 / PR 3

Pin run definitions/input, fix stuck-status handling, introduce the shared tool gateway and live authorization, and implement the minimum race-safe reservations required for paid job admission. Separate intentional behavior/security changes into explicit reviewable PRs. Complete the role/privilege and recovery designs before queue migration.

### PR 4 / PR 5

Implement durable Menu Manager and asynchronous image processing with the corrected operation-specific retry, lease, recovery and rollout semantics. Preserve reviewed media behavior and leave the video worker unchanged.

### PR 6

Complete richer usage reconciliation, operational metrics and reviewed retention/cleanup. It must not be the first place basic spend admission appears.

### PR 7 / PR 8

Add the verified SDK dependency and native executor. Prove injected model-provider isolation with fakes, then run separately approved real-provider evaluation. Change defaults only after acceptance. Drain runs on their pinned executor. Hyperagent remains optional and is not an automatic fallback.

### PR 9 / PR 10

Only then implement and expose a narrowly authorized MCP adapter with explicit owner approval. No broad tool catalogue in the first release.

PR numbering is for continuity, not a requirement to create one new Linear issue per PR. Prefer updating existing owners and adding only genuinely necessary child work. Use the next available migration identifiers at implementation time; do not reserve 0040–0042 without checking current main.

## Minimum acceptance tests to include in the corrected plan

1. Menu Manager definition works with an injected fake model provider without catalogue changes or a runtime replacement.
2. Hyperagent credentials and configuration are absent; native Menu Manager plus reviewed image generation work with provider fakes. Real-provider smoke is separate and authorized.
3. Accepted jobs progress without browser polling and recover conservatively after restart.
4. A known provider operation is polled, not resubmitted, after a recoverable worker failure.
5. Unknown paid submission blocks automatic resubmission even with a different browser request key.
6. Lost leases prevent stale authoritative writes; external calls already in flight are treated honestly.
7. Cross-tenant/location access, revoked membership, suspended tenants, guessed IDs and stale image context are denied appropriately.
8. API and scaler identities cannot exercise worker-only global claim or credential privileges.
9. Two tenants racing for the final platform allowance cannot both reserve it.
10. An in-flight run is not moved to another provider or inline path during flag changes or rollback.
11. Prompt injection cannot alter allowed tools, tenant scope, budgets or protected-write rules.
12. Normal menu editing/publishing continues with AI disabled.
13. No secrets, raw prompts or tool payloads reach disallowed logs/traces.
14. Load tests report queue delay, fairness, DB pool use, provider concurrency and total observed latency, including cold start where relevant.

## Required end-of-tranche report

Stop after PR 0 + PR 1 and report:

- assessed base commit and working-tree safety;
- exact files and symbols changed;
- what remained untouched;
- amended ADR decisions and unresolved owner decisions;
- tests and lint/type-check commands actually run, with results;
- compatibility evidence for existing Hyperagent and image-provider fakes;
- confirmation of no migrations, dependency installation, paid invocations, secret exposure, cloud changes or deployments;
- proposed next small PR, including explicit risks and rollback.

Do not assert compliance from interface names alone. Show the relevant tests and boundary checks. Do not merge; Nitesh reviews and merges.

## Still requiring explicit owner decisions

Paid monthly/daily/per-run limits; activation of agent-initiated image generation; exact model/SDK choice at its implementation gate; retention periods and external data policy; worker deployment and scale settings; tenant entitlement/paid-run permissions; external MCP principal/client/domain; any destruction of historical Hyperagent or QOS data.

These decisions do not block the immediate behavior-preserving tranche.

---

## Basis and reference notes

**Provided source:** `Pasted markdown.md`, “QOS vendor-neutral AI foundation: assessment and proposed plan.” Relevant ranges: baseline 21–27; current behavior and security 33–150; ADR 160–195; contracts and lifecycle 223–294; PR sequence 298–385; approvals 405–424. Statements about the repository in this review are based on that assessment, not a fresh source-code inspection.

**External documentation checked for this review:**

- OpenAI Agents SDK, Models — custom `Model` / `ModelProvider` injection: https://openai.github.io/openai-agents-js/guides/models/
- OpenAI Agents SDK, Running Agents — multi-turn tool loop, bounds and cancellation: https://openai.github.io/openai-agents-js/guides/running-agents/
- OpenAI TypeScript API library — retry and timeout configuration: https://developers.openai.com/api/reference/typescript
- OpenAI Agents SDK, Tracing — tracing controls: https://openai.github.io/openai-agents-js/guides/tracing/
- OpenAI API data controls — endpoint-specific retention distinctions: https://developers.openai.com/api/docs/guides/your-data
- PostgreSQL 16, CREATE FUNCTION — SECURITY DEFINER hardening: https://www.postgresql.org/docs/16/sql-createfunction.html
- PostgreSQL 16, Row Security Policies — owner/superuser/BYPASSRLS behavior: https://www.postgresql.org/docs/16/ddl-rowsecurity.html
- Microsoft Azure Architecture Center, Retry pattern — idempotency and failure-sensitive retries: https://learn.microsoft.com/en-us/azure/architecture/patterns/retry
- OWASP, AI Agent Security — tool least privilege, isolation and bounded actions: https://cheatsheetseries.owasp.org/cheatsheets/AI_Agent_Security_Cheat_Sheet.html
- MCP security guidance — authentication, token audience and session risks: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices
- Azure Container Apps scaling and pricing — validate the actual configuration, not assumed cold-start/cost figures: https://learn.microsoft.com/en-us/azure/container-apps/scale-app and https://azure.microsoft.com/en-us/pricing/details/container-apps/

The detailed contracts, sequencing and recovery choices above are QOS-specific recommendations, not claims that an external standard mandates these exact names or structures.
