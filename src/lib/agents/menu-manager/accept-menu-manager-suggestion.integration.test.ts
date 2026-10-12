import { randomBytes } from "node:crypto";

import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  catalogueMenuLiveRevisions,
  catalogueProductTranslations,
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
import { acceptMenuManagerSuggestion } from "@/lib/agents/menu-manager/accept-menu-manager-suggestion";
import { readAgentConfig } from "@/lib/agents/config";
import { parseAgentCredentialKey } from "@/lib/agents/credential-crypto";
import { MENU_MANAGER_RESULT_SCHEMA } from "@/lib/agents/menu-manager/menu-manager-result";
import { askMenuManager, refreshMenuManagerRun } from "@/lib/agents/menu-manager/menu-manager-service";
import { saveAgentProviderConnection } from "@/lib/agents/provider-connections";
import {
  approveTenantAgentBinding,
  setTenantAgentBindingEnabled,
} from "@/lib/agents/tenant-agent-bindings";
import { FakeAgentProvider } from "@/lib/agents/testing/fake-agent-provider";
import { createDraftMenu, updateDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct, getDraftProduct } from "@/lib/catalogue/products";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const APPROVED_AGENT_ID = "cmun4w730017807adjrkbep1t";
const ENABLED = readAgentConfig({
  AGENTS_ENABLED: "true",
  AGENT_MENU_MANAGER_ENABLED: "true",
  AGENT_MENU_MANAGER_EXECUTOR: "hyperagent",
});

integrationDescribe("acceptMenuManagerSuggestion", () => {
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

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const adminSubject = "admin.quotes@test";
    const admin = await seedMember(quotes.tenant.id, [quotes.location.id], "administrator", adminSubject);
    const staffSubject = "barista.quotes@test";
    const staff = await seedMember(quotes.tenant.id, [quotes.location.id], "user", staffSubject);
    const unscoped = await seedMember(quotes.tenant.id, [], "user", "unscoped.quotes@test");

    const product = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "latte",
      translations: {
        en: { displayName: "latte", description: "latte description" },
        ar: { displayName: "latte ar", description: "وصف" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
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
      tenantId: quotes.tenant.id,
      capability: "menu_manager",
      provider: "hyperagent",
      providerAgentId: APPROVED_AGENT_ID,
      approvedBySubject: "operator:platform",
    });
    await setTenantAgentBindingEnabled(db, quotes.tenant.id, adminSubject, "menu_manager", {
      enabled: true,
      expectedVersion: binding.version,
    });
    await saveAgentProviderConnection(db, {
      provider: "hyperagent",
      serverUrl: "https://hyperagent.example/api/mcp",
      connectedBySubject: "operator:test",
      credentialKey: parseAgentCredentialKey(randomBytes(32).toString("base64")),
      credentials: { tokens: { access_token: "unused" } },
    });

    const caller = (subject: string, membership: typeof admin) => ({
      tenantId: quotes.tenant.id,
      subject,
      membership,
    });

    return {
      quotes,
      menu,
      product,
      admin: caller(adminSubject, admin),
      staff: caller(staffSubject, staff),
      unscoped: caller("unscoped.quotes@test", unscoped),
      adminMembership: admin,
    };
  }

  function suggestionReply(menuPublicId: string, productPublicId: string, proposedText: string) {
    return JSON.stringify({
      schema: MENU_MANAGER_RESULT_SCHEMA,
      menuPublicId,
      summary: "Tighten the latte copy.",
      findings: [],
      suggestions: [
        {
          productPublicId,
          field: "description_en",
          proposedText,
          rationale: "The current line is generic.",
        },
      ],
    });
  }

  async function completeReview(
    caller: Awaited<ReturnType<typeof seed>>["admin"],
    menuPublicId: string,
    productPublicId: string,
    proposedText: string,
  ) {
    const provider = new FakeAgentProvider().script({
      state: "completed",
      finalMessage: suggestionReply(menuPublicId, productPublicId, proposedText),
    });
    const asked = await askMenuManager(
      db,
      caller,
      { menuPublicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
      { config: ENABLED, provider },
    );
    const run = await refreshMenuManagerRun(
      db,
      caller,
      { menuPublicId, runPublicId: asked.run.publicId },
      { config: ENABLED, provider, now: () => new Date(Date.now() + ENABLED.pollIntervalMs + 1) },
    );
    expect(run.status).toBe("completed");
    return run;
  }

  it("writes one accepted suggestion onto the product draft and does not publish", async () => {
    const { quotes, menu, product, staff } = await seed();
    const proposedText = "A smooth espresso with steamed milk.";
    const run = await completeReview(staff, menu.publicId, product.publicId, proposedText);

    const accepted = await runAsRole(sqlClient, "qos_app", () =>
      acceptMenuManagerSuggestion(db, staff, {
        menuPublicId: menu.publicId,
        runPublicId: run.publicId,
        productPublicId: product.publicId,
        field: "description_en",
        proposedText,
      }),
    );

    expect(accepted.product.translations.en.description).toBe(proposedText);
    expect(accepted.product.translations.en.displayName).toBe("latte");
    expect(accepted.applied).toEqual({
      productPublicId: product.publicId,
      field: "description_en",
      proposedText,
    });

    const live = await db
      .select({ id: catalogueMenuLiveRevisions.id })
      .from(catalogueMenuLiveRevisions)
      .where(eq(catalogueMenuLiveRevisions.tenantId, quotes.tenant.id));
    expect(live).toEqual([]);

    const audit = await db
      .select({ action: tenantAuditEvents.action, changeSummary: tenantAuditEvents.changeSummary })
      .from(tenantAuditEvents)
      .where(eq(tenantAuditEvents.action, "catalogue.menu_manager.suggestion_accepted"));
    expect(audit).toEqual([
      {
        action: "catalogue.menu_manager.suggestion_accepted",
        changeSummary: {
          menuPublicId: menu.publicId,
          runPublicId: run.publicId,
          field: "description_en",
          locale: "en",
        },
      },
    ]);
  });

  it("rejects a review after the menu draft version moves on", async () => {
    const { menu, product, staff, adminMembership, quotes } = await seed();
    const proposedText = "A smooth espresso with steamed milk.";
    const run = await completeReview(staff, menu.publicId, product.publicId, proposedText);
    await updateDraftMenu(db, quotes.tenant.id, adminMembership, menu.publicId, {
      expectedVersion: menu.version,
      internalName: "breakfast-and-brunch",
    });

    await expect(
      acceptMenuManagerSuggestion(db, staff, {
        menuPublicId: menu.publicId,
        runPublicId: run.publicId,
        productPublicId: product.publicId,
        field: "description_en",
        proposedText,
      }),
    ).rejects.toMatchObject({ code: "review_outdated", statusCode: 409 });

    const current = await getDraftProduct(db, quotes.tenant.id, staff.membership, product.publicId);
    expect(current.translations.en.description).toBe("latte description");
  });

  it("rejects callers without menu location access and unfinished reviews", async () => {
    const { menu, product, staff, unscoped } = await seed();
    const proposedText = "A smooth espresso with steamed milk.";
    const provider = new FakeAgentProvider().script({ state: "running" });
    const asked = await askMenuManager(
      db,
      staff,
      { menuPublicId: menu.publicId, idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
      { config: ENABLED, provider },
    );

    await expect(
      acceptMenuManagerSuggestion(db, staff, {
        menuPublicId: menu.publicId,
        runPublicId: asked.run.publicId,
        productPublicId: product.publicId,
        field: "description_en",
        proposedText,
      }),
    ).rejects.toMatchObject({ code: "run_not_completed", statusCode: 409 });

    provider.script({
      state: "completed",
      finalMessage: suggestionReply(menu.publicId, product.publicId, proposedText),
    });
    const completed = await refreshMenuManagerRun(
      db,
      staff,
      { menuPublicId: menu.publicId, runPublicId: asked.run.publicId },
      { config: ENABLED, provider, now: () => new Date(Date.now() + ENABLED.pollIntervalMs + 1) },
    );
    expect(completed.status).toBe("completed");

    await expect(
      acceptMenuManagerSuggestion(db, unscoped, {
        menuPublicId: menu.publicId,
        runPublicId: completed.publicId,
        productPublicId: product.publicId,
        field: "description_en",
        proposedText,
      }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("leaves other translation fields untouched", async () => {
    const { quotes, menu, product, staff } = await seed();
    const translations = await db
      .select({
        locale: catalogueProductTranslations.locale,
        description: catalogueProductTranslations.description,
        displayName: catalogueProductTranslations.displayName,
      })
      .from(catalogueProductTranslations)
      .where(eq(catalogueProductTranslations.tenantId, quotes.tenant.id));

    const run = await completeReview(staff, menu.publicId, product.publicId, "House latte copy.");
    await acceptMenuManagerSuggestion(db, staff, {
      menuPublicId: menu.publicId,
      runPublicId: run.publicId,
      productPublicId: product.publicId,
      field: "description_en",
      proposedText: "House latte copy.",
    });

    const after = await db
      .select({
        locale: catalogueProductTranslations.locale,
        description: catalogueProductTranslations.description,
        displayName: catalogueProductTranslations.displayName,
      })
      .from(catalogueProductTranslations)
      .where(eq(catalogueProductTranslations.tenantId, quotes.tenant.id));

    const english = after.find((row) => row.locale === "en");
    const arabic = after.find((row) => row.locale === "ar");
    expect(english?.description).toBe("House latte copy.");
    expect(english?.displayName).toBe(translations.find((row) => row.locale === "en")?.displayName);
    expect(arabic).toEqual(translations.find((row) => row.locale === "ar"));
  });
});
