import { randomBytes } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  agentProviderConnections,
  agentProviderCredentials,
  agentRuns,
  staffIdentities,
  staffMemberships,
  tenantAgentBindings,
  tenantAuditEvents,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import {
  AgentRunError,
  boundRawResultExcerpt,
  claimAgentRunPoll,
  createAgentRun,
  expireAgentRunIfDue,
  getAgentRun,
  getLatestAgentRunForSubject,
  markAgentRunFailed,
  markAgentRunStarted,
  pollAgentRunOnce,
  QOS_WAIT_DEADLINE_CODE,
  RAW_RESULT_EXCERPT_MAX_CHARS,
  recordAgentRunOutcome,
  toAgentRunView,
  type CompletionInterpretation,
} from "@/lib/agents/agent-runs";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { withAgentCredentialAccess } from "@/lib/agents/db-context";
import {
  getAgentProviderConnectionStatus,
  loadAgentProviderCredentials,
  markAgentProviderConnectionStatus,
  replaceAgentProviderCredentials,
  saveAgentProviderConnection,
} from "@/lib/agents/provider-connections";
import {
  approveTenantAgentBinding,
  getTenantAgentBinding,
  setTenantAgentBindingEnabled,
  type TenantAgentBinding,
} from "@/lib/agents/tenant-agent-bindings";
import { FakeAgentProvider } from "@/lib/agents/testing/fake-agent-provider";
import { AgentProviderError } from "@/lib/agents/types";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const APPROVED_AGENT_ID = "cmun4w730017807adjrkbep1t";
const POLL = { pollIntervalMs: 5_000, leaseMs: 30_000, queuedStaleMs: 120_000 };
const TIMEOUT_MS = 10 * 60_000;

const acceptAll = (finalMessage: string): CompletionInterpretation => ({
  ok: true,
  result: { summary: finalMessage },
  auditSummary: { findingCount: 1 },
});

integrationDescribe("agent platform foundation", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.agent_runs, qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.tenant_audit_events, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(tenantId: string, role: "administrator" | "user", subject: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  async function seedTenantWithBinding(enabled = true) {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const adminSubject = "admin.quotes@test";
    await seedMember(quotes.tenant.id, "administrator", adminSubject);
    let binding = await approveTenantAgentBinding(db, {
      tenantId: quotes.tenant.id,
      capability: "menu_manager",
      provider: "hyperagent",
      providerAgentId: APPROVED_AGENT_ID,
      approvedBySubject: "operator:platform",
    });
    if (enabled) {
      binding = await setTenantAgentBindingEnabled(
        db,
        quotes.tenant.id,
        adminSubject,
        "menu_manager",
        { enabled: true, expectedVersion: binding.version },
      );
    }
    return { quotes, adminSubject, binding };
  }

  function runInput(
    tenantId: string,
    binding: TenantAgentBinding,
    overrides: Partial<Parameters<typeof createAgentRun>[1]> = {},
  ) {
    return {
      tenantId,
      binding,
      subject: { type: "menu", publicId: "men_breakfast", version: 3 },
      requestedBy: { subject: "admin.quotes@test", actorClass: "staff_administrator" as const },
      idempotencyKey: `idem-${randomBytes(6).toString("hex")}`,
      requestSummary: { productCount: 12, selectedProductCount: 0 },
      runTimeoutMs: TIMEOUT_MS,
      ...overrides,
    };
  }

  async function auditActions(tenantId: string, runPublicId: string) {
    const rows = await withTenantContext(db, tenantId, (tx) =>
      tx
        .select({ action: tenantAuditEvents.action, changeSummary: tenantAuditEvents.changeSummary })
        .from(tenantAuditEvents)
        .where(
          and(
            eq(tenantAuditEvents.tenantId, tenantId),
            eq(tenantAuditEvents.entityPublicId, runPublicId),
          ),
        )
        .orderBy(tenantAuditEvents.occurredAt),
    );
    return rows;
  }

  describe("platform provider connection", () => {
    const credentialKey = parseAgentCredentialKey(randomBytes(32).toString("base64"));
    const credentials = { access_token: "at-live-secret", refresh_token: "rt-live-secret" };

    it("stores encrypted credentials that only credential access can read", async () => {
      await saveAgentProviderConnection(db, {
        provider: "hyperagent",
        serverUrl: "https://hyperagent.example/mcp",
        accountLabel: "QOS platform",
        connectedBySubject: "operator:platform",
        credentials,
        credentialKey,
      });

      const [stored] = await db.select().from(agentProviderCredentials);
      expect(stored!.ciphertext).not.toContain("at-live-secret");
      expect(stored!.keyFingerprint).toBe(credentialKey.fingerprint);

      await runAsRole(sqlClient, "qos_app", async () => {
        const hidden = await db.select().from(agentProviderCredentials);
        expect(hidden).toHaveLength(0);

        const status = await getAgentProviderConnectionStatus(db, "hyperagent");
        expect(status.status).toBe("connected");
        expect(JSON.stringify(status)).not.toContain("secret");

        const loaded = await loadAgentProviderCredentials(db, "hyperagent", credentialKey);
        expect(loaded.credentials).toEqual(credentials);
        expect(loaded.version).toBe(1);
      });
    });

    it("rejects runtime writes to the connection outside the platform context", async () => {
      await runAsRole(sqlClient, "qos_app", async () => {
        await expect(
          db.insert(agentProviderConnections).values({
            provider: "hyperagent",
            serverUrl: "https://attacker.example/mcp",
          }),
        ).rejects.toThrow();
      });
    });

    it("lets only one replica win a credential replacement", async () => {
      await saveAgentProviderConnection(db, {
        provider: "hyperagent",
        serverUrl: "https://hyperagent.example/mcp",
        connectedBySubject: "operator:platform",
        credentials,
        credentialKey,
      });

      await runAsRole(sqlClient, "qos_app", async () => {
        const loaded = await loadAgentProviderCredentials(db, "hyperagent", credentialKey);
        const replace = (token: string) =>
          replaceAgentProviderCredentials(db, {
            connectionId: loaded.connectionId,
            provider: "hyperagent",
            expectedVersion: loaded.version,
            credentials: { ...credentials, access_token: token },
            credentialKey,
          });

        expect(await replace("at-refreshed-1")).toBe(true);
        expect(await replace("at-refreshed-2")).toBe(false);

        const reloaded = await loadAgentProviderCredentials(db, "hyperagent", credentialKey);
        expect(reloaded.credentials.access_token).toBe("at-refreshed-1");
      });
    });

    it("refuses to hand out credentials once the connection needs re-auth", async () => {
      await saveAgentProviderConnection(db, {
        provider: "hyperagent",
        serverUrl: "https://hyperagent.example/mcp",
        connectedBySubject: "operator:platform",
        credentials,
        credentialKey,
      });

      await runAsRole(sqlClient, "qos_app", async () => {
        await markAgentProviderConnectionStatus(db, "hyperagent", {
          status: "needs_reauth",
          errorCode: "unauthorized",
        });
        await expect(
          loadAgentProviderCredentials(db, "hyperagent", credentialKey),
        ).rejects.toMatchObject({ code: "needs_reauth" });
        expect((await getAgentProviderConnectionStatus(db, "hyperagent")).lastErrorCode).toBe(
          "unauthorized",
        );
      });
    });

    it("reports disconnected when no connection exists", async () => {
      await runAsRole(sqlClient, "qos_app", async () => {
        expect((await getAgentProviderConnectionStatus(db, "hyperagent")).status).toBe(
          "disconnected",
        );
      });
    });
  });

  describe("tenant agent bindings", () => {
    it("stores the platform-approved agent disabled until a tenant admin enables it", async () => {
      const { quotes, adminSubject } = await seedTenantWithBinding(false);

      const binding = await withTenantContext(db, quotes.tenant.id, (tx) =>
        getTenantAgentBinding(tx, quotes.tenant.id, "menu_manager"),
      );
      expect(binding).toMatchObject({ providerAgentId: APPROVED_AGENT_ID, enabled: false });

      const enabled = await runAsRole(sqlClient, "qos_app", () =>
        setTenantAgentBindingEnabled(db, quotes.tenant.id, adminSubject, "menu_manager", {
          enabled: true,
          expectedVersion: binding!.version,
        }),
      );
      expect(enabled.enabled).toBe(true);

      await expect(
        setTenantAgentBindingEnabled(db, quotes.tenant.id, adminSubject, "menu_manager", {
          enabled: false,
          expectedVersion: binding!.version,
        }),
      ).rejects.toMatchObject({ statusCode: 409 });
    });

    it("does not let a tenant create a binding or change the approved agent", async () => {
      const { quotes } = await seedTenantWithBinding();

      await expect(
        withTenantContext(db, quotes.tenant.id, (tx) =>
          tx
            .update(tenantAgentBindings)
            .set({ providerAgentId: "some_other_agent" })
            .where(eq(tenantAgentBindings.tenantId, quotes.tenant.id)),
        ),
      ).rejects.toThrow();

      const flowers = await createTenantHierarchy(db, flowerTenantFixture());
      await expect(
        withTenantContext(db, flowers.tenant.id, (tx) =>
          tx.insert(tenantAgentBindings).values({
            tenantId: flowers.tenant.id,
            publicId: "agb_self_service",
            capability: "menu_manager",
            provider: "hyperagent",
            providerAgentId: "any_agent_i_like",
            approvedBySubject: "admin.flowers@test",
          }),
        ),
      ).rejects.toThrow();
    });

    it("only lets administrators toggle the capability", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      await seedMember(quotes.tenant.id, "user", "user.quotes@test");

      await expect(
        setTenantAgentBindingEnabled(db, quotes.tenant.id, "user.quotes@test", "menu_manager", {
          enabled: false,
          expectedVersion: binding.version,
        }),
      ).rejects.toBeInstanceOf(StaffAuthorizationError);
    });

    it("isolates bindings and runs between tenants under qos_app", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const { run } = await createAgentRun(db, runInput(quotes.tenant.id, binding));
      const flowers = await createTenantHierarchy(db, flowerTenantFixture());

      await runAsRole(sqlClient, "qos_app", async () => {
        const seen = await withTenantContext(db, flowers.tenant.id, async (tx) => ({
          bindings: await tx.select().from(tenantAgentBindings),
          runs: await tx.select().from(agentRuns),
        }));
        expect(seen).toEqual({ bindings: [], runs: [] });

        await expect(getAgentRun(db, flowers.tenant.id, run.publicId)).rejects.toMatchObject({
          statusCode: 404,
        });
      });
    });
  });

  describe("agent runs", () => {
    it("creates a queued run, audits it and replays the idempotency key", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const input = runInput(quotes.tenant.id, binding);

      const first = await runAsRole(sqlClient, "qos_app", () => createAgentRun(db, input));
      const replay = await runAsRole(sqlClient, "qos_app", () => createAgentRun(db, input));

      expect(first.created).toBe(true);
      expect(first.run.status).toBe("queued");
      expect(first.run.providerAgentId).toBe(APPROVED_AGENT_ID);
      expect(replay).toEqual({ run: first.run, created: false });

      const audit = await auditActions(quotes.tenant.id, first.run.publicId);
      expect(audit.map((event) => event.action)).toEqual(["agent_run.requested"]);
      expect(audit[0]!.changeSummary).toMatchObject({
        subjectPublicId: "men_breakfast",
        request: { productCount: 12 },
      });
    });

    it("rejects a reused key for a different request and a second active run", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const input = runInput(quotes.tenant.id, binding);
      const { run } = await createAgentRun(db, input);

      await expect(
        createAgentRun(db, {
          ...input,
          subject: { type: "menu", publicId: "men_other", version: 1 },
        }),
      ).rejects.toMatchObject({ code: "idempotency_key_reused" });

      await expect(
        createAgentRun(db, runInput(quotes.tenant.id, binding)),
      ).rejects.toMatchObject({ code: "run_in_progress", activeRunPublicId: run.publicId });
    });

    it("refuses to run a disabled capability", async () => {
      const { quotes, binding } = await seedTenantWithBinding(false);

      await expect(createAgentRun(db, runInput(quotes.tenant.id, binding))).rejects.toMatchObject(
        { code: "capability_disabled" },
      );
    });

    it("polls through the lease, then persists the completed result", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const provider = new FakeAgentProvider().script(
        { state: "running" },
        { state: "completed", finalMessage: "3 items need photos" },
      );
      const t0 = new Date("2026-09-30T08:00:00.000Z");
      const at = (ms: number) => () => new Date(t0.getTime() + ms);

      await runAsRole(sqlClient, "qos_app", async () => {
        const { run } = await createAgentRun(db, { ...runInput(quotes.tenant.id, binding), now: t0 });
        await markAgentRunStarted(db, quotes.tenant.id, run.publicId, {
          providerThreadId: "thread_1",
          actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
          pollIntervalMs: POLL.pollIntervalMs,
          now: t0,
        });

        const tooEarly = await pollAgentRunOnce(db, quotes.tenant.id, run.publicId, {
          provider,
          owner: "replica-a",
          ...POLL,
          interpretCompletion: acceptAll,
          now: at(1_000),
        });
        expect(tooEarly.polled).toBe(false);
        expect(provider.getRunCalls).toHaveLength(0);

        const stillRunning = await pollAgentRunOnce(db, quotes.tenant.id, run.publicId, {
          provider,
          owner: "replica-a",
          ...POLL,
          interpretCompletion: acceptAll,
          now: at(5_000),
        });
        expect(stillRunning.run.status).toBe("running");
        expect(stillRunning.run.nextPollAt).toBe(new Date(t0.getTime() + 10_000).toISOString());

        const done = await pollAgentRunOnce(db, quotes.tenant.id, run.publicId, {
          provider,
          owner: "replica-b",
          ...POLL,
          interpretCompletion: acceptAll,
          now: at(10_000),
        });
        expect(done.run.status).toBe("completed");
        expect(done.run.result).toEqual({ summary: "3 items need photos" });
        expect(provider.getRunCalls).toEqual(["thread_1", "thread_1"]);

        const view = toAgentRunView(done.run);
        expect(Object.keys(view)).not.toContain("providerThreadId");

        const audit = await auditActions(quotes.tenant.id, run.publicId);
        expect(audit.map((event) => event.action)).toEqual([
          "agent_run.requested",
          "agent_run.started",
          "agent_run.completed",
        ]);
        expect(audit[2]!.changeSummary).toMatchObject({ findingCount: 1, status: "completed" });
        expect(JSON.stringify(audit)).not.toContain("3 items need photos");
      });
    });

    it("lets exactly one concurrent caller take the poll lease", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const t0 = new Date("2026-09-30T08:00:00.000Z");
      const { run } = await createAgentRun(db, { ...runInput(quotes.tenant.id, binding), now: t0 });
      await markAgentRunStarted(db, quotes.tenant.id, run.publicId, {
        providerThreadId: "thread_1",
        actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
        pollIntervalMs: POLL.pollIntervalMs,
        now: t0,
      });
      const pollAt = new Date(t0.getTime() + 6_000);

      const claims = await Promise.all(
        ["tab-1", "tab-2", "replica-3"].map((owner) =>
          claimAgentRunPoll(db, quotes.tenant.id, run.publicId, {
            owner,
            leaseMs: POLL.leaseMs,
            queuedStaleMs: POLL.queuedStaleMs,
            now: pollAt,
          }),
        ),
      );

      expect(claims.filter((claim) => claim.claimed)).toHaveLength(1);
    });

    it("stops at awaiting_approval and never polls or resolves it", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const provider = new FakeAgentProvider().script({ state: "awaiting_approval" });
      const t0 = new Date("2026-09-30T08:00:00.000Z");
      const { run } = await createAgentRun(db, { ...runInput(quotes.tenant.id, binding), now: t0 });
      await markAgentRunStarted(db, quotes.tenant.id, run.publicId, {
        providerThreadId: "thread_1",
        actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
        pollIntervalMs: POLL.pollIntervalMs,
        now: t0,
      });

      const blocked = await pollAgentRunOnce(db, quotes.tenant.id, run.publicId, {
        provider,
        owner: "replica-a",
        ...POLL,
        interpretCompletion: acceptAll,
        now: () => new Date(t0.getTime() + 6_000),
      });
      expect(blocked.run.status).toBe("awaiting_approval");

      const later = await pollAgentRunOnce(db, quotes.tenant.id, run.publicId, {
        provider,
        owner: "replica-a",
        ...POLL,
        interpretCompletion: acceptAll,
        now: () => new Date(t0.getTime() + 60_000),
      });
      expect(later.polled).toBe(false);
      expect(provider.getRunCalls).toHaveLength(1);
      expect("resolveApproval" in provider).toBe(false);

      const audit = await auditActions(quotes.tenant.id, run.publicId);
      expect(audit.map((event) => event.action)).toEqual([
        "agent_run.requested",
        "agent_run.started",
        "agent_run.awaiting_approval",
      ]);
      expect(audit[2]!.changeSummary).toMatchObject({ status: "awaiting_approval" });

      await expect(
        withTenantContext(db, quotes.tenant.id, (tx) =>
          tx
            .update(agentRuns)
            .set({ status: "running" })
            .where(eq(agentRuns.publicId, run.publicId)),
        ),
      ).rejects.toThrow();

      const next = await createAgentRun(db, runInput(quotes.tenant.id, binding));
      expect(next.created).toBe(true);
    });

    it("fails invalid agent output and keeps only a bounded raw excerpt", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const huge = "x".repeat(RAW_RESULT_EXCERPT_MAX_CHARS * 2);
      const provider = new FakeAgentProvider().script({ state: "completed", finalMessage: huge });
      const t0 = new Date("2026-09-30T08:00:00.000Z");
      const { run } = await createAgentRun(db, { ...runInput(quotes.tenant.id, binding), now: t0 });
      await markAgentRunStarted(db, quotes.tenant.id, run.publicId, {
        providerThreadId: "thread_1",
        actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
        pollIntervalMs: POLL.pollIntervalMs,
        now: t0,
      });

      const failed = await pollAgentRunOnce(db, quotes.tenant.id, run.publicId, {
        provider,
        owner: "replica-a",
        ...POLL,
        interpretCompletion: (finalMessage) => ({
          ok: false,
          code: "invalid_agent_output",
          message: "The agent response did not match the expected format.",
          rawResultExcerpt: finalMessage,
        }),
        now: () => new Date(t0.getTime() + 6_000),
      });

      expect(failed.run.status).toBe("failed");
      expect(failed.run.failureCode).toBe("invalid_agent_output");
      expect(failed.run.result).toBeNull();
      const [row] = await withTenantContext(db, quotes.tenant.id, (tx) =>
        tx.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId)),
      );
      expect(row!.rawResultExcerpt).toHaveLength(RAW_RESULT_EXCERPT_MAX_CHARS);
      expect(boundRawResultExcerpt(null)).toBeNull();
    });

    it("keeps the accepted run and its thread, and flags re-auth, when a poll is rejected", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const provider = new FakeAgentProvider().script(
        new AgentProviderError("unauthorized", "401 from provider", { requiresReauth: true }),
      );
      const reauthCodes: string[] = [];
      const t0 = new Date("2026-09-30T08:00:00.000Z");
      const { run } = await createAgentRun(db, { ...runInput(quotes.tenant.id, binding), now: t0 });
      await markAgentRunStarted(db, quotes.tenant.id, run.publicId, {
        providerThreadId: "thread_1",
        actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
        pollIntervalMs: POLL.pollIntervalMs,
        now: t0,
      });

      const result = await pollAgentRunOnce(db, quotes.tenant.id, run.publicId, {
        provider,
        owner: "replica-a",
        ...POLL,
        interpretCompletion: acceptAll,
        onReauthRequired: async (error) => {
          reauthCodes.push(error.code);
        },
        now: () => new Date(t0.getTime() + 6_000),
      });

      expect(result).toMatchObject({
        reauthRequired: true,
        run: { status: "running", failureCode: null, providerThreadId: "thread_1", deadlineAt: run.deadlineAt },
      });
      expect(reauthCodes).toEqual(["unauthorized"]);
      const audit = await auditActions(quotes.tenant.id, run.publicId);
      expect(audit.map((event) => event.action)).toEqual(["agent_run.requested", "agent_run.started"]);
    });

    it("keeps polling after a transient provider error", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const provider = new FakeAgentProvider().script(
        new AgentProviderError("network", "socket hang up"),
      );
      const t0 = new Date("2026-09-30T08:00:00.000Z");
      const { run } = await createAgentRun(db, { ...runInput(quotes.tenant.id, binding), now: t0 });
      await markAgentRunStarted(db, quotes.tenant.id, run.publicId, {
        providerThreadId: "thread_1",
        actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
        pollIntervalMs: POLL.pollIntervalMs,
        now: t0,
      });

      const result = await pollAgentRunOnce(db, quotes.tenant.id, run.publicId, {
        provider,
        owner: "replica-a",
        ...POLL,
        interpretCompletion: acceptAll,
        now: () => new Date(t0.getTime() + 6_000),
      });

      expect(result.run.status).toBe("running");
      expect(result.run.nextPollAt).toBe(new Date(t0.getTime() + 11_000).toISOString());
    });

    it("fails runs past the hard deadline and stale queued runs", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const t0 = new Date("2026-09-30T08:00:00.000Z");

      const { run: running } = await createAgentRun(db, {
        ...runInput(quotes.tenant.id, binding, {
          subject: { type: "menu", publicId: "men_a", version: 1 },
        }),
        now: t0,
      });
      await markAgentRunStarted(db, quotes.tenant.id, running.publicId, {
        providerThreadId: "thread_1",
        actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
        pollIntervalMs: POLL.pollIntervalMs,
        now: t0,
      });
      const timedOut = await claimAgentRunPoll(db, quotes.tenant.id, running.publicId, {
        owner: "replica-a",
        leaseMs: POLL.leaseMs,
        queuedStaleMs: POLL.queuedStaleMs,
        now: new Date(t0.getTime() + TIMEOUT_MS),
      });
      expect(timedOut).toMatchObject({
        claimed: false,
        run: { status: "failed", failureCode: QOS_WAIT_DEADLINE_CODE, remoteOutcomeUnknown: true, providerThreadId: "thread_1" },
      });

      const { run: queued } = await createAgentRun(db, {
        ...runInput(quotes.tenant.id, binding, {
          subject: { type: "menu", publicId: "men_b", version: 1 },
        }),
        now: t0,
      });
      const stale = await claimAgentRunPoll(db, quotes.tenant.id, queued.publicId, {
        owner: "replica-a",
        leaseMs: POLL.leaseMs,
        queuedStaleMs: POLL.queuedStaleMs,
        now: new Date(t0.getTime() + POLL.queuedStaleMs),
      });
      expect(stale.run).toMatchObject({ status: "failed", failureCode: "start_not_recorded" });

      const latest = await getLatestAgentRunForSubject(db, quotes.tenant.id, {
        capability: "menu_manager",
        subjectType: "menu",
        subjectPublicId: "men_b",
      });
      expect(latest?.publicId).toBe(queued.publicId);

      const audit = await auditActions(quotes.tenant.id, running.publicId);
      expect(audit.at(-1)).toMatchObject({
        action: "agent_run.wait_expired",
        changeSummary: { failureCode: QOS_WAIT_DEADLINE_CODE, remoteOutcome: "unknown" },
      });
      expect(audit.map((event) => event.action)).not.toContain("agent_run.failed");
    });

    it("lets an in-flight poll lease finish before the deadline ends the run", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const t0 = new Date("2026-09-30T08:00:00.000Z");
      const { run } = await createAgentRun(db, { ...runInput(quotes.tenant.id, binding), now: t0 });
      await markAgentRunStarted(db, quotes.tenant.id, run.publicId, {
        providerThreadId: "thread_1",
        actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
        pollIntervalMs: POLL.pollIntervalMs,
        now: t0,
      });
      const leaseTakenAt = new Date(t0.getTime() + TIMEOUT_MS - 1_000);
      const claim = await claimAgentRunPoll(db, quotes.tenant.id, run.publicId, {
        owner: "replica-a",
        leaseMs: POLL.leaseMs,
        queuedStaleMs: POLL.queuedStaleMs,
        now: leaseTakenAt,
      });
      expect(claim.claimed).toBe(true);

      const pastDeadline = new Date(t0.getTime() + TIMEOUT_MS + 1_000);
      await expect(
        expireAgentRunIfDue(db, quotes.tenant.id, run.publicId, { queuedStaleMs: POLL.queuedStaleMs, now: pastDeadline }),
      ).resolves.toMatchObject({ status: "running" });

      const recorded = await recordAgentRunOutcome(db, quotes.tenant.id, run.publicId, {
        owner: "replica-a",
        outcome: { state: "completed", result: { summary: "done" } },
        pollIntervalMs: POLL.pollIntervalMs,
        now: pastDeadline,
      });
      expect(recorded).toMatchObject({ recorded: true, run: { status: "completed", result: { summary: "done" } } });

      await expect(
        expireAgentRunIfDue(db, quotes.tenant.id, run.publicId, {
          queuedStaleMs: POLL.queuedStaleMs,
          now: new Date(pastDeadline.getTime() + TIMEOUT_MS),
        }),
      ).resolves.toMatchObject({ status: "completed", result: { summary: "done" }, providerThreadId: "thread_1" });
    });

    it("ends an expired run once when callers race, with one terminal audit event", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const t0 = new Date("2026-09-30T08:00:00.000Z");
      const { run } = await createAgentRun(db, { ...runInput(quotes.tenant.id, binding), now: t0 });
      await markAgentRunStarted(db, quotes.tenant.id, run.publicId, {
        providerThreadId: "thread_1",
        actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
        pollIntervalMs: POLL.pollIntervalMs,
        now: t0,
      });
      const pastDeadline = new Date(t0.getTime() + TIMEOUT_MS);

      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          expireAgentRunIfDue(db, quotes.tenant.id, run.publicId, {
            queuedStaleMs: POLL.queuedStaleMs,
            now: pastDeadline,
          }),
        ),
      );

      expect(new Set(results.map((result) => result.status))).toEqual(new Set(["failed"]));
      const audit = await auditActions(quotes.tenant.id, run.publicId);
      expect(audit.filter((event) => event.action === "agent_run.wait_expired")).toHaveLength(1);
      const row = await getAgentRun(db, quotes.tenant.id, run.publicId);
      expect(row).toMatchObject({
        failureCode: QOS_WAIT_DEADLINE_CODE,
        deadlineAt: run.deadlineAt,
        finishedAt: pastDeadline.toISOString(),
      });
    });

    it("requires acknowledging an unresolved previous run before admitting a new key", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const t0 = new Date("2026-09-30T08:00:00.000Z");
      const first = await createAgentRun(db, { ...runInput(quotes.tenant.id, binding), now: t0 });
      await markAgentRunStarted(db, quotes.tenant.id, first.run.publicId, {
        providerThreadId: "thread_1",
        actor: { subject: "admin.quotes@test", actorClass: "staff_administrator" },
        pollIntervalMs: POLL.pollIntervalMs,
        now: t0,
      });
      await expireAgentRunIfDue(db, quotes.tenant.id, first.run.publicId, {
        queuedStaleMs: POLL.queuedStaleMs,
        now: new Date(t0.getTime() + TIMEOUT_MS),
      });

      const blocked = await createAgentRun(db, runInput(quotes.tenant.id, binding)).catch((error: unknown) => error);
      expect(blocked).toBeInstanceOf(AgentRunError);
      expect(blocked).toMatchObject({
        code: "unresolved_previous_run",
        statusCode: 409,
        unresolvedRunPublicId: first.run.publicId,
      });
      await expect(
        createAgentRun(db, runInput(quotes.tenant.id, binding, { acknowledgedUnresolvedRunPublicId: "run_other" })),
      ).rejects.toMatchObject({ code: "unresolved_previous_run" });

      // Replaying the original key still returns the original run.
      const replay = await withTenantContext(db, quotes.tenant.id, (tx) =>
        tx.select({ key: agentRuns.idempotencyKey }).from(agentRuns).where(eq(agentRuns.publicId, first.run.publicId)),
      );
      await expect(
        createAgentRun(db, runInput(quotes.tenant.id, binding, { idempotencyKey: replay[0]!.key })),
      ).resolves.toMatchObject({ created: false, run: { publicId: first.run.publicId } });

      const second = await createAgentRun(
        db,
        runInput(quotes.tenant.id, binding, { acknowledgedUnresolvedRunPublicId: first.run.publicId }),
      );
      expect(second.created).toBe(true);
      const audit = await auditActions(quotes.tenant.id, second.run.publicId);
      expect(audit[0]).toMatchObject({
        action: "agent_run.requested",
        changeSummary: { acknowledgedUnresolvedRunPublicId: first.run.publicId },
      });
    });

    it("admits a new key without acknowledgement after a resolved failure", async () => {
      const { quotes, binding } = await seedTenantWithBinding();
      const first = await createAgentRun(db, runInput(quotes.tenant.id, binding));
      await markAgentRunFailed(db, quotes.tenant.id, first.run.publicId, {
        code: "provider_not_connected",
        message: "Not connected.",
      });

      await expect(createAgentRun(db, runInput(quotes.tenant.id, binding))).resolves.toMatchObject({ created: true });
    });

    it("rejects invalid idempotency keys", async () => {
      const { quotes, binding } = await seedTenantWithBinding();

      await expect(
        createAgentRun(db, runInput(quotes.tenant.id, binding, { idempotencyKey: "short" })),
      ).rejects.toBeInstanceOf(AgentRunError);
    });
  });

  it("opens credential access only for the transaction that asks for it", async () => {
    await runAsRole(sqlClient, "qos_app", async () => {
      const inside = await withAgentCredentialAccess(db, (tx) =>
        tx.execute(sql`select current_setting('qos.agent_credential_access', true) as v`),
      );
      const outside = await db.execute(
        sql`select coalesce(current_setting('qos.agent_credential_access', true), '') as v`,
      );
      expect((inside as unknown as Array<{ v: string }>)[0]!.v).toBe("true");
      expect((outside as unknown as Array<{ v: string }>)[0]!.v).toBe("");
    });
  });
});
