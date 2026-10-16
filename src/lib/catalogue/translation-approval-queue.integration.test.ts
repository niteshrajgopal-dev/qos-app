import { randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { agentRuns, catalogueProductTranslations, staffIdentities, staffLocationScopes, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { readAgentConfig } from "@/lib/agents/config";
import { createCatalogueTranslationJobHandler } from "@/lib/catalogue/translation-review/catalogue-translation-job";
import { TRANSLATION_RESULT_SCHEMA } from "@/lib/catalogue/translation-review/result";
import {
  acceptCatalogueTranslation,
  CATALOGUE_TRANSLATION_JOB_KIND,
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
import { createDraftProduct } from "@/lib/catalogue/products";
import {
  approveProductTranslation,
  listPendingAiTranslationApprovals,
  rejectProductTranslation,
  TranslationApprovalConflictError,
  TranslationApprovalError,
} from "@/lib/catalogue/translation-approval";
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

const CONFIG = readAgentConfig({ AGENTS_ENABLED: "true" });
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

integrationDescribe("AI translation approval queue (DB)", () => {
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
    staffSubject = STAFF_SUBJECT,
  ) {
    const quotes = await createTenantHierarchy(db, fixture);
    const adminMembership = await seedMember(
      quotes.tenant.id,
      quotes.location.id,
      "administrator",
      adminSubject,
    );
    await seedMember(quotes.tenant.id, quotes.location.id, "user", staffSubject);
    const product = await createDraftProduct(db, quotes.tenant.id, adminMembership, {
      internalName: "latte",
      translations: {
        en: { displayName: "Latte", description: "Coffee with milk." },
        ar: { displayName: "لاتيه", description: "قهوة مع حليب." },
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
    return { quotes, product, adminCaller };
  }

  function request(
    caller: Awaited<ReturnType<typeof seedTenant>>["adminCaller"],
    productPublicId: string,
  ) {
    return runAsRole(sqlClient, "qos_app", () =>
      requestCatalogueTranslation(
        db,
        caller,
        productPublicId,
        {
          sourceLocale: "en",
          targetLocale: "ar",
          idempotencyKey: `idem-${randomBytes(6).toString("hex")}`,
        },
        {
          config: CONFIG,
          spendPolicy: translationSpendPolicy(),
          env: NATIVE_ENV,
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
    suggestion: { displayName: string; description: string },
  ) {
    const model = new FakeQosModel().script({
      type: "completed",
      text: modelReply(suggestion.displayName, suggestion.description),
      usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 },
    });
    const { run } = await request(caller, productPublicId);
    const step = await workerStep(model);
    expect(step?.result).toEqual({ type: "completed" });
    const [done] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    return done!;
  }

  it("lists pending ai_generated drafts with acceptance metadata", async () => {
    const { quotes, product, adminCaller } = await seedTenant();
    const suggestion = { displayName: "لاتيه جديد", description: "وصف جديد." };
    const run = await completeRun(adminCaller, product.publicId, suggestion);

    await runAsRole(sqlClient, "qos_app", () =>
      acceptCatalogueTranslation(db, adminCaller, product.publicId, {
        runPublicId: run.publicId,
        displayName: suggestion.displayName,
        description: suggestion.description,
        expectedTargetTranslationVersion: 1,
      }),
    );

    const list = await listPendingAiTranslationApprovals(db, quotes.tenant.id, ADMIN_SUBJECT);
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({
      productPublicId: product.publicId,
      locale: "ar",
      translationVersion: 2,
      sourceTranslationVersion: 1,
      proposed: suggestion,
      acceptedBySubject: ADMIN_SUBJECT,
    });
  });

  it("approves and rejects pending drafts with optimistic concurrency", async () => {
    const { quotes, product, adminCaller } = await seedTenant();
    const suggestion = { displayName: "مراجعة", description: "نص." };
    const run = await completeRun(adminCaller, product.publicId, suggestion);

    await runAsRole(sqlClient, "qos_app", () =>
      acceptCatalogueTranslation(db, adminCaller, product.publicId, {
        runPublicId: run.publicId,
        displayName: suggestion.displayName,
        description: suggestion.description,
        expectedTargetTranslationVersion: 1,
      }),
    );

    const pending = await listPendingAiTranslationApprovals(db, quotes.tenant.id, ADMIN_SUBJECT);
    const item = pending.items[0]!;

    await approveProductTranslation(db, quotes.tenant.id, ADMIN_SUBJECT, product.publicId, "ar", {
      expectedTranslationVersion: item.translationVersion,
    });

    await expect(
      listPendingAiTranslationApprovals(db, quotes.tenant.id, ADMIN_SUBJECT),
    ).resolves.toMatchObject({ items: [] });

    const suggestion2 = { displayName: "مسودة ثانية", description: "ثاني." };
    const run2 = await completeRun(adminCaller, product.publicId, suggestion2);
    await runAsRole(sqlClient, "qos_app", () =>
      acceptCatalogueTranslation(db, adminCaller, product.publicId, {
        runPublicId: run2.publicId,
        displayName: suggestion2.displayName,
        description: suggestion2.description,
        expectedTargetTranslationVersion: 2,
      }),
    );

    const staleList = await listPendingAiTranslationApprovals(db, quotes.tenant.id, ADMIN_SUBJECT);
    await expect(
      approveProductTranslation(db, quotes.tenant.id, ADMIN_SUBJECT, product.publicId, "ar", {
        expectedTranslationVersion: staleList.items[0]!.translationVersion - 1,
      }),
    ).rejects.toBeInstanceOf(TranslationApprovalConflictError);

    await rejectProductTranslation(db, quotes.tenant.id, ADMIN_SUBJECT, product.publicId, "ar", {
      expectedTranslationVersion: staleList.items[0]!.translationVersion,
    });

    const [row] = await db
      .select({ approvalStatus: catalogueProductTranslations.approvalStatus })
      .from(catalogueProductTranslations)
      .where(
        and(
          eq(catalogueProductTranslations.tenantId, quotes.tenant.id),
          eq(catalogueProductTranslations.locale, "ar"),
        ),
      );
    expect(row?.approvalStatus).toBe("draft");
  });

  it("enforces tenant isolation and administrator-only access", async () => {
    const { quotes, product } = await seedTenant();
    const flower = await createTenantHierarchy(db, flowerTenantFixture());
    await seedMember(flower.tenant.id, flower.location.id, "administrator", "admin.flower@test");

    await expect(
      listPendingAiTranslationApprovals(db, flower.tenant.id, ADMIN_SUBJECT),
    ).resolves.toMatchObject({ items: [] });

    await expect(
      approveProductTranslation(db, flower.tenant.id, ADMIN_SUBJECT, product.publicId, "ar", {
        expectedTranslationVersion: 1,
      }),
    ).rejects.toBeInstanceOf(TranslationApprovalError);

    await expect(
      listPendingAiTranslationApprovals(db, quotes.tenant.id, STAFF_SUBJECT),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
  });
});
