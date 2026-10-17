import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  agentRunCatalogueMenuExtractionDecisions,
  agentRuns,
  catalogueMenuExtractionCandidates,
  catalogueProducts,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
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
  getMenuExtractionReview,
  rejectMenuExtraction,
  requestMenuExtraction,
  updateMenuExtractionCandidates,
} from "@/lib/catalogue/menu-extraction/service";
import {
  setMenuExtractionVisionProviderForTesting,
  type MenuExtractionVisionProvider,
} from "@/lib/catalogue/menu-extraction/vision-provider";
import {
  MenuExtractionUploadError,
  uploadMenuExtractionSource,
} from "@/lib/catalogue/menu-extraction/upload";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe.sequential : describe.skip;

const ADMIN_SUBJECT = "admin.menu-hardening@test";
const NATIVE_ENV: Record<string, string> = {
  AGENTS_ENABLED: "true",
  AGENT_NATIVE_MODEL_PROVIDER: "mock",
  AGENT_NATIVE_MODEL: "fake-model",
  AGENT_OPENAI_TASK_MODEL_ALLOWLIST:
    "catalogue.menu_extraction=fake-vision,catalogue.description=fake-model",
  NODE_ENV: "test",
  MEDIA_STORAGE_ROOT: path.join(process.cwd(), ".tmp/menu-extraction-hardening-media"),
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

function duplicateKeyReply() {
  const item = {
    candidateKey: "dup-key",
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
  };
  return JSON.stringify({
    schema: MENU_EXTRACTION_RESULT_SCHEMA,
    items: [item, { ...item, displayNameEn: "Second duplicate" }],
  });
}

integrationDescribe("catalogue menu extraction hardening (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let visionComplete: ReturnType<typeof vi.fn>;
  let adminCaller: {
    tenantId: string;
    subject: string;
    membership: Awaited<ReturnType<typeof requireActiveStaffMembership>>;
  };

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
      text: duplicateKeyReply(),
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
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId: quotes.tenant.id, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({
      tenantId: quotes.tenant.id,
      staffMembershipId: membership!.id,
      locationId: quotes.location.id,
    });
    adminCaller = {
      tenantId: quotes.tenant.id,
      subject: ADMIN_SUBJECT,
      membership: await runAsRole(sqlClient, "qos_app", () =>
        requireActiveStaffMembership(db, quotes.tenant.id, ADMIN_SUBJECT),
      ),
    };
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

  async function workerStep(reply?: string) {
    if (reply) {
      visionComplete.mockResolvedValue({
        text: reply,
        usage: { input_tokens: 3, output_tokens: 8, total_tokens: 11 },
      });
    }
    const handler = createCatalogueMenuExtractionJobHandler(db, {
      config: CONFIG,
      vision: {
        kind: "mock",
        complete: visionComplete as MenuExtractionVisionProvider["complete"],
      },
    });
    return runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, {
        workerId: "worker-menu-hardening",
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

  it("replays identical uploads by content hash", async () => {
    const first = await uploadPng();
    const second = await uploadPng();
    expect(second.replayed).toBe(true);
    expect(second.sourcePublicId).toBe(first.sourcePublicId);
  });

  it("rejects fake PDF extensions that are not PDF bytes", async () => {
    const bytes = Buffer.from("not-a-pdf");
    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        uploadMenuExtractionSource(db, adminCaller.tenantId, adminCaller.membership, adminCaller.subject, {
          fileName: "menu.pdf",
          bytes,
          contentType: "application/pdf",
        }),
      ),
    ).rejects.toBeInstanceOf(MenuExtractionUploadError);
  });

  it("completes extraction when the model returns duplicate keys", async () => {
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
    const step = await workerStep();
    expect(step?.result).toEqual({ type: "completed" });
    const [storedRun] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    expect(storedRun?.status).toBe("completed");
    const candidates = await db
      .select()
      .from(catalogueMenuExtractionCandidates)
      .where(eq(catalogueMenuExtractionCandidates.agentRunId, storedRun!.id));
    expect(candidates.length).toBe(1);
  });

  it("rejects stale grid edits with 409", async () => {
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
    await workerStep(
      JSON.stringify({
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
    );
    const review = await runAsRole(sqlClient, "qos_app", () =>
      getMenuExtractionReview(
        db,
        adminCaller.tenantId,
        adminCaller.subject,
        uploaded.sourcePublicId,
        run.publicId,
      ),
    );
    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        updateMenuExtractionCandidates(db, adminCaller, uploaded.sourcePublicId, {
          runPublicId: run.publicId,
          expectedVersion: (review?.candidatesRevision ?? 0) - 1,
          candidates: [],
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("serializes concurrent confirm and reject without 500s", async () => {
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
    await workerStep(
      JSON.stringify({
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
    );
    const review = await runAsRole(sqlClient, "qos_app", () =>
      getMenuExtractionReview(
        db,
        adminCaller.tenantId,
        adminCaller.subject,
        uploaded.sourcePublicId,
        run.publicId,
      ),
    );
    const revision = review?.candidatesRevision ?? 0;
    const results = await Promise.allSettled([
      runAsRole(sqlClient, "qos_app", () =>
        confirmMenuExtraction(db, adminCaller, uploaded.sourcePublicId, {
          runPublicId: run.publicId,
          expectedVersion: revision,
          importIdempotencyKey: `confirm-a-${randomBytes(4).toString("hex")}`,
        }),
      ),
      runAsRole(sqlClient, "qos_app", () =>
        rejectMenuExtraction(db, adminCaller, uploaded.sourcePublicId, {
          runPublicId: run.publicId,
        }),
      ),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    const [storedRun] = await db.select().from(agentRuns).where(eq(agentRuns.publicId, run.publicId));
    const [decision] = await db
      .select()
      .from(agentRunCatalogueMenuExtractionDecisions)
      .where(
        and(
          eq(agentRunCatalogueMenuExtractionDecisions.tenantId, adminCaller.tenantId),
          eq(agentRunCatalogueMenuExtractionDecisions.agentRunId, storedRun!.id),
        ),
      );
    expect(decision).toBeTruthy();
    const products = await db.select().from(catalogueProducts);
    if (decision?.decision === "confirmed") {
      expect(products.length).toBeGreaterThan(0);
    } else {
      expect(products.length).toBe(0);
    }
  });
});
