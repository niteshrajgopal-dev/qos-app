import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentRuns,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { markAgentRunFailed } from "@/lib/agents/agent-runs";
import { readAgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { agentErrorResponse } from "@/lib/agents/http";
import {
  askMenuManager,
  getLatestMenuManagerRun,
  refreshMenuManagerRun,
} from "@/lib/agents/menu-manager/menu-manager-service";
import * as connections from "@/lib/agents/provider-connections";
import * as registry from "@/lib/agents/provider-registry";
import {
  approveTenantAgentBinding,
  setTenantAgentBindingEnabled,
} from "@/lib/agents/tenant-agent-bindings";
import { FakeAgentProvider } from "@/lib/agents/testing/fake-agent-provider";
import { AgentProviderError } from "@/lib/agents/types";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

vi.mock("@/lib/agents/provider-registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/provider-registry")>();
  return { ...actual, getAgentRuntimeProvider: vi.fn(actual.getAgentRuntimeProvider) };
});
vi.mock("@/lib/agents/provider-connections", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/provider-connections")>();
  return {
    ...actual,
    loadAgentProviderCredentials: vi.fn(actual.loadAgentProviderCredentials),
    replaceAgentProviderCredentials: vi.fn(actual.replaceAgentProviderCredentials),
  };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ENABLED = readAgentConfig({
  AGENTS_ENABLED: "true",
  AGENT_MENU_MANAGER_ENABLED: "true",
  AGENT_MENU_MANAGER_EXECUTOR: "hyperagent",
});
const DISABLED = readAgentConfig({});
const AGENT_ID = "cmun4w730017807adjrkbep1t";
const ADMIN = "admin.quotes@test";
const UNSCOPED = "unscoped.quotes@test";
const afterDeadline = () => new Date(Date.now() + ENABLED.runTimeoutMs + 1);
const beforeDeadline = () => new Date(Date.now() + ENABLED.pollIntervalMs + 1);

/**
 * PR 2a: QOS's own waiting deadline is applied without provider construction,
 * credential reads or network calls, after authorization, exactly once; and
 * an unresolved remote outcome cannot become an unacknowledged new start.
 * All service calls run as the restricted application role.
 */
integrationDescribe("Menu Manager run lifecycle", () => {
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
    await sqlClient`TRUNCATE TABLE qos.agent_runs, qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(
    tenantId: string,
    locationIds: string[],
    subject: string,
    role: "administrator" | "user" = "administrator",
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role })
      .returning();
    for (const locationId of locationIds) {
      await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership!.id, locationId });
    }
    return { membershipId: membership!.id, role, staffIdentityId: identity!.id };
  }

  async function connect() {
    await connections.saveAgentProviderConnection(db, {
      provider: "hyperagent",
      serverUrl: "https://hyperagent.example/api/mcp",
      connectedBySubject: "operator:test",
      credentialKey: parseAgentCredentialKey(randomBytes(32).toString("base64")),
      credentials: { tokens: { access_token: "never-read" } },
    });
  }

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const admin = await seedMember(tenantId, [quotes.location.id], ADMIN);
    await seedMember(tenantId, [], UNSCOPED, "user");
    const product = await createDraftProduct(db, tenantId, admin, {
      internalName: "latte",
      translations: { en: { displayName: "Latte", description: "d" }, ar: { displayName: "لاتيه", description: "و" } },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const menu = await createDraftMenu(db, tenantId, admin, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "فطور" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "قهوة" } },
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
    await setTenantAgentBindingEnabled(db, tenantId, ADMIN, "menu_manager", {
      enabled: true,
      expectedVersion: binding.version,
    });
    await connect();
    return { tenantId, menu };
  }

  async function callerFor(tenantId: string, subject: string) {
    const membership = await runAsRole(sqlClient, "qos_app", () =>
      requireActiveStaffMembership(db, tenantId, subject),
    );
    return { tenantId, subject, membership };
  }

  /** What a browser would receive from POST .../agent-runs. */
  async function ask(
    tenantId: string,
    menuPublicId: string,
    provider: FakeAgentProvider,
    input: { idempotencyKey?: string; acknowledgeUnresolvedRunPublicId?: string } = {},
  ): Promise<{ status: number; body: { run?: { publicId: string } } & Record<string, unknown> }> {
    const caller = await callerFor(tenantId, ADMIN);
    try {
      const result = await runAsRole(sqlClient, "qos_app", () =>
        askMenuManager(
          db,
          caller,
          {
            menuPublicId,
            idempotencyKey: input.idempotencyKey ?? `idem-${randomBytes(6).toString("hex")}`,
            acknowledgeUnresolvedRunPublicId: input.acknowledgeUnresolvedRunPublicId,
          },
          { config: ENABLED, provider },
        ),
      );
      return { status: result.created ? 201 : 200, body: result };
    } catch (error) {
      const response = agentErrorResponse(error);
      return { status: response.status, body: (await response.json()) as Record<string, unknown> };
    }
  }

  /** GET .../agent-runs/:run as the given caller, without injecting a provider. */
  async function refresh(
    tenantId: string,
    subject: string,
    menuPublicId: string,
    runPublicId: string,
    options: { config?: typeof ENABLED; now?: () => Date; provider?: FakeAgentProvider } = {},
  ) {
    const caller = await callerFor(tenantId, subject);
    return runAsRole(sqlClient, "qos_app", () =>
      refreshMenuManagerRun(db, caller, { menuPublicId, runPublicId }, {
        config: options.config ?? ENABLED,
        now: options.now ?? afterDeadline,
        provider: options.provider,
      }),
    );
  }

  async function startRunningReview() {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider();
    const asked = await ask(tenantId, menu.publicId, provider);
    expect(asked.status).toBe(201);
    const [row] = await db.select().from(agentRuns);
    expect(row).toMatchObject({ status: "running", providerThreadId: "thread_fake_1" });
    vi.clearAllMocks();
    return { tenantId, menu, provider, runPublicId: asked.body.run!.publicId, accepted: row! };
  }

  async function auditActions(tenantId: string, runPublicId: string) {
    const rows = await withTenantContext(db, tenantId, (tx) =>
      tx
        .select({ action: tenantAuditEvents.action, changeSummary: tenantAuditEvents.changeSummary })
        .from(tenantAuditEvents)
        .where(and(eq(tenantAuditEvents.tenantId, tenantId), eq(tenantAuditEvents.entityPublicId, runPublicId)))
        .orderBy(tenantAuditEvents.occurredAt),
    );
    return rows;
  }

  function expectNoProviderOrCredentialAccess() {
    expect(registry.getAgentRuntimeProvider).not.toHaveBeenCalled();
    expect(connections.loadAgentProviderCredentials).not.toHaveBeenCalled();
    expect(connections.replaceAgentProviderCredentials).not.toHaveBeenCalled();
  }

  async function expectStoppedWaiting(tenantId: string, runPublicId: string, accepted: typeof agentRuns.$inferSelect) {
    const [row] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, runPublicId));
    expect(row).toMatchObject({
      status: "failed",
      failureCode: "qos_wait_deadline",
      result: null,
      providerThreadId: accepted.providerThreadId,
      deadlineAt: accepted.deadlineAt,
      pollLeaseOwner: null,
    });
    const audit = await auditActions(tenantId, runPublicId);
    expect(audit.filter((event) => event.action === "agent_run.wait_expired")).toEqual([
      expect.objectContaining({ changeSummary: expect.objectContaining({ failureCode: "qos_wait_deadline", remoteOutcome: "unknown" }) }),
    ]);
    expect(audit.map((event) => event.action)).not.toContain("agent_run.failed");
  }

  it("ends a run past its deadline while the feature is off, without touching the provider", async () => {
    const { tenantId, menu, provider, runPublicId, accepted } = await startRunningReview();

    const first = await refresh(tenantId, ADMIN, menu.publicId, runPublicId, { config: DISABLED });
    expect(first).toMatchObject({
      status: "failed",
      failureCode: "qos_wait_deadline",
      remoteOutcomeUnknown: true,
      waitingOn: null,
    });
    expect(first).not.toHaveProperty("providerThreadId");
    await refresh(tenantId, ADMIN, menu.publicId, runPublicId, { config: DISABLED });

    await expectStoppedWaiting(tenantId, runPublicId, accepted);
    expectNoProviderOrCredentialAccess();
    expect(provider.getRunCalls).toHaveLength(0);
  });

  it.each(["needs_reauth", "error"] as const)(
    "ends a run past its deadline while the connection is %s, without touching the provider",
    async (status) => {
      const { tenantId, menu, runPublicId, accepted } = await startRunningReview();
      await connections.markAgentProviderConnectionStatus(db, "hyperagent", { status, errorCode: "test" });

      await expect(refresh(tenantId, ADMIN, menu.publicId, runPublicId)).resolves.toMatchObject({
        status: "failed",
        failureCode: "qos_wait_deadline",
      });

      await expectStoppedWaiting(tenantId, runPublicId, accepted);
      expectNoProviderOrCredentialAccess();
    },
  );

  it("ends a run past its deadline when the page loads the latest run", async () => {
    const { tenantId, menu, runPublicId, accepted } = await startRunningReview();
    const caller = await callerFor(tenantId, ADMIN);

    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        getLatestMenuManagerRun(db, caller, menu.publicId, { config: DISABLED, now: afterDeadline }),
      ),
    ).resolves.toMatchObject({ publicId: runPublicId, status: "failed", remoteOutcomeUnknown: true });

    await expectStoppedWaiting(tenantId, runPublicId, accepted);
    expectNoProviderOrCredentialAccess();
  });

  it("ends a run past its deadline when the connection row is missing", async () => {
    const { tenantId, menu, runPublicId, accepted } = await startRunningReview();
    await sqlClient`DELETE FROM qos.agent_provider_credentials`;
    await sqlClient`DELETE FROM qos.agent_provider_connections`;

    await refresh(tenantId, ADMIN, menu.publicId, runPublicId);

    await expectStoppedWaiting(tenantId, runPublicId, accepted);
    expectNoProviderOrCredentialAccess();
  });

  it("holds an active run before its deadline and says why, without provider calls", async () => {
    const { tenantId, menu, runPublicId } = await startRunningReview();

    await expect(
      refresh(tenantId, ADMIN, menu.publicId, runPublicId, { config: DISABLED, now: beforeDeadline }),
    ).resolves.toMatchObject({ status: "running", waitingOn: "service_unavailable" });

    await connections.markAgentProviderConnectionStatus(db, "hyperagent", {
      status: "needs_reauth",
      errorCode: "provider_reauth_required",
    });
    await expect(
      refresh(tenantId, ADMIN, menu.publicId, runPublicId, { now: beforeDeadline }),
    ).resolves.toMatchObject({ status: "running", waitingOn: "agent_connection" });

    const caller = await callerFor(tenantId, ADMIN);
    await expect(
      runAsRole(sqlClient, "qos_app", () => getLatestMenuManagerRun(db, caller, menu.publicId, { config: ENABLED })),
    ).resolves.toMatchObject({ publicId: runPublicId, waitingOn: "agent_connection" });
    expectNoProviderOrCredentialAccess();
  });

  it("authorizes the caller before ending an expired run", async () => {
    const { tenantId, menu, runPublicId } = await startRunningReview();

    await expect(refresh(tenantId, UNSCOPED, menu.publicId, runPublicId)).rejects.toMatchObject({
      statusCode: 403,
    });

    const flower = await createTenantHierarchy(db, flowerTenantFixture());
    await seedMember(flower.tenant.id, [flower.location.id], "admin.flower@test");
    await expect(
      refresh(flower.tenant.id, "admin.flower@test", menu.publicId, runPublicId),
    ).rejects.toMatchObject({ statusCode: 404 });

    const [row] = await db.select().from(agentRuns);
    expect(row).toMatchObject({ status: "running", failureCode: null });
    expect((await auditActions(tenantId, runPublicId)).map((event) => event.action)).toEqual([
      "agent_run.requested",
      "agent_run.started",
    ]);
  });

  it("never changes a completed run at or after its deadline", async () => {
    const { tenantId, menu, runPublicId } = await startRunningReview();
    const result = { summary: "Stored review." };
    await db
      .update(agentRuns)
      .set({ status: "completed", result, nextPollAt: null, finishedAt: new Date() })
      .where(eq(agentRuns.publicId, runPublicId));

    await expect(
      refresh(tenantId, ADMIN, menu.publicId, runPublicId, { config: DISABLED }),
    ).resolves.toMatchObject({ status: "completed", result, failureCode: null });
    expect((await auditActions(tenantId, runPublicId)).map((event) => event.action)).toEqual([
      "agent_run.requested",
      "agent_run.started",
    ]);
  });

  it("does not extend the deadline across a re-authorization pause", async () => {
    const { tenantId, menu, provider, runPublicId, accepted } = await startRunningReview();
    provider.script(
      new AgentProviderError("provider_reauth_required", "Expired.", { requiresReauth: true, outcome: "rejected" }),
      { state: "running" },
    );

    await expect(
      refresh(tenantId, ADMIN, menu.publicId, runPublicId, { now: beforeDeadline, provider }),
    ).resolves.toMatchObject({ status: "running", waitingOn: "agent_connection" });
    await connect();

    await refresh(tenantId, ADMIN, menu.publicId, runPublicId, { provider });

    await expectStoppedWaiting(tenantId, runPublicId, accepted);
    expect(provider.getRunCalls).toEqual(["thread_fake_1"]);
    expect(provider.startCalls).toHaveLength(1);
  });

  it("refuses a new review after QOS stopped waiting until the user acknowledges it", async () => {
    const { tenantId, menu, provider, runPublicId } = await startRunningReview();
    const originalKey = provider.startCalls[0]!.idempotencyKey;
    await refresh(tenantId, ADMIN, menu.publicId, runPublicId);

    await expect(ask(tenantId, menu.publicId, provider)).resolves.toEqual({
      status: 409,
      body: {
        error: "The previous run ended before QOS learned whether the agent service finished it. Confirm to start another.",
        code: "unresolved_previous_run",
        unresolvedRunPublicId: runPublicId,
      },
    });
    await expect(
      ask(tenantId, menu.publicId, provider, { acknowledgeUnresolvedRunPublicId: "run_000000000000000000000000" }),
    ).resolves.toMatchObject({ status: 409, body: { code: "unresolved_previous_run" } });
    expect(provider.startCalls).toHaveLength(1);
    expect(await db.select({ id: agentRuns.id }).from(agentRuns)).toHaveLength(1);

    await expect(ask(tenantId, menu.publicId, provider, { idempotencyKey: originalKey })).resolves.toMatchObject({
      status: 200,
      body: { run: { publicId: runPublicId, status: "failed" } },
    });

    const restarted = await ask(tenantId, menu.publicId, provider, { acknowledgeUnresolvedRunPublicId: runPublicId });
    expect(restarted).toMatchObject({ status: 201, body: { run: { status: "running" } } });
    expect(provider.startCalls).toHaveLength(2);
    const audit = await auditActions(tenantId, restarted.body.run!.publicId);
    expect(audit[0]).toMatchObject({
      action: "agent_run.requested",
      changeSummary: { acknowledgedUnresolvedRunPublicId: runPublicId },
    });
  });

  it("treats a start with an unknown outcome as unresolved", async () => {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider().failStartWith(
      new AgentProviderError("provider_request_failed", "socket reset after send", { outcome: "submission_unknown" }),
    );

    const failed = await ask(tenantId, menu.publicId, provider);
    expect(failed).toMatchObject({
      status: 201,
      body: { run: { status: "failed", failureCode: "start_outcome_unknown", remoteOutcomeUnknown: true } },
    });
    expect(JSON.stringify(failed.body)).not.toContain("socket reset");

    provider.failStartWith(null);
    await expect(ask(tenantId, menu.publicId, provider)).resolves.toMatchObject({
      status: 409,
      body: { code: "unresolved_previous_run", unresolvedRunPublicId: failed.body.run!.publicId },
    });
    await expect(
      ask(tenantId, menu.publicId, provider, { acknowledgeUnresolvedRunPublicId: failed.body.run!.publicId }),
    ).resolves.toMatchObject({ status: 201, body: { run: { status: "running" } } });
  });

  it("treats a rejected start as resolved", async () => {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider().failStartWith(
      new AgentProviderError("provider_not_connected", "refused", { outcome: "not_dispatched" }),
    );
    await expect(ask(tenantId, menu.publicId, provider)).resolves.toMatchObject({
      status: 201,
      body: { run: { status: "failed", failureCode: "provider_not_connected", remoteOutcomeUnknown: false } },
    });

    provider.failStartWith(null);
    await expect(ask(tenantId, menu.publicId, provider)).resolves.toMatchObject({ status: 201 });
  });

  it.each(["timeout", "provider_reauth_required"])(
    "treats a pre-existing %s row with a thread reference as unresolved",
    async (failureCode) => {
      const { tenantId, menu, runPublicId } = await startRunningReview();
      await markAgentRunFailed(db, tenantId, runPublicId, { code: failureCode, message: "Legacy row." });

      await expect(ask(tenantId, menu.publicId, new FakeAgentProvider())).resolves.toMatchObject({
        status: 409,
        body: { code: "unresolved_previous_run", unresolvedRunPublicId: runPublicId },
      });
    },
  );
});
