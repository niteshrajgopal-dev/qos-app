import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentRuns, aiJobAttempts, aiJobs, aiSpendReservations, staffIdentities, staffLocationScopes, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { AgentRunError } from "@/lib/agents/agent-runs";
import { readAgentConfig, type AgentConfig } from "@/lib/agents/config";
import { createMenuManagerJobHandler } from "@/lib/agents/menu-manager/menu-manager-job";
import { askMenuManager } from "@/lib/agents/menu-manager/menu-manager-service";
import {
  approveTenantAgentBinding,
  setTenantAgentBindingEnabled,
} from "@/lib/agents/tenant-agent-bindings";
import { FakeQosModel } from "@/lib/ai/model/fake-qos-model";
import {
  claimNextAiJob,
  finishAiJobStep,
  markAiJobDispatched,
  type ClaimedAiJob,
} from "@/lib/ai/jobs/ai-job-queue";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const BASE = { AGENTS_ENABLED: "true", AGENT_MENU_MANAGER_ENABLED: "true" };
const NATIVE_ENV = {
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  NODE_ENV: "test",
};
const DEFAULT_SWITCH = readAgentConfig(BASE);
const NATIVE = readAgentConfig({
  ...BASE,
  AGENT_MENU_MANAGER_EXECUTION_MODE: "queued_worker",
  AGENT_MENU_MANAGER_EXECUTOR: "native",
});
const HYPERAGENT = readAgentConfig({
  ...BASE,
  AGENT_MENU_MANAGER_EXECUTOR: "hyperagent",
  AGENT_MENU_MANAGER_EXECUTION_MODE: "queued_worker",
});
const INLINE_NATIVE = readAgentConfig({
  ...BASE,
  AGENT_MENU_MANAGER_EXECUTOR: "native",
  AGENT_MENU_MANAGER_EXECUTION_MODE: "inline",
});
const REQUESTER = "admin.quotes@test";
const LIMITS = { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 };

function spendPolicy() {
  return readAiSpendPolicy({
    AI_SPEND_PLATFORM_CONCURRENCY: "10",
    AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
    AI_SPEND_MENU_MANAGER_NATIVE_ENABLED: "true",
    AI_SPEND_MENU_MANAGER_NATIVE_MAX_UNITS_PER_RUN: "1",
    AI_SPEND_MENU_MANAGER_NATIVE_TENANT_DAILY_UNITS: "10",
    AI_SPEND_MENU_MANAGER_NATIVE_TENANT_MONTHLY_UNITS: "100",
    AI_SPEND_MENU_MANAGER_NATIVE_TENANT_CONCURRENCY: "10",
    AI_SPEND_MENU_MANAGER_NATIVE_PLATFORM_DAILY_UNITS: "20",
    AI_SPEND_MENU_MANAGER_NATIVE_PLATFORM_MONTHLY_UNITS: "100",
    AI_SPEND_MENU_MANAGER_NATIVE_UNSTARTED_EXPIRY_MS: "600000",
  });
}

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
 * PR 7/8: native Menu Manager. Admission does not use a Hyperagent binding or
 * connection; the worker runs a QOS-owned loop against an injected model and
 * settles menu_manager.native spend. Unset executor is native; Hyperagent is
 * opt-in and never an automatic fallback.
 */
integrationDescribe("native Menu Manager", () => {
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
    await sqlClient`TRUNCATE TABLE qos.ai_job_attempts, qos.ai_jobs, qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.agent_run_inputs, qos.agent_runs, qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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
    const caller = {
      tenantId,
      subject: REQUESTER,
      membership: await runAsRole(sqlClient, "qos_app", () => requireActiveStaffMembership(db, tenantId, REQUESTER)),
    };
    return { tenantId, menu, product, caller };
  }

  function ask(
    caller: Awaited<ReturnType<typeof seed>>["caller"],
    menuPublicId: string,
    options: { config?: AgentConfig; env?: NodeJS.ProcessEnv } = {},
  ) {
    return runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(
        db,
        caller,
        { menuPublicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
        {
          config: options.config ?? NATIVE,
          spendPolicy: spendPolicy(),
          env: options.env ?? NATIVE_ENV,
        },
      ),
    );
  }

  async function workerStep(model: FakeQosModel, config: AgentConfig = NATIVE) {
    const handler = createMenuManagerJobHandler(db, { config, model });
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

  async function expireLeases() {
    await sqlClient`UPDATE qos.ai_jobs SET lease_expires_at = now() - interval '1 second' WHERE status = 'leased'`;
  }

  it("admits without a Hyperagent binding, then completes on the worker and consumes spend", async () => {
    const { tenantId, menu, caller } = await seed();
    const model = new FakeQosModel().script({ type: "completed", text: validReply(menu.publicId), usage: null });

    const connections = await sqlClient`SELECT id FROM qos.agent_provider_connections`;
    const bindings = await sqlClient`SELECT id FROM qos.tenant_agent_bindings`;
    expect(connections).toEqual([]);
    expect(bindings).toEqual([]);

    const { run, created } = await ask(caller, menu.publicId);
    expect(created).toBe(true);
    expect(run.status).toBe("queued");

    const [runRow] = await db.select().from(agentRuns);
    expect(runRow).toMatchObject({
      tenantId,
      bindingId: null,
      capability: "menu_manager",
      provider: "agents_sdk",
      providerAgentId: "qos.menu_manager",
      definitionVersion: "menu_manager.v2",
      executionMode: "queued_worker",
      status: "queued",
    });
    expect(runRow!.executionIdentity).toMatchObject({
      executorKind: "native",
      executorAdapter: "agents_sdk",
      adapterVersion: "agents-sdk.v1",
      modelProvider: "mock",
      modelId: "fake-model",
    });
    const [reservation] = await db.select().from(aiSpendReservations);
    expect(reservation).toMatchObject({
      path: "menu_manager.native",
      provider: "openai",
      subjectType: "agent_run",
      subjectPublicId: run.publicId,
      state: "reserved",
      units: 1,
    });
    expect(model.requests).toHaveLength(0);

    const step = await workerStep(model);
    expect(step!.result).toEqual({ type: "completed" });
    expect(model.requests).toHaveLength(1);
    expect(model.requests[0]!.instructions).toBe("menu_manager.v2");
    expect(model.requests[0]!.tools.map((tool) => tool.name)).toEqual(["menu.get_health", "menu.get_items"]);

    const [done] = await db.select().from(agentRuns);
    expect(done).toMatchObject({
      status: "completed",
      providerThreadId: `native:${run.publicId}`,
      result: expect.objectContaining({ schema: "qos.menu_manager_result.v1", summary: "Looks fine." }),
    });
    const [spent] = await db.select().from(aiSpendReservations);
    expect(spent).toMatchObject({ state: "consumed", outcome: "completed" });
    const [job] = await db.select().from(aiJobs);
    expect(job).toMatchObject({ status: "completed", attemptCount: 1 });
  });

  it("lets the native loop call a read-only menu tool before completing", async () => {
    const { menu, product, caller } = await seed();
    const model = new FakeQosModel().script(
      {
        type: "tool_calls",
        calls: [{ callId: "call_1", name: "menu.get_items", input: { productPublicIds: [product.publicId] } }],
        usage: null,
      },
      { type: "completed", text: validReply(menu.publicId), usage: null },
    );

    await ask(caller, menu.publicId);
    const step = await workerStep(model);
    expect(step!.result).toEqual({ type: "completed" });
    expect(model.requests).toHaveLength(2);
    expect(model.requests[1]!.toolResults).toEqual([
      expect.objectContaining({
        callId: "call_1",
        output: expect.objectContaining({
          menuPublicId: menu.publicId,
          products: [expect.objectContaining({ productPublicId: product.publicId })],
        }),
      }),
    ]);
  });

  it("routes a crash after dispatch to operator review and does not call the model again", async () => {
    const { menu, caller } = await seed();
    const model = new FakeQosModel().script({ type: "completed", text: validReply(menu.publicId), usage: null });
    const { run } = await ask(caller, menu.publicId);

    const handler = createMenuManagerJobHandler(db, { config: NATIVE, model });
    await runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = (await claimNextAiJob(db, {
        workerId: "worker-a",
        jobKinds: ["menu_manager.run"],
        limits: LIMITS,
      })) as ClaimedAiJob;
      await expect(
        handler.step(job, {
          markDispatched: async () => {
            await markAiJobDispatched(db, job);
            throw new Error("socket hang up after write");
          },
          leaseLost: () => false,
        }),
      ).rejects.toThrow(/socket hang up/);
    });
    await expireLeases();

    const recovered = await workerStep(model);
    expect(recovered!.job.uncertainPriorDispatch).toBe(true);
    expect(recovered!.result).toMatchObject({
      type: "operator_review",
      code: "start_outcome_unknown",
      providerOutcome: "submission_unknown",
    });
    expect(model.requests).toHaveLength(0);

    const [row] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    expect(row).toMatchObject({ status: "failed", failureCode: "start_outcome_unknown" });
    const [spent] = await db.select().from(aiSpendReservations);
    expect(spent).toMatchObject({ state: "uncertain", outcome: "submission_unknown" });
    const attempts = await db.select().from(aiJobAttempts).orderBy(aiJobAttempts.attemptNumber);
    expect(attempts.map((attempt) => attempt.outcome)).toEqual(["lease_expired", "operator_review"]);
  });

  it("admits through native when the executor flag is unset", async () => {
    const { menu, caller } = await seed();
    expect(DEFAULT_SWITCH).toMatchObject({
      menuManagerExecutor: "native",
      menuManagerExecutionMode: "queued_worker",
    });

    const { run, created } = await ask(caller, menu.publicId, { config: DEFAULT_SWITCH });
    expect(created).toBe(true);
    const [runRow] = await db.select().from(agentRuns);
    expect(runRow).toMatchObject({
      bindingId: null,
      provider: "agents_sdk",
      providerAgentId: "qos.menu_manager",
      definitionVersion: "menu_manager.v2",
      executionMode: "queued_worker",
      status: "queued",
    });
    expect(runRow!.executionIdentity).toMatchObject({
      executorKind: "native",
      executorAdapter: "agents_sdk",
    });
    expect(run.publicId).toBe(runRow!.publicId);
  });

  it("does not fall back to Hyperagent when the native default cannot admit", async () => {
    const { tenantId, menu, caller } = await seed();
    const approved = await approveTenantAgentBinding(db, {
      tenantId,
      capability: "menu_manager",
      provider: "hyperagent",
      providerAgentId: "cmun4w730017807adjrkbep1t",
      approvedBySubject: "operator:platform",
    });
    await setTenantAgentBindingEnabled(db, tenantId, REQUESTER, "menu_manager", {
      enabled: true,
      expectedVersion: approved.version,
    });

    await expect(
      ask(caller, menu.publicId, { config: DEFAULT_SWITCH, env: { NODE_ENV: "test" } }),
    ).rejects.toMatchObject({
      code: "provider_not_connected",
    });
    expect(await db.select().from(agentRuns)).toEqual([]);
    expect(await db.select().from(aiSpendReservations)).toEqual([]);
  });

  it("keeps a native run on the native worker after the process default becomes Hyperagent", async () => {
    const { menu, caller } = await seed();
    const model = new FakeQosModel().script({ type: "completed", text: validReply(menu.publicId), usage: null });
    const { run } = await ask(caller, menu.publicId);

    const step = await workerStep(model, HYPERAGENT);
    expect(step!.result).toEqual({ type: "completed" });
    expect(model.requests).toHaveLength(1);

    const [done] = await db.select().from(agentRuns);
    expect(done).toMatchObject({
      publicId: run.publicId,
      provider: "agents_sdk",
      status: "completed",
    });
    expect(done!.executionIdentity).toMatchObject({ executorKind: "native" });
  });

  it("keeps Hyperagent admission dependent on a tenant binding", async () => {
    const { menu, caller } = await seed();
    await expect(ask(caller, menu.publicId, { config: HYPERAGENT })).rejects.toMatchObject({
      code: "capability_not_configured",
    });
    expect(await db.select().from(agentRuns)).toEqual([]);
    expect(await db.select().from(aiSpendReservations)).toEqual([]);
  });

  it("refuses native admission unless the run is queued_worker and a model is configured", async () => {
    const { menu, caller } = await seed();
    await expect(ask(caller, menu.publicId, { config: INLINE_NATIVE })).rejects.toBeInstanceOf(AgentRunError);
    await expect(ask(caller, menu.publicId, { config: INLINE_NATIVE })).rejects.toMatchObject({
      code: "native_requires_queued_worker",
    });
    await expect(ask(caller, menu.publicId, { env: { NODE_ENV: "test" } })).rejects.toMatchObject({
      code: "provider_not_connected",
    });
    expect(await db.select().from(agentRuns)).toEqual([]);
  });
});