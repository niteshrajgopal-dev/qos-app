import { randomBytes } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentRunCatalogueDescriptionDecisions,
  agentRunCatalogueTranslationDecisions,
  agentRuns,
  catalogueProductTranslations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
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
import { listPendingAiTranslationApprovals } from "@/lib/catalogue/translation-approval";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { POST } from "./route";

const staffMocks = vi.hoisted(() => ({
  requireStaffIdentity: vi.fn(),
}));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return {
    ...actual,
    requireStaffIdentity: staffMocks.requireStaffIdentity,
  };
});

const integrationDescribe = hasIntegrationDatabase() ? describe.sequential : describe.skip;

const ADMIN_SUBJECT = "admin.translation-reject-route@test";

const NATIVE_ENV: Record<string, string> = {
  AGENTS_ENABLED: "true",
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  AGENT_OPENAI_TASK_MODEL_ALLOWLIST: "catalogue.translation=fake-model",
  NODE_ENV: "test",
};

const CONFIG = readAgentConfig({ AGENTS_ENABLED: "true" });
const LIMITS = { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 };

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

function modelReply(displayName: string, description: string | null) {
  return JSON.stringify({
    schema: TRANSLATION_RESULT_SCHEMA,
    displayName,
    description,
  });
}

integrationDescribe("POST /translations/[locale]/reject (DB)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.agent_run_catalogue_description_decisions, qos.agent_run_catalogue_translation_decisions, qos.ai_job_attempts, qos.ai_jobs, qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.agent_run_inputs, qos.agent_runs, qos.tenant_audit_events, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  async function seedTenant() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: ADMIN_SUBJECT, email: ADMIN_SUBJECT })
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
    const adminMembership = {
      membershipId: membership!.id,
      role: "administrator" as const,
      staffIdentityId: identity!.id,
    };
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
      subject: ADMIN_SUBJECT,
      membership: await runAsRole(sqlClient, "qos_app", () =>
        requireActiveStaffMembership(db, quotes.tenant.id, ADMIN_SUBJECT),
      ),
    };
    return { quotes, product, adminCaller };
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

  async function readTranslationRows(tenantId: string) {
    return db
      .select({
        locale: catalogueProductTranslations.locale,
        translationVersion: catalogueProductTranslations.translationVersion,
        displayName: catalogueProductTranslations.displayName,
        description: catalogueProductTranslations.description,
        approvalStatus: catalogueProductTranslations.approvalStatus,
      })
      .from(catalogueProductTranslations)
      .where(eq(catalogueProductTranslations.tenantId, tenantId));
  }

  it("rejects only the target locale and bumps its version exactly once across accept→reject", async () => {
    const { quotes, product, adminCaller } = await seedTenant();
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject: ADMIN_SUBJECT });

    const baseline = await readTranslationRows(quotes.tenant.id);
    const baselineEn = baseline.find((row) => row.locale === "en")!;
    const baselineAr = baseline.find((row) => row.locale === "ar")!;

    const descriptionDecisionCountBefore = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentRunCatalogueDescriptionDecisions);
    const translationDecisionCountBefore = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentRunCatalogueTranslationDecisions);

    const suggestion = { displayName: "مراجعة", description: "نص." };
    const model = new FakeQosModel().script({
      type: "completed",
      text: modelReply(suggestion.displayName, suggestion.description),
      usage: { input_tokens: 2, output_tokens: 4, total_tokens: 6 },
    });
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      requestCatalogueTranslation(
        db,
        adminCaller,
        product.publicId,
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
    await workerStep(model);
    const [done] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));

    await runAsRole(sqlClient, "qos_app", () =>
      acceptCatalogueTranslation(db, adminCaller, product.publicId, {
        runPublicId: done!.publicId,
        displayName: suggestion.displayName,
        description: suggestion.description,
        expectedTargetTranslationVersion: baselineAr.translationVersion,
      }),
    );

    const afterAccept = await readTranslationRows(quotes.tenant.id);
    const arAfterAccept = afterAccept.find((row) => row.locale === "ar")!;
    expect(arAfterAccept.translationVersion).toBe(baselineAr.translationVersion + 1);

    const pending = await listPendingAiTranslationApprovals(db, quotes.tenant.id, ADMIN_SUBJECT);
    expect(pending.items).toHaveLength(1);

    const response = await POST(
      new Request("http://localhost/reject", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedTranslationVersion: pending.items[0]!.translationVersion,
        }),
      }),
      {
        params: Promise.resolve({
          tenantId: quotes.tenant.id,
          productPublicId: product.publicId,
          locale: "ar",
        }),
      },
    );
    expect(response.status).toBe(200);

    const afterReject = await readTranslationRows(quotes.tenant.id);
    const enAfterReject = afterReject.find((row) => row.locale === "en")!;
    const arAfterReject = afterReject.find((row) => row.locale === "ar")!;

    expect(enAfterReject).toMatchObject({
      translationVersion: baselineEn.translationVersion,
      displayName: baselineEn.displayName,
      description: baselineEn.description,
      approvalStatus: baselineEn.approvalStatus,
    });
    expect(arAfterReject.translationVersion).toBe(baselineAr.translationVersion + 1);
    expect(arAfterReject.displayName).toBe(baselineAr.displayName);

    const descriptionDecisionCountAfter = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentRunCatalogueDescriptionDecisions);
    const translationDecisionCountAfter = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(agentRunCatalogueTranslationDecisions);

    expect(descriptionDecisionCountAfter[0]?.count).toBe(descriptionDecisionCountBefore[0]?.count);
    expect(translationDecisionCountAfter[0]?.count).toBe(
      (translationDecisionCountBefore[0]?.count ?? 0) + 1,
    );
  });
});
