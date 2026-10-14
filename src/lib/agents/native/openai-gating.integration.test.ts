import { randomBytes } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { aiSpendReservations, staffIdentities, staffLocationScopes, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { loadPinnedRunInput } from "@/lib/agents/agent-runs";
import { agentRuns } from "@/db/schema";
import { askMenuManager } from "@/lib/agents/menu-manager/menu-manager-service";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { reserveAiSpend } from "@/lib/ai/spend/spend-admission";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { withTenantContext } from "@/lib/tenant/context";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { readAgentConfig } from "@/lib/agents/config";
import { AiSpendAdmissionError } from "@/lib/ai/spend/spend-admission";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const NATIVE = readAgentConfig({
  AGENTS_ENABLED: "true",
  AGENT_MENU_MANAGER_ENABLED: "true",
  AGENT_MENU_MANAGER_EXECUTION_MODE: "queued_worker",
  AGENT_MENU_MANAGER_EXECUTOR: "native",
});

function spendPolicy(overrides: Record<string, string> = {}) {
  return readAiSpendPolicy({
    AI_SPEND_PLATFORM_CONCURRENCY: "10",
    AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
    AI_SPEND_MENU_MANAGER_NATIVE_ENABLED: "true",
    AI_SPEND_MENU_MANAGER_NATIVE_MAX_UNITS_PER_RUN: "1",
    AI_SPEND_MENU_MANAGER_NATIVE_TENANT_DAILY_UNITS: "10",
    AI_SPEND_MENU_MANAGER_NATIVE_TENANT_MONTHLY_UNITS: "100",
    AI_SPEND_MENU_MANAGER_NATIVE_TENANT_CONCURRENCY: "1",
    AI_SPEND_MENU_MANAGER_NATIVE_PLATFORM_DAILY_UNITS: "20",
    AI_SPEND_MENU_MANAGER_NATIVE_PLATFORM_MONTHLY_UNITS: "100",
    AI_SPEND_MENU_MANAGER_NATIVE_UNSTARTED_EXPIRY_MS: "600000",
    ...overrides,
  });
}

const MOCK_ENV = {
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  NODE_ENV: "test",
};

integrationDescribe("OpenAI native gating (QOS-28)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.agent_run_inputs, qos.agent_runs, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  it("refuses admission when spend policy is unset without creating reservations", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin@test", email: "admin@test" })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId: quotes.tenant.id, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({
      tenantId: quotes.tenant.id,
      staffMembershipId: membership!.id,
      locationId: quotes.location.id,
    });
    const caller = {
      tenantId: quotes.tenant.id,
      subject: "admin@test",
      membership: await runAsRole(sqlClient, "qos_app", () =>
        requireActiveStaffMembership(db, quotes.tenant.id, "admin@test"),
      ),
    };
    const product = await createDraftProduct(db, quotes.tenant.id, { membershipId: membership!.id, role: "administrator", staffIdentityId: identity!.id }, {
      internalName: "latte",
      translations: { en: { displayName: "Latte", description: "d" }, ar: { displayName: "l", description: "w" } },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const menu = await createDraftMenu(db, quotes.tenant.id, { membershipId: membership!.id, role: "administrator", staffIdentityId: identity!.id }, {
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

    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        askMenuManager(
          db,
          caller,
          { menuPublicId: menu.publicId, idempotencyKey: `idem-${randomBytes(4).toString("hex")}` },
          { config: NATIVE, env: MOCK_ENV, spendPolicy: readAiSpendPolicy({}) },
        ),
      ),
    ).rejects.toBeInstanceOf(AiSpendAdmissionError);

    expect(await db.select().from(aiSpendReservations)).toEqual([]);
  });

  it("cannot bypass tenant concurrency with parallel reservations", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const policy = spendPolicy();
    const actor = { subject: "qos.test", actorClass: "system" as const };
    const first = await runAsRole(sqlClient, "qos_app", () =>
      withTenantContext(db, quotes.tenant.id, (tx) =>
        reserveAiSpend(
          tx,
          {
            tenantId: quotes.tenant.id,
            path: "menu_manager.native",
            provider: "openai",
            subjectType: "agent_run",
            subjectPublicId: "run_a",
            units: 1,
            requestedBy: actor,
          },
          { policy, now: new Date("2026-10-03T12:00:00.000Z") },
        ),
      ),
    );
    expect(first.reservation.state).toBe("reserved");
    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        withTenantContext(db, quotes.tenant.id, (tx) =>
          reserveAiSpend(
            tx,
            {
              tenantId: quotes.tenant.id,
              path: "menu_manager.native",
              provider: "openai",
              subjectType: "agent_run",
              subjectPublicId: "run_b",
              units: 1,
              requestedBy: actor,
            },
            { policy, now: new Date("2026-10-03T12:00:00.000Z") },
          ),
        ),
      ),
    ).rejects.toMatchObject({ code: "tenant_concurrency_limit" });
  });

  it("does not let one tenant read another tenant pinned run input", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin@test", email: "admin@test" })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId: quotes.tenant.id, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({
      tenantId: quotes.tenant.id,
      staffMembershipId: membership!.id,
      locationId: quotes.location.id,
    });
    const caller = {
      tenantId: quotes.tenant.id,
      subject: "admin@test",
      membership: await runAsRole(sqlClient, "qos_app", () =>
        requireActiveStaffMembership(db, quotes.tenant.id, "admin@test"),
      ),
    };
    const product = await createDraftProduct(db, quotes.tenant.id, { membershipId: membership!.id, role: "administrator", staffIdentityId: identity!.id }, {
      internalName: "latte",
      translations: { en: { displayName: "Latte", description: "d" }, ar: { displayName: "l", description: "w" } },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const menu = await createDraftMenu(db, quotes.tenant.id, { membershipId: membership!.id, role: "administrator", staffIdentityId: identity!.id }, {
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

    await runAsRole(sqlClient, "qos_app", () =>
      askMenuManager(
        db,
        caller,
        { menuPublicId: menu.publicId, idempotencyKey: `idem-${randomBytes(4).toString("hex")}` },
        { config: NATIVE, env: MOCK_ENV, spendPolicy: spendPolicy() },
      ),
    );
    const [runRow] = await db.select().from(agentRuns);
    const crossTenant = await runAsRole(sqlClient, "qos_app", () =>
      loadPinnedRunInput(db, flowers.tenant.id, runRow!.id),
    );
    expect(crossTenant).toEqual({ ok: false, reason: "missing" });
  });
});
