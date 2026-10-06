import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentRuns,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenants,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { readAgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import * as executionContext from "@/lib/agents/execution-context";
import { agentErrorResponse } from "@/lib/agents/http";
import {
  askMenuManager,
  getLatestMenuManagerRun,
  refreshMenuManagerRun,
} from "@/lib/agents/menu-manager/menu-manager-service";
import * as connections from "@/lib/agents/provider-connections";
import {
  approveTenantAgentBinding,
  setTenantAgentBindingEnabled,
} from "@/lib/agents/tenant-agent-bindings";
import { FakeAgentProvider } from "@/lib/agents/testing/fake-agent-provider";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

vi.mock("@/lib/agents/execution-context", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/execution-context")>();
  return { ...actual, buildAgentExecutionContext: vi.fn(actual.buildAgentExecutionContext) };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ENABLED = readAgentConfig({
  AGENTS_ENABLED: "true",
  AGENT_MENU_MANAGER_ENABLED: "true",
  AGENT_MENU_MANAGER_EXECUTOR: "hyperagent",
});
const AGENT_ID = "cmun4w730017807adjrkbep1t";
const REQUESTER = "admin.quotes@test";
const VIEWER = "second.admin.quotes@test";
const pollDue = () => new Date(Date.now() + ENABLED.pollIntervalMs + 1);

/**
 * PR 3: pinning does not freeze permissions. Admission, dispatch and every
 * poll recheck tenant status, the approved binding and the requester's live
 * access; a change stops collection instead of being worked around.
 */
integrationDescribe("Menu Manager live authorization", () => {
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
    vi.clearAllMocks();
    await sqlClient`TRUNCATE TABLE qos.agent_runs, qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(tenantId: string, subject: string, locationId: string) {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership!.id, locationId });
    return { membershipId: membership!.id, role: "administrator" as const, staffIdentityId: identity!.id };
  }

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const requester = await seedMember(tenantId, REQUESTER, quotes.location.id);
    await seedMember(tenantId, VIEWER, quotes.location.id);
    const product = await createDraftProduct(db, tenantId, requester, {
      internalName: "latte",
      translations: { en: { displayName: "Latte", description: "d" }, ar: { displayName: "l", description: "w" } },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const menu = await createDraftMenu(db, tenantId, requester, {
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
    const enabled = await setTenantAgentBindingEnabled(db, tenantId, REQUESTER, "menu_manager", {
      enabled: true,
      expectedVersion: binding.version,
    });
    await connections.saveAgentProviderConnection(db, {
      provider: "hyperagent",
      serverUrl: "https://hyperagent.example/api/mcp",
      connectedBySubject: "operator:test",
      credentialKey: parseAgentCredentialKey(randomBytes(32).toString("base64")),
      credentials: { tokens: { access_token: "never-read" } },
    });
    return { tenantId, menu, requester, bindingVersion: enabled.version };
  }

  async function callerFor(tenantId: string, subject: string) {
    const membership = await runAsRole(sqlClient, "qos_app", () =>
      requireActiveStaffMembership(db, tenantId, subject),
    );
    return { tenantId, subject, membership };
  }

  async function ask(tenantId: string, menuPublicId: string, provider: FakeAgentProvider) {
    const caller = await callerFor(tenantId, REQUESTER);
    return runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(
        db,
        caller,
        { menuPublicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
        { config: ENABLED, provider },
      ),
    );
  }

  async function viewAs(subject: string, tenantId: string, menuPublicId: string, runPublicId: string, provider: FakeAgentProvider) {
    const caller = await callerFor(tenantId, subject);
    return runAsRole(sqlClient, "qos_app", async () => ({
      refreshed: await refreshMenuManagerRun(db, caller, { menuPublicId, runPublicId }, {
        config: ENABLED,
        provider,
        now: pollDue,
      }),
      latest: await getLatestMenuManagerRun(db, caller, menuPublicId, { config: ENABLED }),
    }));
  }

  it("does not accept a review for a suspended business", async () => {
    const { tenantId, menu } = await seed();
    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenantId));
    const provider = new FakeAgentProvider();

    const error = await ask(tenantId, menu.publicId, provider).catch((caught: unknown) => caught);
    const response = agentErrorResponse(error);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: "tenant_inactive" });
    expect(await db.select().from(agentRuns)).toHaveLength(0);
    expect(provider.startCalls).toHaveLength(0);
  });

  it("does not send a review when access changed after it was accepted", async () => {
    const { tenantId, menu } = await seed();
    const provider = new FakeAgentProvider();
    vi.mocked(executionContext.buildAgentExecutionContext).mockResolvedValueOnce({
      ok: false,
      reason: "requester_access_revoked",
    });

    const { run } = await ask(tenantId, menu.publicId, provider);

    expect(run).toMatchObject({ status: "failed", failureCode: "requester_access_revoked", remoteOutcomeUnknown: false });
    expect(provider.startCalls).toHaveLength(0);
  });

  it("stops collecting the reply when the requester loses access, and resumes if it returns", async () => {
    const { tenantId, menu, requester } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await ask(tenantId, menu.publicId, provider);
    expect(run.status).toBe("running");

    await db.update(staffMemberships).set({ status: "revoked" }).where(eq(staffMemberships.id, requester.membershipId));
    const held = await viewAs(VIEWER, tenantId, menu.publicId, run.publicId, provider);
    expect(held.refreshed).toMatchObject({ status: "running", waitingOn: "access_changed" });
    expect(held.latest).toMatchObject({ status: "running", waitingOn: "access_changed" });
    expect(provider.getRunCalls).toHaveLength(0);

    await db.update(staffMemberships).set({ status: "active" }).where(eq(staffMemberships.id, requester.membershipId));
    const resumed = await viewAs(VIEWER, tenantId, menu.publicId, run.publicId, provider);
    expect(resumed.refreshed).toMatchObject({ status: "running", waitingOn: null });
    expect(provider.getRunCalls).toHaveLength(1);
  });

  it("stops collecting the reply when the binding is turned off or the business is suspended", async () => {
    const { tenantId, menu, bindingVersion } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await ask(tenantId, menu.publicId, provider);

    await setTenantAgentBindingEnabled(db, tenantId, REQUESTER, "menu_manager", {
      enabled: false,
      expectedVersion: bindingVersion,
    });
    await expect(viewAs(VIEWER, tenantId, menu.publicId, run.publicId, provider)).resolves.toMatchObject({
      refreshed: { waitingOn: "access_changed" },
    });

    await setTenantAgentBindingEnabled(db, tenantId, REQUESTER, "menu_manager", {
      enabled: true,
      expectedVersion: bindingVersion + 1,
    });
    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenantId));
    await expect(viewAs(VIEWER, tenantId, menu.publicId, run.publicId, provider)).resolves.toMatchObject({
      refreshed: { waitingOn: "access_changed" },
    });
    expect(provider.getRunCalls).toHaveLength(0);
  });
});
