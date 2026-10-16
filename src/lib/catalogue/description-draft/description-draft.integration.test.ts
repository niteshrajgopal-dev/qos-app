import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  agentRunCatalogueDescriptionDecisions,
  agentRuns,
  aiJobAttempts,
  aiJobs,
  aiSpendReservations,
  catalogueProductTranslations,
  catalogueProducts,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { readAgentConfig } from "@/lib/agents/config";
import { createCatalogueDescriptionJobHandler } from "@/lib/catalogue/description-draft/catalogue-description-job";
import { CATALOGUE_DESCRIPTION_PROMPT_VERSION } from "@/lib/catalogue/description-draft/prompt";
import { DESCRIPTION_RESULT_SCHEMA } from "@/lib/catalogue/description-draft/result";
import {
  acceptCatalogueDescription,
  CATALOGUE_DESCRIPTION_JOB_KIND,
  getLatestDescriptionReview,
  rejectCatalogueDescription,
  requestCatalogueDescription,
} from "@/lib/catalogue/description-draft/service";
import { FakeQosModel } from "@/lib/ai/model/fake-qos-model";
import {
  claimNextAiJob,
  finishAiJobStep,
  markAiJobDispatched,
  type ClaimedAiJob,
} from "@/lib/ai/jobs/ai-job-queue";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { createDraftProduct, getDraftProduct, updateDraftProduct } from "@/lib/catalogue/products";
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
  AGENT_OPENAI_TASK_MODEL_ALLOWLIST:
    "catalogue.description=fake-model,catalogue.translation=fake-model",
  NODE_ENV: "test",
};

const CONFIG = readAgentConfig({
  AGENTS_ENABLED: "true",
});

const LIMITS = { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 };

function descriptionSpendPolicy(overrides: Record<string, string> = {}) {
  return readAiSpendPolicy({
    AI_SPEND_PLATFORM_CONCURRENCY: "10",
    AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
    AI_SPEND_CATALOGUE_DESCRIPTION_ENABLED: "true",
    AI_SPEND_CATALOGUE_DESCRIPTION_MAX_UNITS_PER_RUN: "1",
    AI_SPEND_CATALOGUE_DESCRIPTION_TENANT_DAILY_UNITS: "10",
    AI_SPEND_CATALOGUE_DESCRIPTION_TENANT_MONTHLY_UNITS: "100",
    AI_SPEND_CATALOGUE_DESCRIPTION_TENANT_CONCURRENCY: "10",
    AI_SPEND_CATALOGUE_DESCRIPTION_PLATFORM_DAILY_UNITS: "20",
    AI_SPEND_CATALOGUE_DESCRIPTION_PLATFORM_MONTHLY_UNITS: "100",
    AI_SPEND_CATALOGUE_DESCRIPTION_UNSTARTED_EXPIRY_MS: "600000",
    ...overrides,
  });
}

function modelReply(description: string | null) {
  return JSON.stringify({
    schema: DESCRIPTION_RESULT_SCHEMA,
    description,
  });
}

integrationDescribe("catalogue description draft (DB)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.agent_run_catalogue_description_decisions, qos.ai_job_attempts, qos.ai_jobs, qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.agent_run_inputs, qos.agent_runs, qos.tenant_audit_events, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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
    staffSubject = STAFF_SUBJECT,
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
      staffSubject,
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
      subject: staffSubject,
      membership: staffMembership,
    };
    return { quotes, product, adminCaller, staffCaller, adminMembership };
  }

  function request(
    caller: Awaited<ReturnType<typeof seedTenant>>["adminCaller"],
    productPublicId: string,
    options: {
      env?: Record<string, string>;
      spendPolicy?: ReturnType<typeof descriptionSpendPolicy>;
      idempotencyKey?: string;
    } = {},
  ) {
    return runAsRole(sqlClient, "qos_app", () =>
      requestCatalogueDescription(
        db,
        caller,
        productPublicId,
        {
          idempotencyKey: options.idempotencyKey ?? `idem-${randomBytes(6).toString("hex")}`,
        },
        {
          config: CONFIG,
          spendPolicy: options.spendPolicy ?? descriptionSpendPolicy(),
          env: options.env ?? NATIVE_ENV,
        },
      ),
    );
  }

  async function workerStep(model: FakeQosModel) {
    const handler = createCatalogueDescriptionJobHandler(db, { config: CONFIG, model });
    return runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, {
        workerId: "worker-test",
        jobKinds: [CATALOGUE_DESCRIPTION_JOB_KIND],
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
    description: string | null,
  ) {
    const model = new FakeQosModel().script({
      type: "completed",
      text: modelReply(description),
      usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 },
    });
    const { run } = await request(caller, productPublicId);
    expect(run.status).toBe("queued");
    const step = await workerStep(model);
    expect(step?.result).toEqual({ type: "completed" });
    const [done] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    expect(done?.status).toBe("completed");
    return { run: done!, model };
  }

  it(
    "stores source translation version, model id, and prompt version on the run",
    async () => {
      const { product, adminCaller } = await seedTenant();
      const suggestion = "Velvety espresso with steamed milk.";
      const { run } = await completeRun(adminCaller, product.publicId, suggestion);

      expect(run.requestSummary).toMatchObject({
        schema: "qos.catalogue_description_request.v1",
        sourceTranslationVersion: 1,
        modelId: "fake-model",
        promptVersion: CATALOGUE_DESCRIPTION_PROMPT_VERSION,
      });
      expect(run.result).toMatchObject({
        schema: DESCRIPTION_RESULT_SCHEMA,
        description: suggestion,
        sourceTranslationVersion: 1,
        modelId: "fake-model",
        promptVersion: CATALOGUE_DESCRIPTION_PROMPT_VERSION,
      });
    },
    60_000,
  );

  it(
    "accept persists English description to the database before any product PATCH (QOS-42)",
    async () => {
      const { quotes, product, adminCaller, adminMembership } = await seedTenant();
      const suggestion = "A smoother English description for staff review.";
      const before = await getDraftProduct(
        db,
        quotes.tenant.id,
        adminMembership,
        product.publicId,
      );
      expect(before.translations.en.description).not.toBe(suggestion);

      const { run } = await completeRun(adminCaller, product.publicId, suggestion);

      await runAsRole(sqlClient, "qos_app", () =>
        acceptCatalogueDescription(db, adminCaller, product.publicId, {
          runPublicId: run.publicId,
          description: suggestion,
          expectedSourceTranslationVersion: 1,
        }),
      );

      const after = await getDraftProduct(
        db,
        quotes.tenant.id,
        adminMembership,
        product.publicId,
      );
      expect(after.translations.en.description).toBe(suggestion);
      expect(after.translations.en.translationVersion).toBe(2);
    },
    60_000,
  );

  it(
    "accept writes English draft description only and does not publish the product",
    async () => {
      const { quotes, product, adminCaller, adminMembership } = await seedTenant();
      const suggestion = "A smoother English description for staff review.";
      const { run } = await completeRun(adminCaller, product.publicId, suggestion);

      const accepted = await runAsRole(sqlClient, "qos_app", () =>
        acceptCatalogueDescription(db, adminCaller, product.publicId, {
          runPublicId: run.publicId,
          description: suggestion,
          expectedSourceTranslationVersion: 1,
        }),
      );
      expect(accepted.idempotentReplay).toBe(false);

      const [enRow] = await db
        .select()
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "en"),
          ),
        );
      expect(enRow).toMatchObject({
        description: suggestion,
        displayName: "Latte",
        translationVersion: 2,
        approvalStatus: "draft",
        provenance: "ai_generated",
      });

      const [productRow] = await db
        .select({ status: catalogueProducts.status })
        .from(catalogueProducts)
        .where(eq(catalogueProducts.tenantId, quotes.tenant.id));
      expect(productRow?.status).toBe("draft");

      const draft = await getDraftProduct(db, quotes.tenant.id, adminMembership, product.publicId);
      expect(draft.translations.en.description).toBe(suggestion);
      expect(draft.translations.ar.description).toBe("إسبريسو مع حليب.");
    },
    60_000,
  );

  it(
    "reject leaves product text unchanged",
    async () => {
      const { quotes, product, adminCaller } = await seedTenant();
      const { run } = await completeRun(adminCaller, product.publicId, "Rejected copy.");

      await runAsRole(sqlClient, "qos_app", () =>
        rejectCatalogueDescription(db, adminCaller, product.publicId, {
          runPublicId: run.publicId,
        }),
      );

      const [enRow] = await db
        .select({ description: catalogueProductTranslations.description })
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "en"),
          ),
        );
      expect(enRow?.description).toBe("Smooth espresso with milk.");
    },
    60_000,
  );

  it(
    "refuses accept when the English description changed after the request",
    async () => {
      const { quotes, product, adminCaller, adminMembership } = await seedTenant();
      const { run } = await completeRun(adminCaller, product.publicId, "Stale suggestion.");

      await updateDraftProduct(
        db,
        quotes.tenant.id,
        adminMembership,
        product.publicId,
        {
          expectedVersion: 1,
          translations: {
            en: {
              displayName: "Latte",
              description: "Updated elsewhere.",
              expectedTranslationVersion: 1,
            },
          },
        },
        ADMIN_SUBJECT,
      );

      await expect(
        runAsRole(sqlClient, "qos_app", () =>
          acceptCatalogueDescription(db, adminCaller, product.publicId, {
            runPublicId: run.publicId,
            description: "Stale suggestion.",
            expectedSourceTranslationVersion: 2,
          }),
        ),
      ).rejects.toMatchObject({ code: "review_outdated", statusCode: 409 });

      expect(await db.select().from(agentRunCatalogueDescriptionDecisions)).toEqual([]);
    },
    60_000,
  );

  it(
    "tenant B cannot accept tenant A description runs",
    async () => {
      const tenantA = await seedTenant();
      const tenantB = await seedTenant(
        "admin.other@test",
        flowerTenantFixture(),
        "staff.flowers@test",
      );
      const { run } = await completeRun(tenantA.adminCaller, tenantA.product.publicId, "Private.");

      await expect(
        runAsRole(sqlClient, "qos_app", () =>
          acceptCatalogueDescription(db, tenantB.adminCaller, tenantB.product.publicId, {
            runPublicId: run.publicId,
            description: "Private.",
            expectedSourceTranslationVersion: 1,
          }),
        ),
      ).rejects.toMatchObject({ code: "run_not_found", statusCode: 404 });

      const review = await getLatestDescriptionReview(
        db,
        tenantB.quotes.tenant.id,
        tenantA.product.publicId,
        NATIVE_ENV,
      );
      expect(review).toBeNull();
    },
    60_000,
  );

  it(
    "read-only staff get 403 before any run or provider work",
    async () => {
      const { product, staffCaller } = await seedTenant();
      const model = new FakeQosModel().script({
        type: "completed",
        text: modelReply("x"),
        usage: null,
      });

      await expect(request(staffCaller, product.publicId)).rejects.toBeInstanceOf(
        StaffAuthorizationError,
      );

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
        request(adminCaller, product.publicId, {
          env: { AGENTS_ENABLED: "true", NODE_ENV: "test" },
          spendPolicy: descriptionSpendPolicy(),
        }),
      ).rejects.toMatchObject({ statusCode: 503 });

      expect(await db.select().from(agentRuns)).toEqual([]);
      expect(await db.select().from(aiSpendReservations)).toEqual([]);
    },
    60_000,
  );

  it(
    "idempotent request replays the same run without double spend",
    async () => {
      const { product, adminCaller } = await seedTenant();
      const idem = `idem-${randomBytes(8).toString("hex")}`;
      const first = await request(adminCaller, product.publicId, { idempotencyKey: idem });
      const second = await request(adminCaller, product.publicId, { idempotencyKey: idem });
      expect(first.run.publicId).toBe(second.run.publicId);
      expect(first.created).toBe(true);
      expect(second.created).toBe(false);
      const reservations = await db.select().from(aiSpendReservations);
      expect(reservations).toHaveLength(1);
    },
    60_000,
  );

  it(
    "provider error marks the run failed without product changes",
    async () => {
      const { quotes, product, adminCaller } = await seedTenant();
      const model = new FakeQosModel().script({
        type: "completed",
        text: "not-json",
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
      });
      await request(adminCaller, product.publicId);
      const step = await workerStep(model);
      expect(step?.result).toMatchObject({ type: "failed", code: "invalid_model_json" });

      const [enRow] = await db
        .select({ description: catalogueProductTranslations.description })
        .from(catalogueProductTranslations)
        .where(
          and(
            eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
            eq(catalogueProductTranslations.locale, "en"),
          ),
        );
      expect(enRow?.description).toBe("Smooth espresso with milk.");

      const review = await getLatestDescriptionReview(db, quotes.tenant.id, product.publicId, NATIVE_ENV);
      expect(review?.suggestionState).toBe("failed");

      const audit = await db
        .select({ id: tenantAuditEvents.id })
        .from(tenantAuditEvents)
        .where(eq(tenantAuditEvents.action, "catalogue.description.suggestion_accepted"));
      expect(audit).toEqual([]);

      const [job] = await db.select().from(aiJobs);
      expect(job?.status).toBe("failed");
      const attempts = await db.select().from(aiJobAttempts);
      expect(attempts.length).toBeGreaterThanOrEqual(1);
    },
    60_000,
  );
});
