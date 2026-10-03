import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentRuns, aiJobAttempts, aiJobs, staffIdentities, staffLocationScopes, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { createMenuManagerJobHandler } from "@/lib/agents/menu-manager/menu-manager-job";
import {
  askMenuManager,
  getLatestMenuManagerRun,
  refreshMenuManagerRun,
} from "@/lib/agents/menu-manager/menu-manager-service";
import { saveAgentProviderConnection } from "@/lib/agents/provider-connections";
import { approveTenantAgentBinding, setTenantAgentBindingEnabled } from "@/lib/agents/tenant-agent-bindings";
import { FakeAgentProvider } from "@/lib/agents/testing/fake-agent-provider";
import { AgentProviderError } from "@/lib/agents/types";
import {
  claimNextAiJob,
  finishAiJobStep,
  markAiJobDispatched,
  type ClaimedAiJob,
} from "@/lib/ai/jobs/ai-job-queue";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const BASE = { AGENTS_ENABLED: "true", AGENT_MENU_MANAGER_ENABLED: "true" };
const QUEUED = readAgentConfig({ ...BASE, AGENT_MENU_MANAGER_EXECUTION_MODE: "queued_worker" });
const INLINE = readAgentConfig(BASE);
const AGENT_ID = "cmun4w730017807adjrkbep1t";
const REQUESTER = "admin.quotes@test";
const LIMITS = { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 };

function validReply(menuPublicId: string) {
  return JSON.stringify({
    schema: "qos.menu_manager_result.v1",
    menuPublicId,
    summary: "Looks fine.",
    findings: [],
    suggestions: [],
  });
}

/**
 * PR 4: queued_worker Menu Manager runs. The API only admits (run + job in
 * one transaction) and never contacts the provider; the worker, as its own
 * restricted role, starts and polls with the same live checks as the inline
 * path, records dispatch before contacting the provider, and routes uncertain
 * starts to operator review instead of resubmitting. Inline runs are untouched.
 */
integrationDescribe("Menu Manager on the AI worker", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
    await grantRoleMembership(sqlClient, "qos", "qos_ai_worker");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.ai_job_attempts, qos.ai_jobs, qos.agent_run_inputs, qos.agent_runs, qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: REQUESTER, email: REQUESTER }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership!.id, locationId: quotes.location.id });
    const actor = { membershipId: membership!.id, role: "administrator" as const, staffIdentityId: identity!.id };
    const product = await createDraftProduct(db, tenantId, actor, {
      internalName: "latte",
      translations: { en: { displayName: "Latte", description: "d" }, ar: { displayName: "l", description: "w" } },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const menu = await createDraftMenu(db, tenantId, actor, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "f" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "q" } },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });
    const binding = await approveTenantAgentBinding(db, {
      tenantId,
      capability: "menu_manager",
      provider: "hyperagent",
      providerAgentId: AGENT_ID,
      approvedBySubject: "operator:platform",
    });
    await setTenantAgentBindingEnabled(db, tenantId, REQUESTER, "menu_manager", {
      enabled: true,
      expectedVersion: binding.version,
    });
    await saveAgentProviderConnection(db, {
      provider: "hyperagent",
      serverUrl: "https://hyperagent.example/api/mcp",
      connectedBySubject: "operator:test",
      credentialKey: parseAgentCredentialKey(randomBytes(32).toString("base64")),
      credentials: { tokens: { access_token: "never-read" } },
    });
    const caller = {
      tenantId,
      subject: REQUESTER,
      membership: await runAsRole(sqlClient, "qos_app", () => requireActiveStaffMembership(db, tenantId, REQUESTER)),
    };
    return { tenantId, menu, caller };
  }

  function ask(caller: Awaited<ReturnType<typeof seed>>["caller"], menuPublicId: string, provider: FakeAgentProvider, config: AgentConfig = QUEUED) {
    return runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(db, caller, { menuPublicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` }, { config, provider }),
    );
  }

  /** One worker step, exactly as scripts/ai-worker.ts wires it, as the worker role. */
  async function workerStep(provider: FakeAgentProvider, options: { now?: () => Date; crashAfterDispatch?: boolean } = {}) {
    const handler = createMenuManagerJobHandler(db, { config: QUEUED, provider, now: options.now });
    return runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, { workerId: "worker-test", jobKinds: ["menu_manager.run"], limits: LIMITS });
      if (!job) {
        return null;
      }
      const result = await handler.step(job, {
        markDispatched: () => markAiJobDispatched(db, job),
        leaseLost: () => false,
      });
      await finishAiJobStep(db, job, result);
      return { job, result };
    });
  }

  async function makeJobsDue() {
    await sqlClient`UPDATE qos.ai_jobs SET next_attempt_at = now() WHERE status = 'queued'`;
  }

  async function expireLeases() {
    await sqlClient`UPDATE qos.ai_jobs SET lease_expires_at = now() - interval '1 second' WHERE status = 'leased'`;
  }

  it("admits atomically without contacting the provider, then starts and completes on the worker", async () => {
    const { tenantId, menu, caller } = await seed();
    const provider = new FakeAgentProvider().script({ state: "completed", finalMessage: validReply(menu.publicId) });

    const { run } = await ask(caller, menu.publicId, provider);
    expect(run.status).toBe("queued");
    expect(provider.startCalls).toHaveLength(0);
    const [job] = await db.select().from(aiJobs);
    const [runRow] = await db.select().from(agentRuns);
    expect(runRow).toMatchObject({ executionMode: "queued_worker", status: "queued" });
    expect(job).toMatchObject({ tenantId, agentRunId: runRow!.id, status: "queued", attemptCount: 0 });

    // Reads never poll or start a queued_worker run.
    await runAsRole(sqlClient, "qos_app", () =>
      refreshMenuManagerRun(db, caller, { menuPublicId: menu.publicId, runPublicId: run.publicId }, { config: QUEUED, provider }),
    );
    expect(provider.startCalls).toHaveLength(0);

    const first = await workerStep(provider);
    expect(first!.result).toEqual({ type: "reschedule", delayMs: QUEUED.pollIntervalMs });
    expect(provider.startCalls).toEqual([
      expect.objectContaining({ providerAgentId: AGENT_ID, idempotencyKey: run.publicId }),
    ]);
    const [attempt] = await db.select().from(aiJobAttempts);
    expect(attempt).toMatchObject({ attemptNumber: 1, outcome: "rescheduled", workerId: "worker-test" });
    expect(attempt!.dispatchedAt).toBeInstanceOf(Date);
    const [started] = await db.select().from(agentRuns);
    expect(started).toMatchObject({ status: "running", providerThreadId: "thread_fake_1" });

    // A user refresh still does not poll; the worker does.
    await runAsRole(sqlClient, "qos_app", () =>
      refreshMenuManagerRun(db, caller, { menuPublicId: menu.publicId, runPublicId: run.publicId }, { config: QUEUED, provider }),
    );
    expect(provider.getRunCalls).toHaveLength(0);

    await makeJobsDue();
    const pollDue = () => new Date(Date.now() + QUEUED.pollIntervalMs + 1);
    const second = await workerStep(provider, { now: pollDue });
    expect(second!.result).toEqual({ type: "completed" });
    expect(provider.getRunCalls).toEqual(["thread_fake_1"]);
    expect(provider.startCalls).toHaveLength(1);

    const [done] = await db.select().from(agentRuns);
    expect(done).toMatchObject({ status: "completed", result: expect.objectContaining({ summary: "Looks fine." }) });
    const [finished] = await db.select().from(aiJobs);
    expect(finished).toMatchObject({ status: "completed", attemptCount: 2, leaseToken: null });
    expect(await workerStep(provider)).toBeNull();
  });

  it("leaves inline admission unchanged: no job, provider started in the request", async () => {
    const { menu, caller } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await ask(caller, menu.publicId, provider, INLINE);
    expect(run.status).toBe("running");
    expect(provider.startCalls).toHaveLength(1);
    expect(await db.select().from(aiJobs)).toEqual([]);
    const [row] = await db.select().from(agentRuns);
    expect(row!.executionMode).toBe("inline");
  });

  it("never lets the worker execute an inline run", async () => {
    const { tenantId, menu, caller } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await ask(caller, menu.publicId, provider, INLINE);
    const [row] = await db.select().from(agentRuns);
    await sqlClient`INSERT INTO qos.ai_jobs (tenant_id, public_id, job_kind, agent_run_id) VALUES (${tenantId}, 'job_forged', 'menu_manager.run', ${row!.id})`;

    const step = await workerStep(provider);
    expect(step!.result).toMatchObject({ type: "failed", code: "execution_mode_mismatch" });
    expect(provider.startCalls).toHaveLength(1);
    const [after] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    expect(after!.status).toBe("running");
  });

  it("fails a stale run as never sent when no worker claimed it", async () => {
    const { menu, caller } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await ask(caller, menu.publicId, provider);
    const later = () => new Date(Date.now() + QUEUED.queuedStaleMs + 1_000);

    const view = await runAsRole(sqlClient, "qos_app", () =>
      getLatestMenuManagerRun(db, caller, menu.publicId, { config: QUEUED, now: later }),
    );
    expect(view).toMatchObject({
      publicId: run.publicId,
      status: "failed",
      failureCode: "not_started_in_time",
      remoteOutcomeUnknown: false,
    });
    const [job] = await db.select().from(aiJobs);
    expect(job).toMatchObject({ status: "cancelled", lastErrorCode: "not_started_in_time" });
    expect(await workerStep(provider)).toBeNull();
    expect(provider.startCalls).toHaveLength(0);
  });

  it("does not cancel a stale run a worker has already claimed; the worker ends it as never sent", async () => {
    const { menu, caller } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await ask(caller, menu.publicId, provider);
    // A worker claimed it but the step was rescheduled (executor briefly not ready).
    await sqlClient`UPDATE qos.agent_provider_connections SET status = 'needs_reauth'`;
    const waited = await workerStep(provider);
    expect(waited!.result).toMatchObject({ type: "reschedule", code: "executor_not_ready" });
    await sqlClient`UPDATE qos.agent_provider_connections SET status = 'connected'`;

    const later = () => new Date(Date.now() + QUEUED.queuedStaleMs + 1_000);
    const view = await runAsRole(sqlClient, "qos_app", () =>
      refreshMenuManagerRun(db, caller, { menuPublicId: menu.publicId, runPublicId: run.publicId }, { config: QUEUED, provider, now: later }),
    );
    expect(view.status).toBe("queued");

    await makeJobsDue();
    const ended = await workerStep(provider, { now: later });
    expect(ended!.result).toMatchObject({ type: "failed", code: "not_started_in_time", providerOutcome: "not_dispatched" });
    expect(provider.startCalls).toHaveLength(0);
  });

  it("routes a start that crashed after dispatch to operator review instead of resubmitting", async () => {
    const { menu, caller } = await seed();
    const provider = new FakeAgentProvider().failStartWith(new Error("socket hang up after write"));
    const { run } = await ask(caller, menu.publicId, provider);

    // The step throws after dispatch was recorded; the worker loop would not finish it.
    const handler = createMenuManagerJobHandler(db, { config: QUEUED, provider });
    await runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = (await claimNextAiJob(db, { workerId: "worker-a", jobKinds: ["menu_manager.run"], limits: LIMITS })) as ClaimedAiJob;
      await expect(
        handler.step(job, { markDispatched: () => markAiJobDispatched(db, job), leaseLost: () => false }),
      ).rejects.toThrow(/socket hang up/);
    });
    await expireLeases();

    provider.failStartWith(null);
    const recovered = await workerStep(provider);
    expect(recovered!.job.uncertainPriorDispatch).toBe(true);
    expect(recovered!.result).toMatchObject({ type: "operator_review", code: "start_outcome_unknown" });
    expect(provider.startCalls).toHaveLength(1);

    const [row] = await db.select().from(agentRuns);
    expect(row).toMatchObject({ status: "failed", failureCode: "start_outcome_unknown" });
    const [job] = await db.select().from(aiJobs);
    expect(job!.status).toBe("operator_review");
    const attempts = await db.select().from(aiJobAttempts).orderBy(aiJobAttempts.attemptNumber);
    expect(attempts.map((a) => a.outcome)).toEqual(["lease_expired", "operator_review"]);

    const view = await runAsRole(sqlClient, "qos_app", () =>
      refreshMenuManagerRun(db, caller, { menuPublicId: menu.publicId, runPublicId: run.publicId }, { config: QUEUED, provider }),
    );
    expect(view.remoteOutcomeUnknown).toBe(true);
  });

  it("retries a start whose previous attempt crashed before dispatch", async () => {
    const { menu, caller } = await seed();
    const provider = new FakeAgentProvider();
    await ask(caller, menu.publicId, provider);
    await runAsRole(sqlClient, "qos_ai_worker", () =>
      claimNextAiJob(db, { workerId: "worker-a", jobKinds: ["menu_manager.run"], limits: LIMITS }),
    );
    await expireLeases();

    const step = await workerStep(provider);
    expect(step!.job).toMatchObject({ attemptNumber: 2, uncertainPriorDispatch: false });
    expect(step!.result.type).toBe("reschedule");
    expect(provider.startCalls).toHaveLength(1);
  });

  it("routes an unknown start submission to operator review", async () => {
    const { menu, caller } = await seed();
    const unknown = new FakeAgentProvider().failStartWith(
      new AgentProviderError("provider_timeout", "timed out", { outcome: "submission_unknown" }),
    );
    await ask(caller, menu.publicId, unknown);
    expect((await workerStep(unknown))!.result).toMatchObject({
      type: "operator_review",
      code: "start_outcome_unknown",
      providerOutcome: "submission_unknown",
    });
  });

  it("stops before dispatch when the requester lost access after admission", async () => {
    const { menu, caller } = await seed();
    const provider = new FakeAgentProvider();
    await ask(caller, menu.publicId, provider);
    await sqlClient`UPDATE qos.staff_memberships SET status = 'revoked'`;

    const step = await workerStep(provider);
    expect(step!.result).toMatchObject({ type: "failed", code: "requester_access_revoked", providerOutcome: "not_dispatched" });
    expect(provider.startCalls).toHaveLength(0);
    const [attempt] = await db.select().from(aiJobAttempts);
    expect(attempt!.dispatchedAt).toBeNull();
  });
});
