import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  agentRuns,
  catalogueMenuLiveRevisions,
  catalogueMenus,
  catalogueProducts,
  catalogueProductTranslations,
  catalogueVariantPrices,
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
import { readAgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { MENU_SNAPSHOT_AUTHORITY_NOTICE } from "@/lib/agents/menu-manager/menu-manager-request";
import { MENU_MANAGER_RESULT_SCHEMA } from "@/lib/agents/menu-manager/menu-manager-result";
import {
  askMenuManager,
  getLatestMenuManagerRun,
  refreshMenuManagerRun,
} from "@/lib/agents/menu-manager/menu-manager-service";
import {
  getAgentProviderConnectionStatus,
  saveAgentProviderConnection,
} from "@/lib/agents/provider-connections";
import {
  approveTenantAgentBinding,
  setTenantAgentBindingEnabled,
} from "@/lib/agents/tenant-agent-bindings";
import { FakeAgentProvider } from "@/lib/agents/testing/fake-agent-provider";
import { AgentProviderError } from "@/lib/agents/types";
import { createDraftMenu, updateDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { withTenantContext } from "@/lib/tenant/context";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const APPROVED_AGENT_ID = "cmun4w730017807adjrkbep1t";
const ENABLED = readAgentConfig({
  AGENTS_ENABLED: "true",
  AGENT_MENU_MANAGER_ENABLED: "true",
  AGENT_MENU_MANAGER_EXECUTOR: "hyperagent",
});
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

integrationDescribe("Menu Manager service", () => {
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
    await sqlClient`TRUNCATE TABLE qos.agent_runs, qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.tenant_audit_events, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(
    tenantId: string,
    locationIds: string[],
    role: "administrator" | "user",
    subject: string,
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    for (const locationId of locationIds) {
      await db
        .insert(staffLocationScopes)
        .values({ tenantId, staffMembershipId: membership.id, locationId });
    }
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  async function connectProvider() {
    await saveAgentProviderConnection(db, {
      provider: "hyperagent",
      serverUrl: "https://hyperagent.example/api/mcp",
      connectedBySubject: "operator:test",
      credentialKey: parseAgentCredentialKey(randomBytes(32).toString("base64")),
      credentials: { tokens: { access_token: "unused" } },
    });
  }

  async function seed(options: { binding?: "enabled" | "disabled" | "none"; connected?: boolean } = {}) {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const adminSubject = "admin.quotes@test";
    const admin = await seedMember(quotes.tenant.id, [quotes.location.id], "administrator", adminSubject);
    const staffSubject = "barista.quotes@test";
    const staff = await seedMember(quotes.tenant.id, [quotes.location.id], "user", staffSubject);
    const unscopedSubject = "unscoped.quotes@test";
    const unscoped = await seedMember(quotes.tenant.id, [], "user", unscopedSubject);

    const products = [];
    for (const name of ["latte", "flat-white"]) {
      products.push(
        await createDraftProduct(db, quotes.tenant.id, admin, {
          internalName: name,
          translations: {
            en: { displayName: name, description: `${name} description` },
            ar: { displayName: `${name} ar`, description: "وصف" },
          },
          defaultVariant: { amountMinor: 1800, currency: "AED" },
        }),
      );
    }

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "فطور" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "قهوة" } },
          products: products.map((product, index) => ({
            productPublicId: product.publicId,
            sortOrder: index,
          })),
        },
      ],
    });

    if ((options.binding ?? "enabled") !== "none") {
      const binding = await approveTenantAgentBinding(db, {
        tenantId: quotes.tenant.id,
        capability: "menu_manager",
        provider: "hyperagent",
        providerAgentId: APPROVED_AGENT_ID,
        approvedBySubject: "operator:platform",
      });
      if ((options.binding ?? "enabled") === "enabled") {
        await setTenantAgentBindingEnabled(db, quotes.tenant.id, adminSubject, "menu_manager", {
          enabled: true,
          expectedVersion: binding.version,
        });
      }
    }
    if (options.connected ?? true) {
      await connectProvider();
    }

    const caller = (subject: string, membership: typeof admin) => ({
      tenantId: quotes.tenant.id,
      subject,
      membership,
    });

    return {
      quotes,
      menu,
      products,
      admin: caller(adminSubject, admin),
      staff: caller(staffSubject, staff),
      staffMembershipId: staff.membershipId,
      unscoped: caller(unscopedSubject, unscoped),
      adminMembership: admin,
    };
  }

  function validReply(menuPublicId: string, productPublicId: string) {
    return [
      "Review complete.",
      "```json",
      JSON.stringify({
        schema: MENU_MANAGER_RESULT_SCHEMA,
        menuPublicId,
        summary: "Both items are missing photos.",
        findings: [
          {
            type: "missing_photo",
            severity: "warning",
            title: "Missing photos",
            detail: "No approved photo.",
            recommendation: "Upload photos.",
            productPublicIds: [productPublicId],
          },
        ],
        suggestions: [],
      }),
      "```",
    ].join("\n");
  }

  const key = () => `idem-${randomBytes(6).toString("hex")}`;

  async function catalogueState(tenantId: string) {
    return withTenantContext(db, tenantId, async (tx) => ({
      products: await tx
        .select({ publicId: catalogueProducts.publicId, updatedAt: catalogueProducts.updatedAt, media: catalogueProducts.primaryMediaAssetId })
        .from(catalogueProducts)
        .orderBy(catalogueProducts.publicId),
      translations: await tx
        .select({ locale: catalogueProductTranslations.locale, version: catalogueProductTranslations.translationVersion, description: catalogueProductTranslations.description })
        .from(catalogueProductTranslations)
        .orderBy(catalogueProductTranslations.productId, catalogueProductTranslations.locale),
      prices: await tx
        .select({ amountMinor: catalogueVariantPrices.amountMinor })
        .from(catalogueVariantPrices)
        .orderBy(catalogueVariantPrices.variantId),
      menus: await tx
        .select({ version: catalogueMenus.version, updatedAt: catalogueMenus.updatedAt })
        .from(catalogueMenus),
      liveRevisions: await tx.select({ id: catalogueMenuLiveRevisions.id }).from(catalogueMenuLiveRevisions),
    }));
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

  it("runs end to end through qos_app RLS without changing any catalogue data", async () => {
    const { quotes, menu, products, admin } = await seed();
    const before = await catalogueState(quotes.tenant.id);
    const provider = new FakeAgentProvider().script(
      { state: "running" },
      { state: "completed", finalMessage: validReply(menu.publicId, products[0]!.publicId) },
    );
    const t0 = new Date();
    const at = (ms: number) => () => new Date(t0.getTime() + ms);

    const asked = await runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: "idem-happy-path" }, {
        config: ENABLED,
        provider,
        now: at(0),
      }),
    );
    expect(asked.created).toBe(true);
    expect(asked.run.status).toBe("running");
    expect(asked.run).not.toHaveProperty("providerThreadId");

    expect(provider.startCalls).toHaveLength(1);
    const message = provider.startCalls[0]!.message;
    expect(provider.startCalls[0]!.providerAgentId).toBe(APPROVED_AGENT_ID);
    expect(message.startsWith(MENU_SNAPSHOT_AUTHORITY_NOTICE)).toBe(true);
    expect(message).toContain(products[0]!.publicId);
    expect(message).not.toMatch(UUID);

    // Replay returns the same run without contacting the provider again.
    const replay = await askMenuManager(
      db,
      admin,
      { menuPublicId: menu.publicId, idempotencyKey: "idem-happy-path" },
      { config: ENABLED, provider, now: at(10) },
    );
    expect(replay).toMatchObject({ created: false, run: { publicId: asked.run.publicId } });
    expect(provider.startCalls).toHaveLength(1);

    await expect(
      askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
        config: ENABLED,
        provider,
        now: at(20),
      }),
    ).rejects.toMatchObject({ code: "run_in_progress", activeRunPublicId: asked.run.publicId });

    const refresh = (ms: number) =>
      runAsRole(sqlClient, "qos_app", () =>
        refreshMenuManagerRun(db, admin, { menuPublicId: menu.publicId, runPublicId: asked.run.publicId }, {
          config: ENABLED,
          provider,
          now: at(ms),
        }),
      );

    await expect(refresh(1_000)).resolves.toMatchObject({ status: "running" });
    expect(provider.getRunCalls).toHaveLength(0);

    await expect(refresh(ENABLED.pollIntervalMs + 1)).resolves.toMatchObject({ status: "running" });
    expect(provider.getRunCalls).toHaveLength(1);

    const done = await refresh(2 * ENABLED.pollIntervalMs + 2);
    expect(done.status).toBe("completed");
    expect(done.result).toMatchObject({
      summary: "Both items are missing photos.",
      findings: [{ productPublicIds: [products[0]!.publicId] }],
      snapshot: { menuVersion: menu.version },
    });

    await refresh(10 * ENABLED.pollIntervalMs);
    expect(provider.getRunCalls).toHaveLength(2);

    const audit = await auditActions(quotes.tenant.id, asked.run.publicId);
    expect(audit.map((row) => row.action)).toEqual([
      "agent_run.requested",
      "agent_run.started",
      "agent_run.completed",
    ]);
    const requested = JSON.stringify(audit[0]!.changeSummary);
    expect(requested).not.toContain(products[0]!.publicId);
    expect(requested).toContain("snapshotSha256");
    expect(audit[2]!.changeSummary).toMatchObject({ findingCount: 1, suggestionCount: 0 });

    await expect(getLatestMenuManagerRun(db, admin, menu.publicId)).resolves.toMatchObject({
      publicId: asked.run.publicId,
      status: "completed",
    });
    expect(await catalogueState(quotes.tenant.id)).toEqual(before);
  });

  it("sends only the selected products", async () => {
    const { menu, products, admin } = await seed();
    const provider = new FakeAgentProvider();

    await askMenuManager(
      db,
      admin,
      {
        menuPublicId: menu.publicId,
        idempotencyKey: key(),
        selectedProductPublicIds: [products[1]!.publicId],
      },
      { config: ENABLED, provider },
    );

    const message = provider.startCalls[0]!.message;
    expect(message).toContain(products[1]!.publicId);
    expect(message).not.toContain(products[0]!.publicId);
  });

  it("fails closed before building a snapshot when the feature, binding or connection is missing", async () => {
    const provider = new FakeAgentProvider();
    const off = await seed();
    await expect(
      askMenuManager(db, off.admin, { menuPublicId: off.menu.publicId, idempotencyKey: key() }, {
        config: readAgentConfig({ AGENTS_ENABLED: "true" }),
        provider,
      }),
    ).rejects.toMatchObject({ code: "capability_unavailable", statusCode: 404 });

    await sqlClient`TRUNCATE TABLE qos.tenant_agent_bindings CASCADE`;
    await expect(
      askMenuManager(db, off.admin, { menuPublicId: off.menu.publicId, idempotencyKey: key() }, {
        config: ENABLED,
        provider,
      }),
    ).rejects.toMatchObject({ code: "capability_not_configured" });

    await approveTenantAgentBinding(db, {
      tenantId: off.quotes.tenant.id,
      capability: "menu_manager",
      provider: "hyperagent",
      providerAgentId: APPROVED_AGENT_ID,
      approvedBySubject: "operator:platform",
    });
    await expect(
      askMenuManager(db, off.admin, { menuPublicId: off.menu.publicId, idempotencyKey: key() }, {
        config: ENABLED,
        provider,
      }),
    ).rejects.toMatchObject({ code: "capability_disabled" });

    await sqlClient`TRUNCATE TABLE qos.agent_provider_credentials, qos.agent_provider_connections CASCADE`;
    await sqlClient`UPDATE qos.tenant_agent_bindings SET enabled = true`;
    await expect(
      askMenuManager(db, off.admin, { menuPublicId: off.menu.publicId, idempotencyKey: key() }, {
        config: ENABLED,
        provider,
      }),
    ).rejects.toMatchObject({ code: "provider_not_connected", statusCode: 503 });

    expect(provider.startCalls).toHaveLength(0);
    expect(await db.select().from(agentRuns)).toHaveLength(0);
  });

  it("requires menu location access and keeps other tenants' menus invisible", async () => {
    const { menu, unscoped } = await seed();
    const provider = new FakeAgentProvider();

    await expect(
      askMenuManager(db, unscoped, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
        config: ENABLED,
        provider,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });

    const flower = await createTenantHierarchy(db, flowerTenantFixture());
    const florist = await seedMember(flower.tenant.id, [flower.location.id], "administrator", "admin.flower@test");
    const flowerBinding = await approveTenantAgentBinding(db, {
      tenantId: flower.tenant.id,
      capability: "menu_manager",
      provider: "hyperagent",
      providerAgentId: APPROVED_AGENT_ID,
      approvedBySubject: "operator:platform",
    });
    await setTenantAgentBindingEnabled(db, flower.tenant.id, "admin.flower@test", "menu_manager", {
      enabled: true,
      expectedVersion: flowerBinding.version,
    });
    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        askMenuManager(
          db,
          { tenantId: flower.tenant.id, subject: "admin.flower@test", membership: florist },
          { menuPublicId: menu.publicId, idempotencyKey: key() },
          { config: ENABLED, provider },
        ),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(provider.startCalls).toHaveLength(0);
    expect(await db.select().from(agentRuns)).toHaveLength(0);
  });

  it("re-checks location access on every read of a running run", async () => {
    const { quotes, menu, staff, staffMembershipId } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await askMenuManager(db, staff, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
      config: ENABLED,
      provider,
    });

    await db
      .delete(staffLocationScopes)
      .where(
        and(
          eq(staffLocationScopes.tenantId, quotes.tenant.id),
          eq(staffLocationScopes.staffMembershipId, staffMembershipId),
        ),
      );

    await expect(
      refreshMenuManagerRun(db, staff, { menuPublicId: menu.publicId, runPublicId: run.publicId }, {
        config: ENABLED,
        provider,
        now: () => new Date(Date.now() + 60_000),
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
    await expect(getLatestMenuManagerRun(db, staff, menu.publicId)).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(provider.getRunCalls).toHaveLength(0);
  });

  it("rejects a run looked up through a different menu", async () => {
    const { quotes, menu, admin, adminMembership, products } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
      config: ENABLED,
      provider,
    });
    const other = await createDraftMenu(db, quotes.tenant.id, adminMembership, {
      internalName: "dinner",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Dinner" }, ar: { displayName: "عشاء" } },
      sections: [
        {
          internalName: "mains",
          sortOrder: 0,
          translations: { en: { displayName: "Mains" }, ar: { displayName: "رئيسي" } },
          products: [{ productPublicId: products[0]!.publicId, sortOrder: 0 }],
        },
      ],
    });

    await expect(
      refreshMenuManagerRun(db, admin, { menuPublicId: other.publicId, runPublicId: run.publicId }, {
        config: ENABLED,
        provider,
      }),
    ).rejects.toMatchObject({ code: "run_not_found", statusCode: 404 });
  });

  it("fails the run when the agent reply breaks the contract and keeps a bounded excerpt", async () => {
    const { menu, admin } = await seed();
    const hostile = [
      "```json",
      JSON.stringify({
        schema: MENU_MANAGER_RESULT_SCHEMA,
        menuPublicId: menu.publicId,
        summary: "Publishing now",
        findings: [],
        suggestions: [],
        actions: [{ type: "publish_menu" }],
      }),
      "```",
    ].join("\n");
    const provider = new FakeAgentProvider().script({ state: "completed", finalMessage: hostile });
    const { run } = await askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
      config: ENABLED,
      provider,
    });

    const failed = await refreshMenuManagerRun(db, admin, { menuPublicId: menu.publicId, runPublicId: run.publicId }, {
      config: ENABLED,
      provider,
      now: () => new Date(Date.now() + ENABLED.pollIntervalMs + 1),
    });
    expect(failed).toMatchObject({ status: "failed", failureCode: "invalid_result_shape", result: null });
    expect(failed).not.toHaveProperty("rawResultExcerpt");

    const [row] = await db.select({ raw: agentRuns.rawResultExcerpt }).from(agentRuns);
    expect(row!.raw).toBe(hostile);
  });

  it("rejects a reply that references a product outside the snapshot", async () => {
    const { menu, admin } = await seed();
    const provider = new FakeAgentProvider().script({
      state: "completed",
      finalMessage: validReply(menu.publicId, "prd_not_in_snapshot"),
    });
    const { run } = await askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
      config: ENABLED,
      provider,
    });

    await expect(
      refreshMenuManagerRun(db, admin, { menuPublicId: menu.publicId, runPublicId: run.publicId }, {
        config: ENABLED,
        provider,
        now: () => new Date(Date.now() + ENABLED.pollIntervalMs + 1),
      }),
    ).resolves.toMatchObject({ status: "failed", failureCode: "unknown_product_reference" });
  });

  it("records a provider start failure and flags reauth on the connection", async () => {
    const { menu, admin } = await seed();
    const provider = new FakeAgentProvider().failStartWith(
      new AgentProviderError("provider_reauth_required", "token expired", {
        requiresReauth: true,
        outcome: "rejected",
      }),
    );

    const { run } = await askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
      config: ENABLED,
      provider,
    });
    expect(run).toMatchObject({ status: "failed", failureCode: "provider_reauth_required" });
    expect(run.failureMessage).not.toContain("token expired");
    await expect(getAgentProviderConnectionStatus(db, "hyperagent")).resolves.toMatchObject({
      status: "needs_reauth",
    });

    // A failed run no longer blocks a new request once the operator reconnects.
    await connectProvider();
    provider.failStartWith(null);
    await expect(
      askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
        config: ENABLED,
        provider,
      }),
    ).resolves.toMatchObject({ created: true, run: { status: "running" } });
  });

  it("stops at awaiting_approval without resolving it, and times out past the deadline", async () => {
    const { menu, admin } = await seed();
    const pausing = new FakeAgentProvider().script({ state: "awaiting_approval" });
    const paused = await askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
      config: ENABLED,
      provider: pausing,
    });
    const later = () => new Date(Date.now() + ENABLED.pollIntervalMs + 1);

    await expect(
      refreshMenuManagerRun(db, admin, { menuPublicId: menu.publicId, runPublicId: paused.run.publicId }, {
        config: ENABLED,
        provider: pausing,
        now: later,
      }),
    ).resolves.toMatchObject({ status: "awaiting_approval" });
    await refreshMenuManagerRun(db, admin, { menuPublicId: menu.publicId, runPublicId: paused.run.publicId }, {
      config: ENABLED,
      provider: pausing,
      now: () => new Date(Date.now() + 10 * ENABLED.pollIntervalMs),
    });
    expect(pausing.getRunCalls).toHaveLength(1);
    expect(Object.getOwnPropertyNames(FakeAgentProvider.prototype)).not.toContain("resolveApproval");

    const slow = new FakeAgentProvider();
    const pending = await askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
      config: ENABLED,
      provider: slow,
    });
    await expect(
      refreshMenuManagerRun(db, admin, { menuPublicId: menu.publicId, runPublicId: pending.run.publicId }, {
        config: ENABLED,
        provider: slow,
        now: () => new Date(Date.now() + ENABLED.runTimeoutMs + 1),
      }),
    ).resolves.toMatchObject({ status: "failed", failureCode: "qos_wait_deadline", remoteOutcomeUnknown: true });
    expect(slow.getRunCalls).toHaveLength(0);
  });

  it("does not poll once the feature is switched off mid-run", async () => {
    const { menu, admin } = await seed();
    const provider = new FakeAgentProvider();
    const { run } = await askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
      config: ENABLED,
      provider,
    });

    await expect(
      refreshMenuManagerRun(db, admin, { menuPublicId: menu.publicId, runPublicId: run.publicId }, {
        config: readAgentConfig({}),
        provider,
        now: () => new Date(Date.now() + ENABLED.pollIntervalMs + 1),
      }),
    ).resolves.toMatchObject({ status: "running", waitingOn: "service_unavailable" });
    expect(provider.getRunCalls).toHaveLength(0);
  });

  it("leaves normal menu editing working while a run is active", async () => {
    const { quotes, menu, admin, adminMembership } = await seed();
    await askMenuManager(db, admin, { menuPublicId: menu.publicId, idempotencyKey: key() }, {
      config: ENABLED,
      provider: new FakeAgentProvider(),
    });

    const updated = await updateDraftMenu(db, quotes.tenant.id, adminMembership, menu.publicId, {
      expectedVersion: menu.version,
      internalName: "breakfast-and-brunch",
    });
    expect(updated.version).toBe(menu.version + 1);
  });
});
