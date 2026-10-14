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
import { readAgentConfig } from "@/lib/agents/config";
import { FakeQosModel } from "@/lib/ai/model/fake-qos-model";
import {
  claimNextAiJob,
  finishAiJobStep,
  markAiJobDispatched,
} from "@/lib/ai/jobs/ai-job-queue";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { createCatalogueTranslationJobHandler } from "@/lib/catalogue/translation-review/catalogue-translation-job";
import {
  acceptCatalogueTranslation,
  rejectCatalogueTranslation,
  requestCatalogueTranslation,
  resolveCaller,
} from "@/lib/catalogue/translation-review/service";
import { createDraftProduct } from "@/lib/catalogue/products";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const AGENT_ENV = {
  AGENTS_ENABLED: "true",
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  AGENT_OPENAI_TASK_MODEL_ALLOWLIST: "catalogue.translation=fake-model",
  NODE_ENV: "test",
};

const CONFIG = readAgentConfig(AGENT_ENV);
const LIMITS = { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 };

function translationSpendPolicy(overrides: Record<string, string> = {}) {
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
    ...overrides,
  });
}

function validTranslationJson(displayName: string, description: string | null) {
  return JSON.stringify({
    schema: "qos.catalogue_translation_result.v1",
    displayName,
    description,
  });
}

integrationDescribe("catalogue translation review (FIXTURE)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.ai_job_attempts, qos.ai_jobs, qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.agent_run_inputs, qos.agent_runs, qos.tenant_audit_events, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  }, 120_000);

  async function seedProduct() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const subject = "editor@test";
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "user" })
      .returning();
    await db.insert(staffLocationScopes).values({
      tenantId,
      staffMembershipId: membership!.id,
      locationId: quotes.location.id,
    });
    const product = await createDraftProduct(
      db,
      tenantId,
      { membershipId: membership!.id, role: "user", staffIdentityId: identity!.id },
      {
        internalName: "latte",
        translations: {
          en: { displayName: "Latte", description: "House espresso and milk." },
          ar: { displayName: "لاتيه", description: "حليب واسبريسو." },
        },
        defaultVariant: { amountMinor: 1800, currency: "AED" },
      },
    );
    const caller = await resolveCaller(db, tenantId, subject);
    return { tenantId, product, caller };
  }

  async function runWorker(model: FakeQosModel) {
    const handler = createCatalogueTranslationJobHandler(db, { config: CONFIG, model });
    return runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, {
        workerId: "worker-test",
        jobKinds: ["catalogue.translation.run"],
        limits: LIMITS,
      });
      if (!job) {
        return null;
      }
      const result = await handler.step(job, {
        markDispatched: () => markAiJobDispatched(db, job),
        leaseLost: () => false,
      });
      await finishAiJobStep(db, job, result);
      return result;
    });
  }

  it("EN→AR: completes with provenance and accept creates draft without approval", async () => {
    const { tenantId, product, caller } = await seedProduct();
    const model = new FakeQosModel().script({
      type: "completed",
      text: validTranslationJson("لاتيه محضّر", "اسبريسو مع حليب."),
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
        { env: AGENT_ENV, config: CONFIG, spendPolicy: translationSpendPolicy() },
      ),
    );
    expect(run.status).toBe("queued");
    await runWorker(model);

    const [completed] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    expect(completed?.status).toBe("completed");
    expect(completed?.result).toMatchObject({
      schema: "qos.catalogue_translation_result.v1",
      displayName: "لاتيه محضّر",
      promptVersion: "catalogue_translation_prompt.v1",
    });

    const before = await db
      .select()
      .from(catalogueProductTranslations)
      .where(
        and(
          eq(catalogueProductTranslations.tenantId, tenantId),
          eq(catalogueProductTranslations.locale, "ar"),
        ),
      );
    const arBefore = before[0]!;

    const accepted = await runAsRole(sqlClient, "qos_app", () =>
      acceptCatalogueTranslation(db, caller, product.publicId, {
        runPublicId: run.publicId,
        displayName: "لاتيه محضّر",
        description: "اسبريسو مع حليب.",
        expectedTargetTranslationVersion: arBefore.translationVersion,
      }),
    );
    expect(accepted.idempotentReplay).toBe(false);

    const after = await db
      .select()
      .from(catalogueProductTranslations)
      .where(
        and(
          eq(catalogueProductTranslations.tenantId, tenantId),
          eq(catalogueProductTranslations.locale, "ar"),
        ),
      );
    expect(after[0]).toMatchObject({
      displayName: "لاتيه محضّر",
      approvalStatus: "draft",
      provenance: "ai_generated",
      translationVersion: arBefore.translationVersion + 1,
    });

    const replay = await runAsRole(sqlClient, "qos_app", () =>
      acceptCatalogueTranslation(db, caller, product.publicId, {
        runPublicId: run.publicId,
        displayName: "لاتيه محضّر",
        description: "اسبريسو مع حليب.",
        expectedTargetTranslationVersion: arBefore.translationVersion,
      }),
    );
    expect(replay.idempotentReplay).toBe(true);
  }, 120_000);

  it("reject leaves product translations unchanged", async () => {
    const { tenantId, product, caller } = await seedProduct();
    const model = new FakeQosModel().script({
      type: "completed",
      text: validTranslationJson("Latte drink", "Milk coffee."),
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
        { env: AGENT_ENV, config: CONFIG, spendPolicy: translationSpendPolicy() },
      ),
    );
    await runWorker(model);

    const before = await db
      .select()
      .from(catalogueProductTranslations)
      .where(eq(catalogueProductTranslations.tenantId, tenantId));

    await runAsRole(sqlClient, "qos_app", () =>
      rejectCatalogueTranslation(db, caller, product.publicId, { runPublicId: run.publicId }),
    );

    const after = await db
      .select()
      .from(catalogueProductTranslations)
      .where(eq(catalogueProductTranslations.tenantId, tenantId));
    expect(after).toEqual(before);
    const [decision] = await db.select().from(agentRunCatalogueTranslationDecisions);
    expect(decision?.decision).toBe("rejected");
  }, 120_000);

  it("gate disabled creates no spend reservation or provider job", async () => {
    const { product, caller } = await seedProduct();
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
          { env: AGENT_ENV, config: CONFIG, spendPolicy: readAiSpendPolicy({}) },
        ),
      ),
    ).rejects.toMatchObject({ code: "spend_policy_unset" });

    expect(await db.select().from(aiSpendReservations)).toEqual([]);
    expect(await db.select().from(aiJobs)).toEqual([]);
  }, 120_000);

  it("rejects fabricated nutrition in model output", async () => {
    const { product, caller } = await seedProduct();
    const model = new FakeQosModel().script({
      type: "completed",
      text: validTranslationJson("Latte", "Only 50 kcal"),
      usage: { total_tokens: 2 },
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
        { env: AGENT_ENV, config: CONFIG, spendPolicy: translationSpendPolicy() },
      ),
    );
    await runWorker(model);
    const [failed] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    expect(failed?.status).toBe("failed");
  }, 120_000);
});
