import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  agentRunCatalogueTranslationDecisions,
  agentRuns,
  aiJobs,
  aiSpendReservations,
  catalogueProductTranslations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { loadPinnedRunInput } from "@/lib/agents/agent-runs";
import { askMenuManager } from "@/lib/agents/menu-manager/menu-manager-service";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { reserveAiSpend } from "@/lib/ai/spend/spend-admission";
import {
  claimNextAiJob,
  finishAiJobStep,
  markAiJobDispatched,
} from "@/lib/ai/jobs/ai-job-queue";
import { FakeQosModel } from "@/lib/ai/model/fake-qos-model";
import { createCatalogueTranslationJobHandler } from "@/lib/catalogue/translation-review/catalogue-translation-job";
import {
  acceptCatalogueTranslation,
  rejectCatalogueTranslation,
  requestCatalogueTranslation,
  resolveCaller,
} from "@/lib/catalogue/translation-review/service";
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
  AGENT_OPENAI_TASK_MODEL_ALLOWLIST: "menu_manager.native=fake-model,catalogue.translation=fake-model",
  NODE_ENV: "test",
};

const TRANSLATION_CONFIG = readAgentConfig({
  AGENTS_ENABLED: "true",
});

function translationSpendPolicy() {
  return readAiSpendPolicy({
    AI_SPEND_PLATFORM_CONCURRENCY: "10",
    AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
    AI_SPEND_CATALOGUE_TRANSLATION_ENABLED: "true",
    AI_SPEND_CATALOGUE_TRANSLATION_MAX_UNITS_PER_RUN: "1",
    AI_SPEND_CATALOGUE_TRANSLATION_TENANT_DAILY_UNITS: "10",
    AI_SPEND_CATALOGUE_TRANSLATION_TENANT_MONTHLY_UNITS: "100",
    AI_SPEND_CATALOGUE_TRANSLATION_TENANT_CONCURRENCY: "10",
    AI_SPEND_CATALOGUE_TRANSLATION_PLATFORM_DAILY_UNITS: "20",
    AI_SPEND_CATALOGUE_TRANSLATION_PLATFORM_MONTHLY_UNITS: "100",
    AI_SPEND_CATALOGUE_TRANSLATION_UNSTARTED_EXPIRY_MS: "600000",
  });
}

function translationResultJson(displayName: string, description: string | null) {
  return JSON.stringify({
    schema: "qos.catalogue_translation_result.v1",
    displayName,
    description,
  });
}

integrationDescribe("OpenAI native gating (QOS-28)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.agent_run_inputs, qos.agent_runs, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function clearTranslationJobs() {
    await sqlClient`TRUNCATE TABLE qos.ai_job_attempts, qos.ai_jobs RESTART IDENTITY CASCADE`;
  }

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

  it("catalogue.translation (FIXTURE): accept writes draft without approval", async () => {
    await clearTranslationJobs();
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const subject = "editor@test";
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId: quotes.tenant.id, staffIdentityId: identity!.id, role: "user" })
      .returning();
    await db.insert(staffLocationScopes).values({
      tenantId: quotes.tenant.id,
      staffMembershipId: membership!.id,
      locationId: quotes.location.id,
    });
    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      { membershipId: membership!.id, role: "user", staffIdentityId: identity!.id },
      {
        internalName: "latte",
        translations: {
          en: { displayName: "Latte", description: "House espresso and milk." },
          ar: { displayName: "لاتيه", description: "حليب." },
        },
        defaultVariant: { amountMinor: 1800, currency: "AED" },
      },
    );
    const caller = await resolveCaller(db, quotes.tenant.id, subject);
    const model = new FakeQosModel().script({
      type: "completed",
      text: translationResultJson("لاتيه محضّر", "اسبريسو مع حليب."),
      usage: { total_tokens: 4 },
    });

    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      requestCatalogueTranslation(
        db,
        caller,
        product.publicId,
        {
          sourceLocale: "en",
          targetLocale: "ar",
          idempotencyKey: `idem-${randomBytes(6).toString("hex")}`,
        },
        { env: MOCK_ENV, config: TRANSLATION_CONFIG, spendPolicy: translationSpendPolicy() },
      ),
    );

    const handler = createCatalogueTranslationJobHandler(db, { config: TRANSLATION_CONFIG, model });
    await runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, {
        workerId: "worker-test",
        jobKinds: ["catalogue.translation.run"],
        limits: { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 },
      });
      expect(job).toBeTruthy();
      const result = await handler.step(job!, {
        markDispatched: () => markAiJobDispatched(db, job!),
        leaseLost: () => false,
      });
      await finishAiJobStep(db, job!, result);
    });

    const [completed] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    expect(completed?.status).toBe("completed");

    const [arBefore] = await db
      .select()
      .from(catalogueProductTranslations)
      .where(
        and(
          eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
          eq(catalogueProductTranslations.locale, "ar"),
        ),
      );

    await runAsRole(sqlClient, "qos_app", () =>
      acceptCatalogueTranslation(db, caller, product.publicId, {
        runPublicId: run.publicId,
        displayName: "لاتيه محضّر",
        description: "اسبريسو مع حليب.",
        expectedTargetTranslationVersion: arBefore!.translationVersion,
      }),
    );

    const [arAfter] = await db
      .select()
      .from(catalogueProductTranslations)
      .where(
        and(
          eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
          eq(catalogueProductTranslations.locale, "ar"),
        ),
      );
    expect(arAfter).toMatchObject({
      displayName: "لاتيه محضّر",
      approvalStatus: "draft",
      provenance: "ai_generated",
    });
  }, 60_000);

  it("catalogue.translation (FIXTURE): gate disabled creates no spend reservation", async () => {
    await clearTranslationJobs();
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const subject = "admin-gate@test";
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
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
    const caller = await resolveCaller(db, quotes.tenant.id, subject);
    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      { membershipId: membership!.id, role: "administrator", staffIdentityId: identity!.id },
      {
        internalName: "x",
        translations: { en: { displayName: "X", description: null }, ar: { displayName: "y", description: null } },
        defaultVariant: { amountMinor: 100, currency: "AED" },
      },
    );

    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        requestCatalogueTranslation(
          db,
          caller,
          product.publicId,
          {
            sourceLocale: "en",
            targetLocale: "ar",
            idempotencyKey: `idem-${randomBytes(6).toString("hex")}`,
          },
          { env: MOCK_ENV, config: TRANSLATION_CONFIG, spendPolicy: readAiSpendPolicy({}) },
        ),
      ),
    ).rejects.toMatchObject({ code: "spend_policy_unset" });
    expect(await db.select().from(aiSpendReservations)).toEqual([]);
    expect(await db.select().from(aiJobs)).toEqual([]);
  }, 60_000);

  it("catalogue.translation (FIXTURE): reject leaves translations unchanged", async () => {
    await clearTranslationJobs();
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const subject = "editor2@test";
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId: quotes.tenant.id, staffIdentityId: identity!.id, role: "user" })
      .returning();
    await db.insert(staffLocationScopes).values({
      tenantId: quotes.tenant.id,
      staffMembershipId: membership!.id,
      locationId: quotes.location.id,
    });
    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      { membershipId: membership!.id, role: "user", staffIdentityId: identity!.id },
      {
        internalName: "tea",
        translations: {
          en: { displayName: "Tea", description: "Hot." },
          ar: { displayName: "شاي", description: "ساخن." },
        },
        defaultVariant: { amountMinor: 500, currency: "AED" },
      },
    );
    const caller = await resolveCaller(db, quotes.tenant.id, subject);
    const model = new FakeQosModel().script({
      type: "completed",
      text: translationResultJson("Tea", "Hot drink."),
      usage: { total_tokens: 2 },
    });
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      requestCatalogueTranslation(
        db,
        caller,
        product.publicId,
        {
          sourceLocale: "ar",
          targetLocale: "en",
          idempotencyKey: `idem-${randomBytes(6).toString("hex")}`,
        },
        { env: MOCK_ENV, config: TRANSLATION_CONFIG, spendPolicy: translationSpendPolicy() },
      ),
    );
    const handler = createCatalogueTranslationJobHandler(db, { config: TRANSLATION_CONFIG, model });
    await runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, {
        workerId: "worker-test",
        jobKinds: ["catalogue.translation.run"],
        limits: { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 },
      });
      const result = await handler.step(job!, {
        markDispatched: () => markAiJobDispatched(db, job!),
        leaseLost: () => false,
      });
      await finishAiJobStep(db, job!, result);
    });

    const before = await db
      .select()
      .from(catalogueProductTranslations)
      .where(eq(catalogueProductTranslations.tenantId, quotes.tenant.id));
    await runAsRole(sqlClient, "qos_app", () =>
      rejectCatalogueTranslation(db, caller, product.publicId, { runPublicId: run.publicId }),
    );
    const after = await db
      .select()
      .from(catalogueProductTranslations)
      .where(eq(catalogueProductTranslations.tenantId, quotes.tenant.id));
    expect(after).toEqual(before);
    const [decision] = await db.select().from(agentRunCatalogueTranslationDecisions);
    expect(decision?.decision).toBe("rejected");
  }, 60_000);
});
