import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentRunCatalogueMenuExtractionDecisions,
  agentRuns,
  aiJobs,
  catalogueMenuExtractionCandidates,
  catalogueProducts,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { readAgentConfig } from "@/lib/agents/config";
import {
  claimNextAiJob,
  finishAiJobStep,
  markAiJobDispatched,
  type ClaimedAiJob,
} from "@/lib/ai/jobs/ai-job-queue";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { createCatalogueMenuExtractionJobHandler } from "@/lib/catalogue/menu-extraction/catalogue-menu-extraction-job";
import { MENU_EXTRACTION_RESULT_SCHEMA } from "@/lib/catalogue/menu-extraction/result";
import {
  CATALOGUE_MENU_EXTRACTION_JOB_KIND,
  confirmMenuExtraction,
  getLatestTenantMenuExtractionReview,
  getMenuExtractionReview,
  rejectMenuExtraction,
  requestMenuExtraction,
} from "@/lib/catalogue/menu-extraction/service";
import {
  setMenuExtractionVisionProviderForTesting,
  type MenuExtractionVisionProvider,
} from "@/lib/catalogue/menu-extraction/vision-provider";
import { uploadMenuExtractionSource } from "@/lib/catalogue/menu-extraction/upload";
import { requireActiveStaffMembership, StaffAuthorizationError } from "@/lib/staff/auth";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe.sequential : describe.skip;

const ADMIN_SUBJECT = "admin.menu-extract@test";
const STAFF_SUBJECT = "staff.menu-extract@test";
const OTHER_ADMIN = "admin.other-tenant@test";

const NATIVE_ENV: Record<string, string> = {
  AGENTS_ENABLED: "true",
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  AGENT_OPENAI_TASK_MODEL_ALLOWLIST:
    "catalogue.menu_extraction=fake-vision,catalogue.description=fake-model",
  NODE_ENV: "test",
  MEDIA_STORAGE_ROOT: path.join(process.cwd(), ".tmp/menu-extraction-media"),
  AI_SPEND_PLATFORM_CONCURRENCY: "10",
  AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_ENABLED: "true",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_MAX_UNITS_PER_RUN: "12",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_DAILY_UNITS: "10",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_MONTHLY_UNITS: "100",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_CONCURRENCY: "10",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_PLATFORM_DAILY_UNITS: "20",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_PLATFORM_MONTHLY_UNITS: "100",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_UNSTARTED_EXPIRY_MS: "600000",
};

const CONFIG = readAgentConfig({ AGENTS_ENABLED: "true" });
const LIMITS = { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 };

function menuExtractionSpendPolicy(overrides: Record<string, string> = {}) {
  return readAiSpendPolicy({
    AI_SPEND_PLATFORM_CONCURRENCY: "10",
    AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_ENABLED: "true",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_MAX_UNITS_PER_RUN: "12",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_DAILY_UNITS: "10",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_MONTHLY_UNITS: "100",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_CONCURRENCY: "10",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_PLATFORM_DAILY_UNITS: "20",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_PLATFORM_MONTHLY_UNITS: "100",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_UNSTARTED_EXPIRY_MS: "600000",
    ...overrides,
  });
}

function modelReply() {
  return JSON.stringify({
    schema: MENU_EXTRACTION_RESULT_SCHEMA,
    items: [
      {
        candidateKey: "synthetic-halloumi",
        sectionName: "Mains",
        displayNameEn: "Grilled Halloumi",
        displayNameAr: "حلوم مشوي",
        descriptionEn: null,
        descriptionAr: null,
        variantLabelEn: "Default",
        variantLabelAr: "افتراضي",
        priceText: "AED 32",
        amountMinor: 3200,
        currency: "AED",
        allergenText: null,
        unitText: null,
        uncertainty: {
          displayNameEn: "none",
          displayNameAr: "none",
          descriptionEn: "missing",
          descriptionAr: "missing",
          price: "low",
          allergen: "missing",
          unit: "missing",
        },
        evidence: { pageNumber: 1, bbox: null, originalText: "SYNTHETIC Grilled Halloumi — AED 32" },
        modelConfidenceEstimate: "medium",
      },
    ],
  });
}

integrationDescribe("catalogue menu extraction (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let visionComplete: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
    await grantRoleMembership(sqlClient, "qos", "qos_ai_worker");
  }, 120_000);

  afterAll(async () => {
    setMenuExtractionVisionProviderForTesting(null);
    if (sqlClient) {
      await sqlClient.end({ timeout: 5 });
    }
  });

  beforeEach(async () => {
    visionComplete = vi.fn(async () => ({
      text: modelReply(),
      usage: { input_tokens: 3, output_tokens: 8, total_tokens: 11 },
    }));
    setMenuExtractionVisionProviderForTesting({
      kind: "mock",
      complete: visionComplete as MenuExtractionVisionProvider["complete"],
    });
    await sqlClient`TRUNCATE TABLE qos.agent_run_catalogue_menu_extraction_decisions, qos.catalogue_menu_extraction_candidates, qos.catalogue_import_source_links, qos.catalogue_import_operations, qos.ai_job_attempts, qos.ai_jobs, qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.agent_run_inputs, qos.agent_runs, qos.catalogue_menu_extraction_pages, qos.catalogue_menu_extraction_sources, qos.tenant_audit_events, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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
    return membership!;
  }

  async function seedTenant(
    adminSubject = ADMIN_SUBJECT,
    fixture = quotesTenantFixture(),
    options: { seedStaffUser?: boolean } = { seedStaffUser: true },
  ) {
    const quotes = await createTenantHierarchy(db, fixture);
    const adminMembership = await seedMember(
      quotes.tenant.id,
      quotes.location.id,
      "administrator",
      adminSubject,
    );
    if (options.seedStaffUser) {
      await seedMember(quotes.tenant.id, quotes.location.id, "user", STAFF_SUBJECT);
    }
    const adminCaller = {
      tenantId: quotes.tenant.id,
      subject: adminSubject,
      membership: await runAsRole(sqlClient, "qos_app", () =>
        requireActiveStaffMembership(db, quotes.tenant.id, adminSubject),
      ),
    };
    return { quotes, adminCaller, adminMembership };
  }

  async function uploadFixture(caller: Awaited<ReturnType<typeof seedTenant>>["adminCaller"]) {
    const fixturePath = path.join(
      process.cwd(),
      "fixtures/menu-extraction/synthetic/en-text-menu.png",
    );
    const bytes = await readFile(fixturePath);
    return runAsRole(sqlClient, "qos_app", () =>
      uploadMenuExtractionSource(db, caller.tenantId, caller.membership, caller.subject, {
        fileName: "synthetic-en-menu.png",
        bytes,
        contentType: "image/png",
      }),
    );
  }

  async function workerStep(provider?: MenuExtractionVisionProvider) {
    const handler = createCatalogueMenuExtractionJobHandler(db, {
      config: CONFIG,
      env: NATIVE_ENV,
      vision:
        provider ??
        ({
          kind: "mock",
          complete: visionComplete as MenuExtractionVisionProvider["complete"],
        } satisfies MenuExtractionVisionProvider),
    });
    return runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, {
        workerId: "worker-menu-extract",
        jobKinds: [CATALOGUE_MENU_EXTRACTION_JOB_KIND],
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

  it("uploads, extracts with mocked vision, confirms draft products only", async () => {
    const { adminCaller } = await seedTenant();
    const uploaded = await uploadFixture(adminCaller);
    const idem = `idem-${randomBytes(6).toString("hex")}`;
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      requestMenuExtraction(
        db,
        adminCaller,
        uploaded.sourcePublicId,
        { idempotencyKey: idem },
        { env: NATIVE_ENV, spendPolicy: menuExtractionSpendPolicy(), config: CONFIG },
      ),
    );
    expect(run.status).toBe("queued");
    const step = await workerStep();
    expect(step?.result).toEqual({ type: "completed" });
    expect(visionComplete).toHaveBeenCalledTimes(1);

    const confirmIdem = `confirm-${randomBytes(6).toString("hex")}`;
    const reviewBeforeConfirm = await runAsRole(sqlClient, "qos_app", () =>
      getMenuExtractionReview(
        db,
        adminCaller.tenantId,
        adminCaller.subject,
        uploaded.sourcePublicId,
        run.publicId,
      ),
    );
    const confirmed = await runAsRole(sqlClient, "qos_app", () =>
      confirmMenuExtraction(db, adminCaller, uploaded.sourcePublicId, {
        runPublicId: run.publicId,
        expectedVersion: reviewBeforeConfirm?.candidatesRevision ?? 0,
        importIdempotencyKey: confirmIdem,
      }),
    );
    expect(confirmed.importOperationPublicId).toBeTruthy();

    const products = await db
      .select()
      .from(catalogueProducts)
      .where(eq(catalogueProducts.tenantId, adminCaller.tenantId));
    expect(products.every((product) => product.status === "draft")).toBe(true);

    const audits = await db
      .select()
      .from(tenantAuditEvents)
      .where(eq(tenantAuditEvents.action, "catalogue.menu_extraction.confirmed"));
    expect(audits.length).toBe(1);
  });

  it("rejects without creating products", async () => {
    const { adminCaller } = await seedTenant();
    const uploaded = await uploadFixture(adminCaller);
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      requestMenuExtraction(
        db,
        adminCaller,
        uploaded.sourcePublicId,
        { idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
        { env: NATIVE_ENV, spendPolicy: menuExtractionSpendPolicy(), config: CONFIG },
      ),
    );
    await workerStep();
    await runAsRole(sqlClient, "qos_app", () =>
      rejectMenuExtraction(db, adminCaller, uploaded.sourcePublicId, {
        runPublicId: run.publicId,
      }),
    );
    const products = await db.select().from(catalogueProducts);
    expect(products.length).toBe(0);

    const review = await runAsRole(sqlClient, "qos_app", () =>
      getMenuExtractionReview(
        db,
        adminCaller.tenantId,
        adminCaller.subject,
        uploaded.sourcePublicId,
        run.publicId,
        NATIVE_ENV,
      ),
    );
    expect(review?.decision).toBe("cancelled");

    const audits = await db
      .select()
      .from(tenantAuditEvents)
      .where(eq(tenantAuditEvents.action, "catalogue.menu_extraction.cancelled"));
    expect(audits.length).toBe(1);
  });

  it("restores the latest extraction review for the tenant after cancel", async () => {
    const { adminCaller } = await seedTenant();
    const uploaded = await uploadFixture(adminCaller);
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      requestMenuExtraction(
        db,
        adminCaller,
        uploaded.sourcePublicId,
        { idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
        { env: NATIVE_ENV, spendPolicy: menuExtractionSpendPolicy(), config: CONFIG },
      ),
    );
    await workerStep();
    await runAsRole(sqlClient, "qos_app", () =>
      rejectMenuExtraction(db, adminCaller, uploaded.sourcePublicId, {
        runPublicId: run.publicId,
      }),
    );

    const latest = await runAsRole(sqlClient, "qos_app", () =>
      getLatestTenantMenuExtractionReview(db, adminCaller.tenantId, NATIVE_ENV),
    );
    expect(latest).toMatchObject({
      runPublicId: run.publicId,
      sourcePublicId: uploaded.sourcePublicId,
      decision: "cancelled",
    });
  });

  it("replays extraction idempotency without duplicate spend jobs", async () => {
    const { adminCaller } = await seedTenant();
    const uploaded = await uploadFixture(adminCaller);
    const idem = `idem-${randomBytes(6).toString("hex")}`;
    await runAsRole(sqlClient, "qos_app", () =>
      requestMenuExtraction(
        db,
        adminCaller,
        uploaded.sourcePublicId,
        { idempotencyKey: idem },
        { env: NATIVE_ENV, spendPolicy: menuExtractionSpendPolicy(), config: CONFIG },
      ),
    );
    await runAsRole(sqlClient, "qos_app", () =>
      requestMenuExtraction(
        db,
        adminCaller,
        uploaded.sourcePublicId,
        { idempotencyKey: idem },
        { env: NATIVE_ENV, spendPolicy: menuExtractionSpendPolicy(), config: CONFIG },
      ),
    );
    const jobs = await db.select().from(aiJobs);
    expect(jobs.length).toBe(1);
  });

  it("refuses non-admin extraction", async () => {
    const { quotes } = await seedTenant();
    const staffMembership = await runAsRole(sqlClient, "qos_app", () =>
      requireActiveStaffMembership(db, quotes.tenant.id, STAFF_SUBJECT),
    );
    const uploaded = await uploadFixture({
      tenantId: quotes.tenant.id,
      subject: ADMIN_SUBJECT,
      membership: await runAsRole(sqlClient, "qos_app", () =>
        requireActiveStaffMembership(db, quotes.tenant.id, ADMIN_SUBJECT),
      ),
    });
    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        requestMenuExtraction(
          db,
          { tenantId: quotes.tenant.id, subject: STAFF_SUBJECT, membership: staffMembership },
          uploaded.sourcePublicId,
          { idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
          { env: NATIVE_ENV, spendPolicy: menuExtractionSpendPolicy(), config: CONFIG },
        ),
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
  });

  it("returns 404 for cross-tenant source on confirm path", async () => {
    const first = await seedTenant(ADMIN_SUBJECT);
    const second = await seedTenant(OTHER_ADMIN, flowerTenantFixture(), { seedStaffUser: false });
    const uploaded = await uploadFixture(first.adminCaller);
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      requestMenuExtraction(
        db,
        first.adminCaller,
        uploaded.sourcePublicId,
        { idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
        { env: NATIVE_ENV, spendPolicy: menuExtractionSpendPolicy(), config: CONFIG },
      ),
    );
    await workerStep();
    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        confirmMenuExtraction(db, second.adminCaller, uploaded.sourcePublicId, {
          runPublicId: run.publicId,
          expectedVersion: 0,
          importIdempotencyKey: `confirm-${randomBytes(6).toString("hex")}`,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("refuses extraction when spend gate is unset without provider call", async () => {
    const { adminCaller } = await seedTenant();
    const uploaded = await uploadFixture(adminCaller);
    visionComplete.mockClear();
    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        requestMenuExtraction(
          db,
          adminCaller,
          uploaded.sourcePublicId,
          { idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
          { env: NATIVE_ENV, spendPolicy: readAiSpendPolicy({}), config: CONFIG },
        ),
      ),
    ).rejects.toBeTruthy();
    expect(visionComplete).not.toHaveBeenCalled();
    const [run] = await db.select().from(agentRuns);
    expect(run).toBeUndefined();
  });
});
