import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  agentRunCatalogueTranslationDecisions,
  agentRuns,
  aiJobAttempts,
  aiJobs,
  aiSpendReservations,
  catalogueProductTranslations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { readAgentConfig } from "@/lib/agents/config";
import { createCatalogueTranslationJobHandler } from "@/lib/catalogue/translation-review/catalogue-translation-job";
import { CATALOGUE_TRANSLATION_PROMPT_VERSION } from "@/lib/catalogue/translation-review/prompt";
import { TRANSLATION_RESULT_SCHEMA } from "@/lib/catalogue/translation-review/result";
import {
  acceptCatalogueTranslation,
  cancelCatalogueTranslation,
  CATALOGUE_TRANSLATION_JOB_KIND,
  getLatestTranslationReview,
  rejectCatalogueTranslation,
  requestCatalogueTranslation,
} from "@/lib/catalogue/translation-review/service";
import { FakeQosModel } from "@/lib/ai/model/fake-qos-model";
import {
  claimNextAiJob,
  finishAiJobStep,
  markAiJobDispatched,
  type ClaimedAiJob,
} from "@/lib/ai/jobs/ai-job-queue";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { createDraftProduct, getDraftProduct, updateDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { requireActiveStaffMembership, StaffAuthorizationError } from "@/lib/staff/auth";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import type { CreateTenantHierarchyInput } from "@/lib/tenant/types";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN_SUBJECT = "admin.quotes@test";
const STAFF_SUBJECT = "staff.quotes@test";

const NATIVE_ENV: Record<string, string> = {
  AGENTS_ENABLED: "true",
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  AGENT_OPENAI_TASK_MODEL_ALLOWLIST: "catalogue.translation=fake-model",
  NODE_ENV: "test",
};

const CONFIG = readAgentConfig({
  AGENTS_ENABLED: "true",
});

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

function modelReply(displayName: string, description: string | null) {
  return JSON.stringify({
    schema: TRANSLATION_RESULT_SCHEMA,
    displayName,
    description,
  });
}

integrationDescribe("catalogue translation review (DB)", () => {
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
    if (sqlClient) {
      await sqlClient.end({ timeout: 5 });
    }
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.agent_run_catalogue_translation_decisions, qos.ai_job_attempts, qos.ai_jobs, qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.agent_run_inputs, qos.agent_runs, qos.tenant_audit_events, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(
    tenantId: string,
    locationId: string,
    role: "administrator" | "user",
    subject: string,
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role })
      .returning();
    await db.insert(staffLocationScopes).values({
      tenantId,
      staffMembershipId: membership!.id,
      locationId,
    });
    return {
      membershipId: membership!.id,
      role,
      staffIdentityId: identity!.id,
    };
  }

  async function seedTenant(
    adminSubject = ADMIN_SUBJECT,
    fixture: CreateTenantHierarchyInput = quotesTenantFixture(),
  ) {
    const quotes = await createTenantHierarchy(db, fixture);
    const adminMembership = await seedMember(
      quotes.tenant.id,
      quotes.location.id,
      "administrator",
      adminSubject,
    );
    const staffMembership = await seedMember(
      quotes.tenant.id,
      quotes.location.id,
      "user",
      STAFF_SUBJECT,
    );
    const product = await createDraftProduct(db, quotes.tenant.id, adminMembership, {
      internalName: "latte",
      translations: {
        en: { displayName: "Latte", description: "Smooth espresso with milk." },
        ar: { displayName: "لاتيه", description: "إسبريسو مع حليب." },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const adminCaller = {
      tenantId: quotes.tenant.id,
      subject: adminSubject,
      membership: await runAsRole(sqlClient, "qos_app", () =>
        requireActiveStaffMembership(db, quotes.tenant.id, adminSubject),
      ),
    };
    const staffCaller = {
      tenantId: quotes.tenant.id,
      subject: STAFF_SUBJECT,
      membership: staffMembership,
    };
    return { quotes, product, adminCaller, staffCaller, adminMembership };
  }

  function request(
    caller: Awaited<ReturnType<typeof seedTenant>>["adminCaller"],
    productPublicId: string,
    sourceLocale: "en" | "ar",
    targetLocale: "en" | "ar",
    options: {
      env?: Record<string, string>;
      spendPolicy?: ReturnType<typeof translationSpendPolicy>;
    } = {},
  ) {
    return runAsRole(sqlClient, "qos_app", () =>
      requestCatalogueTranslation(
        db,
        caller,
        productPublicId,
        {
          sourceLocale,
          targetLocale,
          idempotencyKey: `idem-${randomBytes(6).toString("hex")}`,
        },
        {
          config: CONFIG,
          spendPolicy: options.spendPolicy ?? translationSpendPolicy(),
          env: options.env ?? NATIVE_ENV,
        },
      ),
    );
  }

  async function workerStep(model: FakeQosModel) {
    const handler = createCatalogueTranslationJobHandler(db, { config: CONFIG, model });
    return runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, {
        workerId: "worker-test",
        jobKinds: [CATALOGUE_TRANSLATION_JOB_KIND],
        limits: LIMITS,
      });
      if (!job) {
        return null;
      }
      const result = await handler.step(job as ClaimedAiJob, {
        markDispatched: () => markAiJobDispatched(db, job),
        leaseLost: () => false,
      });
      await finishAiJobStep(db, job, result);
      return { job, result };
    });
  }

  async function completeRun(
    caller: Awaited<ReturnType<typeof seedTenant>>["adminCaller"],
    productPublicId: string,
    sourceLocale: "en" | "ar",
    targetLocale: "en" | "ar",
    suggestion: { displayName: string; description: string | null },
  ) {
    const model = new FakeQosModel().script({
      type: "completed",
      text: modelReply(suggestion.displayName, suggestion.description),
      usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 },
    });
    const { run } = await request(caller, productPublicId, sourceLocale, targetLocale);
    expect(run.status).toBe("queued");
    const step = await workerStep(model);
    expect(step?.result).toEqual({ type: "completed" });
    const [done] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    expect(done?.status).toBe("completed");
    return { run: done!, model };
  }

  it(
    "EN→AR run stores source/target locales, model id, prompt version, and revision provenance",
    async () => {
      const { product, adminCaller } = await seedTenant();
      const suggestion = { displayName: "لاتيه محضّر", description: "إسبريسو ناعم مع حليب." };
      const { run } = await completeRun(adminCaller, product.publicId, "en", "ar", suggestion);

      const summary = run.requestSummary as Record<string, unknown>;
      expect(summary).toMatchObject({
        schema: "qos.catalogue_translation_request.v1",
        sourceLocale: "en",
        targetLocale: "ar",
        sourceTranslationVersion: 1,
        targetTranslationVersion: 1,
        modelId: "fake-model",
        promptVersion: CATALOGUE_TRANSLATION_PROMPT_VERSION,
      });

      const result = run.result as Record<string, unknown>;
      expect(result).toMatchObject({
        schema: TRANSLATION_RESULT_SCHEMA,
        displayName: suggestion.displayName,
        description: suggestion.description,
        sourceLocale: "en",
        targetLocale: "ar",
        sourceTranslationVersion: 1,
        targetTranslationVersion: 1,
        modelId: "fake-model",
        promptVersion: CATALOGUE_TRANSLATION_PROMPT_VERSION,
      });
    },
    60_000,
  );

  it(
    "AR→EN run stores locales and provenance on the run",
    async () => {
      const { product, adminCaller } = await seedTenant();
      const suggestion = { displayName: "Prepared latte", description: "Smooth espresso with milk." };
      const { run } = await completeRun(adminCaller, product.publicId, "ar", "en", suggestion);

      expect(run.requestSummary).toMatchObject({
        sourceLocale: "ar",
        targetLocale: "en",
        modelId: "fake-model",
        promptVersion: CATALOGUE_TRANSLATION_PROMPT_VERSION,
      });
      expect(run.result).toMatchObject({
        displayName: suggestion.displayName,
        sourceLocale: "ar",
        targetLocale: "en",
      });
    },
    60_000,
  );

  it(
    "accept writes ai_generated draft that is not approved and still needs QOS-16 approval",
    async () => {
      const { quotes, product, adminCaller, adminMembership } = await seedTenant();
      await approveProductTranslation(db, quotes.tenant.id, ADMIN_SUBJECT, product.publicId, "ar", {
        expectedTranslationVersion: 1,
      });

      const suggestion = { displayName: "لاتيه جديد", description: "وصف جديد." };
      const { run } = await completeRun(adminCaller, product.publicId, "en", "ar", suggestion);

      const accepted = await runAsRole(sqlClient, "qos_app", () =>
        acceptCatalogueTranslation(db, adminCaller, product.publicId, {
          runPublicId: run.publicId,
          displayName: suggestion.displayName,
          description: suggestion.description,
          expectedTargetTranslationVersion: 1,
        }),
      );
      expect(accepted.idempotentReplay).toBe(false);
      expect(accepted.review?.suggestionState).toBe("accepted");

      const [arRow] = await db
        .select()
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "ar"),
          ),
        );
      expect(arRow).toMatchObject({
        displayName: suggestion.displayName,
        description: suggestion.description,
        translationVersion: 2,
        approvalStatus: "draft",
        provenance: "ai_generated",
        approvedBySubject: null,
        approvedTranslationVersion: null,
      });
      expect(arRow!.lastApprovedTranslationVersion).toBe(1);

      const draft = await getDraftProduct(db, quotes.tenant.id, adminMembership, product.publicId);
      expect(draft.translations.ar.approvalStatus).toBe("draft");
    },
    60_000,
  );

  it(
    "reject and cancel leave product text and prior approved release unchanged",
    async () => {
      const { quotes, product, adminCaller } = await seedTenant();
      await approveProductTranslation(db, quotes.tenant.id, ADMIN_SUBJECT, product.publicId, "ar", {
        expectedTranslationVersion: 1,
      });

      const before = await db
        .select()
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "ar"),
          ),
        );

      const suggestion = { displayName: "مرفوض", description: "لا يطبق." };
      const { run: completedRun } = await completeRun(
        adminCaller,
        product.publicId,
        "en",
        "ar",
        suggestion,
      );

      await runAsRole(sqlClient, "qos_app", () =>
        rejectCatalogueTranslation(db, adminCaller, product.publicId, {
          runPublicId: completedRun.publicId,
        }),
      );

      const afterReject = await db
        .select()
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "ar"),
          ),
        );
      expect(afterReject[0]).toMatchObject({
        displayName: before[0]!.displayName,
        description: before[0]!.description,
        translationVersion: before[0]!.translationVersion,
        approvalStatus: "approved",
        approvedTranslationVersion: 1,
      });

      const { run: queuedRun } = await request(adminCaller, product.publicId, "en", "ar");
      await runAsRole(sqlClient, "qos_app", () =>
        cancelCatalogueTranslation(db, adminCaller, product.publicId, {
          runPublicId: queuedRun.publicId,
        }),
      );

      const afterCancel = await db
        .select()
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "ar"),
          ),
        );
      expect(afterCancel[0]).toEqual(afterReject[0]);
    },
    60_000,
  );

  it(
    "double accept is idempotent with one product write and one decision row",
    async () => {
      const { quotes, product, adminCaller } = await seedTenant();
      const suggestion = { displayName: "لاتيه", description: "وصف." };
      const { run } = await completeRun(adminCaller, product.publicId, "en", "ar", suggestion);
      const input = {
        runPublicId: run.publicId,
        displayName: suggestion.displayName,
        description: suggestion.description,
        expectedTargetTranslationVersion: 1,
      };

      const first = await runAsRole(sqlClient, "qos_app", () =>
        acceptCatalogueTranslation(db, adminCaller, product.publicId, input),
      );
      const second = await runAsRole(sqlClient, "qos_app", () =>
        acceptCatalogueTranslation(db, adminCaller, product.publicId, input),
      );

      const replays = [first, second].filter((result) => result.idempotentReplay);
      const writes = [first, second].filter((result) => !result.idempotentReplay);
      expect(writes).toHaveLength(1);
      expect(replays).toHaveLength(1);

      const decisions = await db
        .select()
        .from(agentRunCatalogueTranslationDecisions)
        .where(eq(agentRunCatalogueTranslationDecisions.tenantId, quotes.tenant.id));
      expect(decisions).toHaveLength(1);

      const audit = await db
        .select({ id: tenantAuditEvents.id })
        .from(tenantAuditEvents)
        .where(eq(tenantAuditEvents.action, "catalogue.translation.suggestion_accepted"));
      expect(audit).toHaveLength(1);

      const [arRow] = await db
        .select({ translationVersion: catalogueProductTranslations.translationVersion })
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "ar"),
          ),
        );
      expect(arRow?.translationVersion).toBe(2);
    },
    60_000,
  );

  it(
    "refuses accept when the target draft changed after the request",
    async () => {
      const { quotes, product, adminCaller, adminMembership } = await seedTenant();
      const suggestion = { displayName: "قديم", description: "قديم." };
      const { run } = await completeRun(adminCaller, product.publicId, "en", "ar", suggestion);

      await updateDraftProduct(
        db,
        quotes.tenant.id,
        adminMembership,
        product.publicId,
        {
          expectedVersion: 1,
          translations: {
            ar: {
              displayName: "لاتيه محدّث",
              description: "وصف محدّث",
              expectedTranslationVersion: 1,
            },
          },
        },
        ADMIN_SUBJECT,
      );

      await expect(
        runAsRole(sqlClient, "qos_app", () =>
          acceptCatalogueTranslation(db, adminCaller, product.publicId, {
            runPublicId: run.publicId,
            displayName: suggestion.displayName,
            description: suggestion.description,
            expectedTargetTranslationVersion: 2,
          }),
        ),
      ).rejects.toMatchObject({ code: "review_outdated", statusCode: 409 });

      const decisions = await db.select().from(agentRunCatalogueTranslationDecisions);
      expect(decisions).toEqual([]);

      const [arRow] = await db
        .select({ displayName: catalogueProductTranslations.displayName })
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "ar"),
          ),
        );
      expect(arRow?.displayName).toBe("لاتيه محدّث");
    },
    60_000,
  );

  it(
    "late AI completion after a newer edit does not overwrite the product draft",
    async () => {
      const { quotes, product, adminCaller, adminMembership } = await seedTenant();
      const model = new FakeQosModel().script({
        type: "completed",
        text: modelReply("اقتراح متأخر", "وصف متأخر"),
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
      const { run } = await request(adminCaller, product.publicId, "en", "ar");

      await updateDraftProduct(
        db,
        quotes.tenant.id,
        adminMembership,
        product.publicId,
        {
          expectedVersion: 1,
          translations: {
            ar: {
              displayName: "أحدث تعديل",
              description: "أحدث",
              expectedTranslationVersion: 1,
            },
          },
        },
        ADMIN_SUBJECT,
      );

      const step = await workerStep(model);
      expect(step?.result).toEqual({ type: "completed" });

      const review = await getLatestTranslationReview(db, quotes.tenant.id, product.publicId, NATIVE_ENV);
      expect(review?.suggestionState).toBe("stale");
      expect(review?.suggestion).toBeNull();

      await expect(
        runAsRole(sqlClient, "qos_app", () =>
          acceptCatalogueTranslation(db, adminCaller, product.publicId, {
            runPublicId: run.publicId,
            displayName: "اقتراح متأخر",
            description: "وصف متأخر",
            expectedTargetTranslationVersion: 2,
          }),
        ),
      ).rejects.toMatchObject({ code: "review_outdated", statusCode: 409 });

      const [arRow] = await db
        .select({ displayName: catalogueProductTranslations.displayName })
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "ar"),
          ),
        );
      expect(arRow?.displayName).toBe("أحدث تعديل");
    },
    60_000,
  );

  it(
    "tenant B cannot read or accept tenant A translation runs",
    async () => {
      const tenantA = await seedTenant();
      const tenantB = await seedTenant("admin.other@test", flowerTenantFixture());

      const { run } = await completeRun(
        tenantA.adminCaller,
        tenantA.product.publicId,
        "en",
        "ar",
        { displayName: "ب", description: null },
      );

      await expect(getAgentRunCrossTenant(tenantB.quotes.tenant.id, run.publicId)).rejects.toMatchObject({
        code: "run_not_found",
      });

      await expect(
        runAsRole(sqlClient, "qos_app", () =>
          acceptCatalogueTranslation(db, tenantB.adminCaller, tenantB.product.publicId, {
            runPublicId: run.publicId,
            displayName: "x",
            description: null,
            expectedTargetTranslationVersion: 1,
          }),
        ),
      ).rejects.toMatchObject({ code: "run_not_found", statusCode: 404 });

      const review = await getLatestTranslationReview(
        db,
        tenantB.quotes.tenant.id,
        tenantA.product.publicId,
        NATIVE_ENV,
      );
      expect(review).toBeNull();
    },
    60_000,
  );

  async function getAgentRunCrossTenant(tenantId: string, runPublicId: string) {
    const { getAgentRun } = await import("@/lib/agents/agent-runs");
    return getAgentRun(db, tenantId, runPublicId);
  }

  it(
    "read-only staff get 403 before any run or provider work",
    async () => {
      const { product, staffCaller } = await seedTenant();
      const model = new FakeQosModel().script({
        type: "completed",
        text: modelReply("x", null),
        usage: null,
      });

      await expect(
        request(staffCaller, product.publicId, "en", "ar"),
      ).rejects.toBeInstanceOf(StaffAuthorizationError);

      expect(await db.select().from(agentRuns)).toEqual([]);
      expect(await db.select().from(aiSpendReservations)).toEqual([]);
      expect(model.requests).toHaveLength(0);
    },
    60_000,
  );

  it(
    "gate disabled returns a truthful failure with no run or spend",
    async () => {
      const { product, adminCaller } = await seedTenant();

      await expect(
        request(adminCaller, product.publicId, "en", "ar", {
          env: { AGENTS_ENABLED: "true", NODE_ENV: "test" },
          spendPolicy: translationSpendPolicy(),
        }),
      ).rejects.toMatchObject({ statusCode: 503 });

      expect(await db.select().from(agentRuns)).toEqual([]);
      expect(await db.select().from(aiSpendReservations)).toEqual([]);
    },
    60_000,
  );

  it(
    "quota exhaustion rejects a second concurrent request",
    async () => {
      const { quotes, product, adminCaller, adminMembership } = await seedTenant();
      const policy = translationSpendPolicy({
        AI_SPEND_CATALOGUE_TRANSLATION_TENANT_CONCURRENCY: "1",
      });
      const secondProduct = await createDraftProduct(db, quotes.tenant.id, adminMembership, {
        internalName: "cappuccino",
        translations: {
          en: { displayName: "Cappuccino", description: "Foamy." },
          ar: { displayName: "كابتشينو", description: "رغوة." },
        },
        defaultVariant: { amountMinor: 2000, currency: "AED" },
      });

      await request(adminCaller, product.publicId, "en", "ar", { spendPolicy: policy });

      await expect(
        request(adminCaller, secondProduct.publicId, "en", "ar", { spendPolicy: policy }),
      ).rejects.toMatchObject({ code: "tenant_concurrency_limit" });

      const reservations = await db.select().from(aiSpendReservations);
      expect(reservations).toHaveLength(1);
      expect(reservations[0]).toMatchObject({ state: "reserved" });
    },
    60_000,
  );

  it(
    "provider error marks the run failed without product changes and reconciles spend",
    async () => {
      const { quotes, product, adminCaller } = await seedTenant();
      const model = new FakeQosModel().script({
        type: "completed",
        text: "not-valid-json",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
      await request(adminCaller, product.publicId, "en", "ar");
      const step = await workerStep(model);
      expect(step?.result).toMatchObject({ type: "failed", code: "invalid_model_json" });

      const [failedRun] = await db.select().from(agentRuns);
      expect(failedRun).toMatchObject({ status: "failed", failureCode: "invalid_model_json" });
      expect(failedRun!.result).toBeNull();

      const [arBefore] = await db
        .select({ displayName: catalogueProductTranslations.displayName })
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "ar"),
          ),
        );

      const review = await getLatestTranslationReview(db, quotes.tenant.id, product.publicId, NATIVE_ENV);
      expect(review?.suggestionState).toBe("failed");
      expect(review?.suggestion).toBeNull();

      const [spent] = await db.select().from(aiSpendReservations);
      expect(spent).toMatchObject({
        state: "consumed",
        outcome: "failed_after_processing",
      });

      const [arAfter] = await db
        .select({ displayName: catalogueProductTranslations.displayName })
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "ar"),
          ),
        );
      expect(arAfter).toEqual(arBefore);

      const [job] = await db.select().from(aiJobs);
      expect(job?.status).toBe("failed");
      const attempts = await db.select().from(aiJobAttempts);
      expect(attempts.length).toBeGreaterThanOrEqual(1);
    },
    60_000,
  );
});
