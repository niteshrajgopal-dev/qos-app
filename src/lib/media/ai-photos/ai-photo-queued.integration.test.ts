import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  aiJobs,
  aiSpendReservations,
  catalogueMediaAssets,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { claimNextAiJob, finishAiJobStep, markAiJobDispatched } from "@/lib/ai/jobs/ai-job-queue";
import { classifyProviderFailure } from "@/lib/ai/provider-outcome";
import { readAiSpendPolicy } from "@/lib/ai/spend/spend-policy";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import {
  acceptMenuAiPhoto,
  generateMenuAiPhoto,
  getMenuAiPhotos,
  queueMenuAiPhotoBatch,
  type AiPhotoCaller,
} from "@/lib/media/ai-photos/ai-photo-candidates";
import { createAiPhotoJobHandler } from "@/lib/media/ai-photos/ai-photo-job";
import type { AiPhotoConfig } from "@/lib/media/ai-photos/config";
import { AiPhotoProviderError, type AiPhotoProvider } from "@/lib/media/ai-photos/provider";
import { LocalMediaStorage, setMediaStorage } from "@/lib/media/storage";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const QUEUED: AiPhotoConfig = {
  enabled: true,
  provider: "openai",
  openAiApiKey: null,
  model: "gpt-image-1",
  quality: "low",
  dailyLimitPerTenant: 5,
  requestTimeoutMs: 30_000,
  executionMode: "queued_worker",
  queuedStaleMs: 600_000,
};
const SYNC: AiPhotoConfig = { ...QUEUED, executionMode: "sync" };
const LIMITS = { leaseMs: 60_000, maxActiveGlobal: 5, maxActivePerTenant: 5, maxActivePerKind: 5 };
const RETRY = { maxAttempts: 2, baseDelayMs: 1_000, maxDelayMs: 2_000, maxRetryAfterMs: 60_000 };

function spendPolicy(overrides: Record<string, string> = {}) {
  return readAiSpendPolicy({
    AI_SPEND_PLATFORM_CONCURRENCY: "10",
    AI_SPEND_PROVIDER_OPENAI_CONCURRENCY: "10",
    AI_SPEND_AI_PHOTO_ASYNC_ENABLED: "true",
    AI_SPEND_AI_PHOTO_ASYNC_MAX_UNITS_PER_RUN: "1",
    AI_SPEND_AI_PHOTO_ASYNC_TENANT_DAILY_UNITS: "10",
    AI_SPEND_AI_PHOTO_ASYNC_TENANT_MONTHLY_UNITS: "100",
    AI_SPEND_AI_PHOTO_ASYNC_TENANT_CONCURRENCY: "10",
    AI_SPEND_AI_PHOTO_ASYNC_PLATFORM_DAILY_UNITS: "100",
    AI_SPEND_AI_PHOTO_ASYNC_PLATFORM_MONTHLY_UNITS: "1000",
    AI_SPEND_AI_PHOTO_ASYNC_UNSTARTED_EXPIRY_MS: "3600000",
    ...overrides,
  });
}

type Step = "ok" | "rate_limited" | "refused_connection" | "timeout";

function scriptedProvider(steps: Step[]) {
  const calls: { prompt: string; requestId: string }[] = [];
  const provider: AiPhotoProvider = {
    kind: "fake",
    capabilities: { network: false, submitIdempotency: "none", usageReporting: true, internalRetries: 0 },
    async generate(request) {
      calls.push(request);
      const step = steps[Math.min(calls.length - 1, steps.length - 1)] ?? "ok";
      if (step === "rate_limited") {
        throw new AiPhotoProviderError(
          "provider_rate_limited",
          "The image service is busy.",
          null,
          classifyProviderFailure("rejected", { retryable: true, retryAfterMs: 500 }),
        );
      }
      if (step === "refused_connection") {
        throw new AiPhotoProviderError(
          "provider_unreachable",
          "The image service could not be reached.",
          null,
          classifyProviderFailure("not_dispatched", { retryable: true }),
        );
      }
      if (step === "timeout") {
        throw new AiPhotoProviderError("provider_timeout", "The image service took too long.");
      }
      const bytes = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } } })
        .jpeg()
        .toBuffer();
      return { bytes, model: "gpt-image-1", usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 } };
    },
  };
  return { provider, calls };
}

/**
 * PR 5: AI photos on the AI worker. The API only admits (asset, spend
 * reservation and job in one transaction); the worker, as its own restricted
 * role, re-checks live state, commits dispatch evidence before calling the
 * provider, retries only failures that prove nothing was generated, and sends
 * uncertain outcomes to operator review with their spend kept.
 */
integrationDescribe("AI photos on the AI worker", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let mediaRoot: string;

  beforeAll(async () => {
    mediaRoot = await mkdtemp(path.join(tmpdir(), "qos-ai-photo-jobs-"));
    setMediaStorage(new LocalMediaStorage(mediaRoot));
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
    await grantRoleMembership(sqlClient, "qos", "qos_ai_worker");
  }, 120_000);

  afterAll(async () => {
    setMediaStorage(null);
    await sqlClient.end({ timeout: 5 });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.ai_job_attempts, qos.ai_jobs, qos.ai_spend_reservations, qos.ai_spend_tenant_counters, qos.ai_spend_platform_counters, qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: "admin@test", email: "admin@test" }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership!.id, locationId: quotes.location.id });
    const actor = { membershipId: membership!.id, role: "administrator" as const, staffIdentityId: identity!.id };
    const admin: AiPhotoCaller = { tenantId, subject: "admin@test", membership: actor };

    const products = [];
    for (const name of ["latte", "mocha", "cortado"]) {
      products.push(
        await createDraftProduct(db, tenantId, actor, {
          internalName: name,
          translations: { en: { displayName: name, description: `${name} drink` }, ar: { displayName: name, description: "w" } },
          defaultVariant: { amountMinor: 1800, currency: "AED" },
        }),
      );
    }
    const menu = await createDraftMenu(db, tenantId, actor, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "f" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "q" } },
          products: products.map((product, index) => ({ productPublicId: product.publicId, sortOrder: index })),
        },
      ],
    });
    const [latte, mocha, cortado] = products.map((product) => product.publicId) as [string, string, string];
    return { tenantId, admin, membershipId: membership!.id, menu, latte, mocha, cortado };
  }

  function generate(admin: AiPhotoCaller, menuPublicId: string, productPublicId: string, options: { config?: AiPhotoConfig; policy?: ReturnType<typeof spendPolicy>; provider?: AiPhotoProvider } = {}) {
    return runAsRole(sqlClient, "qos_app", () =>
      generateMenuAiPhoto(db, admin, { menuPublicId, productPublicId }, {
        config: options.config ?? QUEUED,
        spendPolicy: options.policy ?? spendPolicy(),
        provider: options.provider,
      }),
    );
  }

  function view(admin: AiPhotoCaller, menuPublicId: string, now?: () => Date) {
    return runAsRole(sqlClient, "qos_app", () =>
      getMenuAiPhotos(db, admin, menuPublicId, { config: QUEUED, spendPolicy: spendPolicy(), now }),
    );
  }

  /** One worker step, exactly as scripts/ai-worker.ts wires it, as the worker role. */
  async function workerStep(provider: AiPhotoProvider, options: { crashAfterDispatch?: boolean } = {}) {
    const handler = createAiPhotoJobHandler(db, { config: QUEUED, provider, retry: RETRY, random: () => 0.5 });
    return runAsRole(sqlClient, "qos_ai_worker", async () => {
      const job = await claimNextAiJob(db, { workerId: "worker-test", jobKinds: ["ai_photo.generate"], limits: LIMITS });
      if (!job) {
        return null;
      }
      if (options.crashAfterDispatch) {
        await markAiJobDispatched(db, job);
        return { job, result: null };
      }
      const result = await handler.step(job, { markDispatched: () => markAiJobDispatched(db, job), leaseLost: () => false });
      await finishAiJobStep(db, job, result);
      return { job, result };
    });
  }

  async function asset(publicId: string) {
    const [row] = await db.select().from(catalogueMediaAssets).where(eq(catalogueMediaAssets.publicId, publicId));
    return row!;
  }

  async function reservation(assetPublicId: string) {
    const [row] = await db.select().from(aiSpendReservations).where(eq(aiSpendReservations.subjectPublicId, assetPublicId));
    return row!;
  }

  async function makeJobsDue() {
    await sqlClient`UPDATE qos.ai_jobs SET next_attempt_at = now() WHERE status = 'queued'`;
  }

  it("admits atomically without contacting the provider, then generates on the worker", async () => {
    const { admin, menu, latte } = await seed();
    const { provider, calls } = scriptedProvider(["ok"]);

    const admitted = await generate(admin, menu.publicId, latte, { provider });
    expect(admitted).toMatchObject({ created: true, queued: true, candidate: { status: "generating" } });
    expect(calls).toHaveLength(0);
    const pending = await asset(admitted.candidate.assetPublicId);
    expect(pending.generationMetadata).toMatchObject({ executionMode: "queued_worker", spendReservationPublicId: expect.stringMatching(/^spr_/) });
    expect(await reservation(pending.publicId)).toMatchObject({ state: "reserved", dispatchedAt: null, subjectType: "catalogue_media_asset" });
    const [job] = await db.select().from(aiJobs);
    expect(job).toMatchObject({ jobKind: "ai_photo.generate", mediaAssetId: pending.id, agentRunId: null, status: "queued" });

    // A replay while queued never admits a second request.
    await expect(generate(admin, menu.publicId, latte, { provider })).rejects.toMatchObject({ code: "generation_in_progress" });

    const step = await workerStep(provider);
    expect(step!.result).toEqual({ type: "completed" });
    expect(calls).toEqual([expect.objectContaining({ requestId: pending.publicId })]);
    const stored = await asset(pending.publicId);
    expect(stored.status).toBe("uploaded");
    expect(stored.generationMetadata).toMatchObject({ completedAt: expect.any(String), usage: { totalTokens: 30 } });
    expect(await reservation(pending.publicId)).toMatchObject({ state: "consumed", outcome: "completed", reportedUsage: { total_tokens: 30 } });
    const [attempt] = await sqlClient<{ dispatched: boolean }[]>`SELECT dispatched_at IS NOT NULL AS dispatched FROM qos.ai_job_attempts`;
    expect(attempt!.dispatched).toBe(true);

    const current = await view(admin, menu.publicId);
    expect(current.availability).toMatchObject({ executionMode: "queued_worker", usedToday: 1 });
    expect(current.candidates).toEqual([expect.objectContaining({ status: "pending_review", productPublicId: latte })]);
    const accepted = await runAsRole(sqlClient, "qos_app", () =>
      acceptMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, assetPublicId: pending.publicId, accuracyConfirmed: true }),
    );
    expect(accepted.status).toBe("accepted");
  });

  it("refuses queued mode without an ai_photo.async spend policy and never falls back to sync", async () => {
    const { admin, menu, latte } = await seed();
    const { provider, calls } = scriptedProvider(["ok"]);
    const unset = readAiSpendPolicy({});

    await expect(generate(admin, menu.publicId, latte, { provider, policy: unset })).rejects.toMatchObject({
      code: "spend_policy_unset",
      statusCode: 409,
    });
    const unavailable = await runAsRole(sqlClient, "qos_app", () =>
      getMenuAiPhotos(db, admin, menu.publicId, { config: QUEUED, spendPolicy: unset }),
    );
    expect(unavailable.availability).toMatchObject({ available: false, unavailableReason: "spend_policy_unset", canGenerate: false });
    expect(calls).toHaveLength(0);
    expect(await db.select().from(catalogueMediaAssets)).toHaveLength(0);
  });

  it("admits what fits in a batch and reports every item", async () => {
    const { admin, menu, latte, mocha, cortado } = await seed();
    const { provider } = scriptedProvider(["ok"]);
    const first = await generate(admin, menu.publicId, latte, { provider });

    const limited = { ...QUEUED, dailyLimitPerTenant: 2 };
    const { items } = await runAsRole(sqlClient, "qos_app", () =>
      queueMenuAiPhotoBatch(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicIds: [latte, mocha, cortado, "prd_not_on_menu", mocha] },
        { config: limited, spendPolicy: spendPolicy() },
      ),
    );
    expect(items.map((item) => [item.productPublicId, item.outcome])).toEqual([
      [latte, "in_progress"],
      [mocha, "queued"],
      [cortado, "daily_limit_reached"],
      ["prd_not_on_menu", "product_not_in_menu"],
    ]);
    expect(await db.select().from(aiJobs)).toHaveLength(2);
    expect(first.queued).toBe(true);

    // A spend refusal is reported per item and leaves nothing behind for it.
    const tight = spendPolicy({ AI_SPEND_AI_PHOTO_ASYNC_TENANT_CONCURRENCY: "2" });
    const refused = await runAsRole(sqlClient, "qos_app", () =>
      queueMenuAiPhotoBatch(db, admin, { menuPublicId: menu.publicId, productPublicIds: [cortado] }, { config: QUEUED, spendPolicy: tight }),
    );
    expect(refused.items).toEqual([expect.objectContaining({ productPublicId: cortado, outcome: "tenant_concurrency_limit", candidate: null })]);
    expect(await db.select().from(catalogueMediaAssets)).toHaveLength(2);

    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        queueMenuAiPhotoBatch(db, admin, { menuPublicId: menu.publicId, productPublicIds: [cortado] }, { config: SYNC, spendPolicy: spendPolicy() }),
      ),
    ).rejects.toMatchObject({ code: "batch_unavailable" });
  });

  it("retries only failures that prove nothing was generated, with backoff, and keeps them unbilled when exhausted", async () => {
    const { admin, menu, latte, mocha } = await seed();
    const recovering = scriptedProvider(["rate_limited", "ok"]);
    const first = await generate(admin, menu.publicId, latte);

    const retried = await workerStep(recovering.provider);
    expect(retried!.result).toMatchObject({ type: "reschedule", providerOutcome: "rejected", code: "provider_rate_limited" });
    expect((retried!.result as { delayMs: number }).delayMs).toBeGreaterThanOrEqual(1_000);
    expect((await asset(first.candidate.assetPublicId)).status).toBe("pending_upload");
    expect(await reservation(first.candidate.assetPublicId)).toMatchObject({ state: "reserved", dispatchedAt: expect.any(Date) });
    await makeJobsDue();
    expect((await workerStep(recovering.provider))!.result).toEqual({ type: "completed" });
    expect(recovering.calls).toHaveLength(2);
    expect((await asset(first.candidate.assetPublicId)).status).toBe("uploaded");

    const refusing = scriptedProvider(["refused_connection"]);
    const second = await generate(admin, menu.publicId, mocha);
    expect((await workerStep(refusing.provider))!.result).toMatchObject({ type: "reschedule" });
    await makeJobsDue();
    expect((await workerStep(refusing.provider))!.result).toMatchObject({
      type: "failed",
      code: "provider_unreachable",
      providerOutcome: "not_dispatched",
    });
    expect(refusing.calls).toHaveLength(2);
    expect((await asset(second.candidate.assetPublicId)).generationMetadata).toMatchObject({
      failureCode: "provider_unreachable",
      providerOutcome: "not_dispatched",
    });
    expect(await reservation(second.candidate.assetPublicId)).toMatchObject({ state: "released", outcome: "not_dispatched" });
    expect((await view(admin, menu.publicId)).availability.usedToday).toBe(1);
  });

  it("never resends uncertain work: it goes to operator review and keeps counting", async () => {
    const { admin, menu, latte, mocha } = await seed();
    const timing = scriptedProvider(["timeout"]);
    const timedOut = await generate(admin, menu.publicId, latte);
    expect((await workerStep(timing.provider))!.result).toMatchObject({
      type: "operator_review",
      code: "provider_timeout",
      providerOutcome: "submission_unknown",
    });
    expect(timing.calls).toHaveLength(1);
    expect(await reservation(timedOut.candidate.assetPublicId)).toMatchObject({ state: "uncertain" });
    expect((await asset(timedOut.candidate.assetPublicId)).status).toBe("failed");

    // A worker that died after committing dispatch evidence: the next claim
    // must not call the provider again.
    const crashed = await generate(admin, menu.publicId, mocha);
    await workerStep(timing.provider, { crashAfterDispatch: true });
    await sqlClient`UPDATE qos.ai_jobs SET lease_expires_at = now() - interval '1 second' WHERE status = 'leased'`;
    const untouched = scriptedProvider(["ok"]);
    expect((await workerStep(untouched.provider))!.result).toMatchObject({ type: "operator_review", code: "outcome_unknown" });
    expect(untouched.calls).toHaveLength(0);
    expect((await asset(crashed.candidate.assetPublicId)).generationMetadata).toMatchObject({
      failureCode: "outcome_unknown",
      providerOutcome: "submission_unknown",
    });

    const current = await view(admin, menu.publicId);
    expect(current.availability.usedToday).toBe(2);
    const statuses = await db.select({ status: aiJobs.status }).from(aiJobs);
    expect(statuses.map((row) => row.status).sort()).toEqual(["operator_review", "operator_review"]);
  });

  it("re-checks the requester and the item before spending", async () => {
    const { tenantId, admin, membershipId, menu, latte, mocha } = await seed();
    const { provider, calls } = scriptedProvider(["ok"]);
    const revoked = await generate(admin, menu.publicId, latte);
    await db.update(staffMemberships).set({ role: "user" }).where(eq(staffMemberships.id, membershipId));
    expect((await workerStep(provider))!.result).toMatchObject({ type: "failed", code: "requester_access_revoked" });
    expect(await reservation(revoked.candidate.assetPublicId)).toMatchObject({ state: "released", outcome: "released_unstarted" });
    await db.update(staffMemberships).set({ role: "administrator" }).where(eq(staffMemberships.id, membershipId));

    const archived = await generate(admin, menu.publicId, mocha);
    await sqlClient`UPDATE qos.catalogue_products SET status = 'archived' WHERE tenant_id = ${tenantId}::uuid AND public_id = ${mocha}`;
    expect((await workerStep(provider))!.result).toMatchObject({ type: "failed", code: "product_unavailable" });
    expect(await reservation(archived.candidate.assetPublicId)).toMatchObject({ state: "released" });

    expect(calls).toHaveLength(0);
    expect((await view(admin, menu.publicId)).availability.usedToday).toBe(0);
  });

  it("cancels queued requests no worker claimed in time, but never claimed ones", async () => {
    const { admin, menu, latte, mocha } = await seed();
    const requests = [await generate(admin, menu.publicId, latte), await generate(admin, menu.publicId, mocha)];
    await workerStep(scriptedProvider(["ok"]).provider, { crashAfterDispatch: true });
    const [leased] = await db.select().from(aiJobs).where(eq(aiJobs.status, "leased"));

    const later = () => new Date(Date.now() + QUEUED.queuedStaleMs + 1_000);
    const current = await view(admin, menu.publicId, later);

    const assets = await Promise.all(requests.map((request) => asset(request.candidate.assetPublicId)));
    const held = assets.find((row) => row.id === leased!.mediaAssetId)!;
    const stale = assets.find((row) => row.id !== leased!.mediaAssetId)!;
    expect(stale.status).toBe("failed");
    expect(stale.generationMetadata).toMatchObject({ failureCode: "not_started_in_time" });
    expect(await reservation(stale.publicId)).toMatchObject({ state: "released", outcome: "released_unstarted" });
    expect(held.status).toBe("pending_upload");
    const jobs = await db.select({ status: aiJobs.status, mediaAssetId: aiJobs.mediaAssetId }).from(aiJobs);
    expect(jobs.find((job) => job.mediaAssetId === stale.id)!.status).toBe("cancelled");
    expect(current.availability.usedToday).toBe(1);
  });

  it("counts an unreachable failure against the allowance unless it proves nothing was sent", async () => {
    const { admin, menu, latte, mocha } = await seed();
    const unreachable = (outcome: "not_dispatched" | "submission_unknown"): AiPhotoProvider => ({
      kind: "fake",
      capabilities: { network: false, submitIdempotency: "none", usageReporting: true, internalRetries: 0 },
      async generate() {
        throw new AiPhotoProviderError("provider_unreachable", "Unreachable.", null, classifyProviderFailure(outcome));
      },
    });

    const refused = await generate(admin, menu.publicId, latte, { config: SYNC, provider: unreachable("not_dispatched") });
    expect(refused.candidate).toMatchObject({ status: "failed", failureCode: "provider_unreachable" });
    expect((await view(admin, menu.publicId)).availability.usedToday).toBe(0);

    const reset = await generate(admin, menu.publicId, mocha, { config: SYNC, provider: unreachable("submission_unknown") });
    expect((await asset(reset.candidate.assetPublicId)).generationMetadata).toMatchObject({ providerOutcome: "submission_unknown" });
    expect((await view(admin, menu.publicId)).availability.usedToday).toBe(1);
  });

  it("keeps the two modes apart: sync never recreates a queued request", async () => {
    const { admin, menu, latte } = await seed();
    const { provider, calls } = scriptedProvider(["ok"]);
    await generate(admin, menu.publicId, latte);
    await expect(generate(admin, menu.publicId, latte, { config: SYNC, provider })).rejects.toMatchObject({
      code: "generation_in_progress",
    });
    expect(calls).toHaveLength(0);
    const rows = await db
      .select()
      .from(catalogueMediaAssets)
      .where(and(eq(catalogueMediaAssets.sourceProvenance, "ai_generated")));
    expect(rows).toHaveLength(1);
  });
});
