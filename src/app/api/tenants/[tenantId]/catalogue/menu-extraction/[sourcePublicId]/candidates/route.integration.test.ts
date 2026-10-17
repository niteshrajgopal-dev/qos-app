import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { staffIdentities, staffLocationScopes, staffMemberships } from "@/db/schema";
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
  getMenuExtractionReview,
  requestMenuExtraction,
} from "@/lib/catalogue/menu-extraction/service";
import {
  setMenuExtractionVisionProviderForTesting,
  type MenuExtractionVisionProvider,
} from "@/lib/catalogue/menu-extraction/vision-provider";
import { uploadMenuExtractionSource } from "@/lib/catalogue/menu-extraction/upload";
import type { requireActiveStaffMembership } from "@/lib/staff/auth";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const staffMocks = vi.hoisted(() => ({
  requireStaffIdentity: vi.fn(),
  requireActiveStaffMembership: vi.fn(),
}));

const staffAuthActual = vi.hoisted(() => vi.importActual<typeof import("@/lib/staff/auth")>("@/lib/staff/auth"));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return {
    ...actual,
    requireStaffIdentity: staffMocks.requireStaffIdentity,
    requireActiveStaffMembership: staffMocks.requireActiveStaffMembership,
  };
});

const integrationDescribe = hasIntegrationDatabase() ? describe.sequential : describe.skip;

const ADMIN_SUBJECT = "admin.menu-candidates-route@test";
const NATIVE_ENV: Record<string, string> = {
  AGENTS_ENABLED: "true",
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  AGENT_OPENAI_TASK_MODEL_ALLOWLIST:
    "catalogue.menu_extraction=fake-vision,catalogue.description=fake-model",
  NODE_ENV: "test",
  MEDIA_STORAGE_ROOT: path.join(process.cwd(), ".tmp/menu-extraction-candidates-route-media"),
  AI_SPEND_PLATFORM_CONCURRENCY: "10",
  AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_ENABLED: "true",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_MAX_UNITS_PER_RUN: "12",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_DAILY_UNITS: "100",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_MONTHLY_UNITS: "1000",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_CONCURRENCY: "10",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_PLATFORM_DAILY_UNITS: "200",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_PLATFORM_MONTHLY_UNITS: "1000",
  AI_SPEND_CATALOGUE_MENU_EXTRACTION_UNSTARTED_EXPIRY_MS: "600000",
};

const CONFIG = readAgentConfig({ AGENTS_ENABLED: "true" });
const LIMITS = { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 };

function spendPolicy() {
  return readAiSpendPolicy({
    AI_SPEND_PLATFORM_CONCURRENCY: "10",
    AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_ENABLED: "true",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_MAX_UNITS_PER_RUN: "12",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_DAILY_UNITS: "100",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_MONTHLY_UNITS: "1000",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_TENANT_CONCURRENCY: "10",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_PLATFORM_DAILY_UNITS: "200",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_PLATFORM_MONTHLY_UNITS: "1000",
    AI_SPEND_CATALOGUE_MENU_EXTRACTION_UNSTARTED_EXPIRY_MS: "600000",
  });
}

integrationDescribe("menu extraction candidates PATCH route (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let visionComplete: ReturnType<typeof vi.fn>;
  let adminCaller: {
    tenantId: string;
    subject: string;
    membership: Awaited<ReturnType<typeof requireActiveStaffMembership>>;
  };
  let PATCH: typeof import("./route").PATCH;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    const globalForDb = globalThis as unknown as {
      db?: typeof db;
      sql?: typeof sqlClient;
    };
    globalForDb.db = db;
    globalForDb.sql = sqlClient;

    await grantRoleMembership(sqlClient, "qos", "qos_app");
    await grantRoleMembership(sqlClient, "qos", "qos_ai_worker");
    ({ PATCH } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    setMenuExtractionVisionProviderForTesting(null);
    if (sqlClient) {
      await sqlClient.end({ timeout: 5 });
    }
  });

  beforeEach(async () => {
    visionComplete = vi.fn(async () => ({
      text: JSON.stringify({
        schema: MENU_EXTRACTION_RESULT_SCHEMA,
        items: [
          {
            candidateKey: "row-1",
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
            evidence: { pageNumber: 1, bbox: null, originalText: "SYNTHETIC" },
            modelConfidenceEstimate: "medium",
          },
        ],
      }),
      usage: { input_tokens: 3, output_tokens: 8, total_tokens: 11 },
    }));
    setMenuExtractionVisionProviderForTesting({
      kind: "mock",
      complete: visionComplete as MenuExtractionVisionProvider["complete"],
    });

    await sqlClient`TRUNCATE TABLE qos.agent_run_catalogue_menu_extraction_decisions, qos.catalogue_menu_extraction_candidates, qos.catalogue_import_source_links, qos.catalogue_import_operations, qos.ai_job_attempts, qos.ai_jobs, qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.agent_run_inputs, qos.agent_runs, qos.catalogue_menu_extraction_pages, qos.catalogue_menu_extraction_sources, qos.tenant_audit_events, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;

    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: ADMIN_SUBJECT, email: ADMIN_SUBJECT })
      .returning();
    const [membershipRow] = await db
      .insert(staffMemberships)
      .values({ tenantId: quotes.tenant.id, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({
      tenantId: quotes.tenant.id,
      staffMembershipId: membershipRow!.id,
      locationId: quotes.location.id,
    });
    const actualAuth = await staffAuthActual;
    const activeMembership = await runAsRole(sqlClient, "qos_app", () =>
      actualAuth.requireActiveStaffMembership(db, quotes.tenant.id, ADMIN_SUBJECT),
    );
    adminCaller = {
      tenantId: quotes.tenant.id,
      subject: ADMIN_SUBJECT,
      membership: activeMembership,
    };

    staffMocks.requireStaffIdentity.mockResolvedValue({ subject: ADMIN_SUBJECT });
    staffMocks.requireActiveStaffMembership.mockResolvedValue(activeMembership);
  });

  async function uploadPng() {
    const bytes = await readFile(
      path.join(process.cwd(), "fixtures/menu-extraction/synthetic/en-text-menu.png"),
    );
    return runAsRole(sqlClient, "qos_app", () =>
      uploadMenuExtractionSource(db, adminCaller.tenantId, adminCaller.membership, adminCaller.subject, {
        fileName: "synthetic-en-menu.png",
        bytes,
        contentType: "image/png",
      }),
    );
  }

  async function workerStep() {
    const handler = createCatalogueMenuExtractionJobHandler(db, {
      config: CONFIG,
      env: NATIVE_ENV,
      vision: {
        kind: "mock",
        complete: visionComplete as MenuExtractionVisionProvider["complete"],
      },
    });
    return runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, {
        workerId: "worker-menu-candidates-route",
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

  it("returns 400 with priceText when PATCH saves a negative price", async () => {
    const uploaded = await uploadPng();
    const { run } = await runAsRole(sqlClient, "qos_app", () =>
      requestMenuExtraction(
        db,
        adminCaller,
        uploaded.sourcePublicId,
        { idempotencyKey: `idem-${randomBytes(6).toString("hex")}` },
        { env: NATIVE_ENV, spendPolicy: spendPolicy(), config: CONFIG },
      ),
    );
    await workerStep();
    const review = await runAsRole(sqlClient, "qos_app", () =>
      getMenuExtractionReview(
        db,
        adminCaller.tenantId,
        adminCaller.subject,
        uploaded.sourcePublicId,
        run.publicId,
      ),
    );
    const row = review?.candidates[0];
    expect(row).toBeTruthy();

    const response = await PATCH(
      new Request(`http://localhost/api/tenants/${adminCaller.tenantId}/catalogue/menu-extraction/${uploaded.sourcePublicId}/candidates`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          runPublicId: run.publicId,
          expectedVersion: review?.candidatesRevision ?? 0,
          candidates: [
            {
              candidateKey: row!.candidateKey,
              excluded: false,
              payload: {
                ...row!.payload,
                priceText: "-5",
              },
            },
          ],
        }),
      }),
      {
        params: Promise.resolve({
          tenantId: adminCaller.tenantId,
          sourcePublicId: uploaded.sourcePublicId,
        }),
      },
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { field?: string; error?: string };
    expect(body.field).toBe("priceText");
    expect(body.error).toMatch(/zero or greater/i);
  });
});
