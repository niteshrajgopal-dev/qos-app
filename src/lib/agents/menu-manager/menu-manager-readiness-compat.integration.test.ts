import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { agentRuns, staffIdentities, staffLocationScopes, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { readAgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { agentErrorResponse } from "@/lib/agents/http";
import { askMenuManager, refreshMenuManagerRun } from "@/lib/agents/menu-manager/menu-manager-service";
import * as connections from "@/lib/agents/provider-connections";
import * as registry from "@/lib/agents/provider-registry";
import {
  approveTenantAgentBinding,
  setTenantAgentBindingEnabled,
} from "@/lib/agents/tenant-agent-bindings";
import { getTenantAgentSettings } from "@/lib/agents/tenant-agent-settings";
import { FakeAgentProvider } from "@/lib/agents/testing/fake-agent-provider";
import { AgentProviderError } from "@/lib/agents/types";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

// Pass-through spies: real behaviour, but every provider construction and
// credential read is observable.
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

const ENABLED = readAgentConfig({ AGENTS_ENABLED: "true", AGENT_MENU_MANAGER_ENABLED: "true" });
const AGENT_ID = "cmun4w730017807adjrkbep1t";
const ADMIN = "admin.quotes@test";
const UNSCOPED = "unscoped.quotes@test";

/**
 * Externally observable behaviour of the Menu Manager admission path for each
 * fail-closed case, as the restricted application role: HTTP status and body
 * (via the routes' error mapper), no provider construction, no credential
 * reads and no run rows. Uses no symbols introduced by the readiness refactor,
 * so the same file runs unchanged against the pre-refactor commit.
 */
integrationDescribe("Menu Manager readiness compatibility", () => {
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

  async function seed(options: { binding: "enabled" | "disabled" | "none"; connection: "connected" | "none" | "needs_reauth" }) {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const admin = await seedMember(tenantId, [quotes.location.id], ADMIN);
    const unscoped = await seedMember(tenantId, [], UNSCOPED, "user");
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
    if (options.binding !== "none") {
      const binding = await approveTenantAgentBinding(db, {
        tenantId,
        capability: "menu_manager",
        provider: "hyperagent",
        providerAgentId: AGENT_ID,
        approvedBySubject: "operator:platform",
      });
      if (options.binding === "enabled") {
        await setTenantAgentBindingEnabled(db, tenantId, ADMIN, "menu_manager", {
          enabled: true,
          expectedVersion: binding.version,
        });
      }
    }
    if (options.connection !== "none") {
      await connect();
    }
    if (options.connection === "needs_reauth") {
      await connections.markAgentProviderConnectionStatus(db, "hyperagent", {
        status: "needs_reauth",
        errorCode: "provider_reauth_required",
      });
    }
    vi.clearAllMocks();
    return { quotes, tenantId, admin, unscoped, menu };
  }

  /** What a browser would receive from POST .../agent-runs for this caller. */
  async function ask(
    tenantId: string,
    subject: string,
    menuPublicId: string,
    config = ENABLED,
  ) {
    try {
      const membership = await runAsRole(sqlClient, "qos_app", () =>
        requireActiveStaffMembership(db, tenantId, subject),
      );
      const result = await runAsRole(sqlClient, "qos_app", () =>
        askMenuManager(db, { tenantId, subject, membership }, { menuPublicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` }, { config }),
      );
      return { status: result.created ? 201 : 200, body: result as unknown };
    } catch (error) {
      const response = agentErrorResponse(error);
      return { status: response.status, body: (await response.json()) as unknown };
    }
  }

  async function expectNoProviderOrCredentialAccess() {
    expect(registry.getAgentRuntimeProvider).not.toHaveBeenCalled();
    expect(connections.loadAgentProviderCredentials).not.toHaveBeenCalled();
    expect(connections.replaceAgentProviderCredentials).not.toHaveBeenCalled();
    expect(await db.select({ id: agentRuns.id }).from(agentRuns)).toHaveLength(0);
  }

  it("feature disabled", async () => {
    const { tenantId, menu } = await seed({ binding: "enabled", connection: "connected" });
    await expect(ask(tenantId, ADMIN, menu.publicId, readAgentConfig({}))).resolves.toEqual({
      status: 404,
      body: { error: "Menu Manager is not available in this environment.", code: "capability_unavailable" },
    });
    await expectNoProviderOrCredentialAccess();
  });

  it("missing binding", async () => {
    const { tenantId, menu } = await seed({ binding: "none", connection: "connected" });
    await expect(ask(tenantId, ADMIN, menu.publicId)).resolves.toEqual({
      status: 409,
      body: { error: "Menu Manager has not been set up for this business.", code: "capability_not_configured" },
    });
    await expectNoProviderOrCredentialAccess();
  });

  it("disabled binding", async () => {
    const { tenantId, menu } = await seed({ binding: "disabled", connection: "connected" });
    await expect(ask(tenantId, ADMIN, menu.publicId)).resolves.toEqual({
      status: 409,
      body: { error: "Menu Manager is turned off for this business.", code: "capability_disabled" },
    });
    await expectNoProviderOrCredentialAccess();
  });

  it.each(["none", "needs_reauth"] as const)("provider connection %s", async (connection) => {
    const { tenantId, menu } = await seed({ binding: "enabled", connection });
    await expect(ask(tenantId, ADMIN, menu.publicId)).resolves.toEqual({
      status: 503,
      body: { error: "The QOS agent service is not connected right now.", code: "provider_not_connected" },
    });
    await expectNoProviderOrCredentialAccess();
  });

  it("caller without access to the menu's location", async () => {
    const { tenantId, menu } = await seed({ binding: "enabled", connection: "connected" });
    await expect(ask(tenantId, UNSCOPED, menu.publicId)).resolves.toEqual({
      status: 403,
      body: { error: "Staff membership does not include all requested locations." },
    });
    await expectNoProviderOrCredentialAccess();
  });

  it("caller from another tenant", async () => {
    const { menu } = await seed({ binding: "enabled", connection: "connected" });
    const flower = await createTenantHierarchy(db, flowerTenantFixture());
    await seedMember(flower.tenant.id, [flower.location.id], "admin.flower@test");
    const binding = await approveTenantAgentBinding(db, {
      tenantId: flower.tenant.id,
      capability: "menu_manager",
      provider: "hyperagent",
      providerAgentId: AGENT_ID,
      approvedBySubject: "operator:platform",
    });
    await setTenantAgentBindingEnabled(db, flower.tenant.id, "admin.flower@test", "menu_manager", {
      enabled: true,
      expectedVersion: binding.version,
    });
    vi.clearAllMocks();

    await expect(ask(flower.tenant.id, "admin.flower@test", menu.publicId)).resolves.toEqual({
      status: 404,
      body: { error: "Menu not found." },
    });
    await expectNoProviderOrCredentialAccess();
  });

  it("revoked membership", async () => {
    const { tenantId, admin, menu } = await seed({ binding: "enabled", connection: "connected" });
    await db
      .update(staffMemberships)
      .set({ status: "revoked" })
      .where(and(eq(staffMemberships.tenantId, tenantId), eq(staffMemberships.id, admin.membershipId)));

    await expect(ask(tenantId, ADMIN, menu.publicId)).resolves.toEqual({
      status: 403,
      body: { error: "Active staff membership is required for this business." },
    });
    await expectNoProviderOrCredentialAccess();
  });

  it("a failed poll keeps the accepted run's thread reference and never resubmits", async () => {
    const { tenantId, menu } = await seed({ binding: "enabled", connection: "connected" });
    const membership = await runAsRole(sqlClient, "qos_app", () =>
      requireActiveStaffMembership(db, tenantId, ADMIN),
    );
    const caller = { tenantId, subject: ADMIN, membership };
    const provider = new FakeAgentProvider();
    const asked = await runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(db, caller, { menuPublicId: menu.publicId, idempotencyKey: "idem-accepted-run" }, {
        config: ENABLED,
        provider,
      }),
    );
    const [accepted] = await db.select().from(agentRuns);
    expect(accepted).toMatchObject({ status: "running", providerThreadId: "thread_fake_1" });

    provider.script(
      new AgentProviderError("provider_not_connected", "Not connected.", { outcome: "not_dispatched" }),
      new AgentProviderError("provider_reauth_required", "Expired.", { requiresReauth: true, outcome: "rejected" }),
    );
    const poll = (n: number) =>
      runAsRole(sqlClient, "qos_app", () =>
        refreshMenuManagerRun(db, caller, { menuPublicId: menu.publicId, runPublicId: asked.run.publicId }, {
          config: ENABLED,
          provider,
          now: () => new Date(Date.now() + n * (ENABLED.pollIntervalMs + ENABLED.pollLeaseMs + 1)),
        }),
      );

    await poll(1);
    const afterPreDispatchFailure = await db.select().from(agentRuns);
    expect(afterPreDispatchFailure).toHaveLength(1);
    expect(afterPreDispatchFailure[0]).toMatchObject({
      publicId: asked.run.publicId,
      status: "running",
      providerThreadId: "thread_fake_1",
      failureCode: null,
    });

    // Pre-existing policy (unchanged by this PR): a reauth-required poll ends
    // the accepted run locally, although the remote thread may still finish.
    await poll(2);
    const rows = await db.select().from(agentRuns);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      publicId: asked.run.publicId,
      status: "failed",
      failureCode: "provider_reauth_required",
      providerThreadId: "thread_fake_1",
    });
    expect(provider.startCalls).toHaveLength(1);
    expect(provider.getRunCalls).toEqual(["thread_fake_1", "thread_fake_1"]);
    await expect(connections.getAgentProviderConnectionStatus(db, "hyperagent")).resolves.toMatchObject({
      status: "needs_reauth",
    });
  });

  it("settings view reports a reauth-required connection without exposing details", async () => {
    const { tenantId, admin } = await seed({ binding: "enabled", connection: "needs_reauth" });
    const view = await runAsRole(sqlClient, "qos_app", () =>
      getTenantAgentSettings(db, tenantId, admin, { config: ENABLED }),
    );
    expect(view).toEqual({
      canManage: true,
      connection: { status: "needs_reauth", lastCheckedAt: expect.any(String) },
      menuManager: {
        featureEnabled: true,
        binding: expect.objectContaining({ enabled: true }),
        available: false,
        unavailableReason: "not_connected",
      },
    });
    expect(JSON.stringify(view)).not.toContain("hyperagent.example");
    await expectNoProviderOrCredentialAccess();
  });
});
