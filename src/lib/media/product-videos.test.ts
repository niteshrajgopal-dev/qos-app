import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { createDraftProduct } from "@/lib/catalogue/products";
import {
  createProductVideoUploadGrant,
  getApprovedProductVideoUrls,
  getProductVideoJobStatus,
  ingestProductVideoUpload,
  queueProductVideoProcessing,
} from "@/lib/media/product-videos";
import {
  LocalMediaStorage,
  setMediaStorage,
  type MediaStorage,
} from "@/lib/media/storage";
import { readVideoProcessingConfig } from "@/lib/media/video-config";
import {
  claimNextQueuedJob,
  processVideoJob,
  VideoJobError,
} from "@/lib/media/video-job-queue";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const VALID_VIDEO_PATH = path.join(
  __dirname,
  "../../../fixtures/media/valid-2sec-video.mp4",
);
const OVERLIMIT_VIDEO_PATH = path.join(
  __dirname,
  "../../../fixtures/media/overlimit-duration.mp4",
);
const CORRUPT_VIDEO_PATH = path.join(
  __dirname,
  "../../../fixtures/media/corrupt.mp4",
);

// Must be known at collection time: it.skipIf() reads it before beforeAll runs.
const ffmpegAvailable =
  spawnSync("ffprobe", ["-version"]).status === 0 &&
  spawnSync("ffmpeg", ["-version"]).status === 0;

const testConfig = {
  ...readVideoProcessingConfig({}),
  maxActiveJobsPerTenant: 1,
  maxRetries: 3,
  retryBackoffMs: 60_000,
};

/** Delegates to local storage but fails every source read, like a blob outage. */
class UnreadableSourceStorage implements MediaStorage {
  constructor(private readonly inner: MediaStorage) {}
  writePrivate(p: string, b: Buffer) {
    return this.inner.writePrivate(p, b);
  }
  readPrivate(): Promise<Buffer> {
    return Promise.reject(new Error("simulated blob outage"));
  }
  writePublic(p: string, b: Buffer) {
    return this.inner.writePublic(p, b);
  }
  readPublic(p: string) {
    return this.inner.readPublic(p);
  }
}

integrationDescribe("product video upload and processing", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tempMediaRoot: string;
  let localStorage: LocalMediaStorage;
  let admin: ActiveStaffMembership;
  let tenantId: string;
  
  const productInput = {
    internalName: "test-video-product",
    translations: {
      en: { displayName: "Test Video Product", description: "Video test" },
      ar: { displayName: "منتج الفيديو التجريبي", description: "اختبار الفيديو" },
    },
    defaultVariant: { amountMinor: 1000, currency: "AED" },
  } as const;

  beforeAll(async () => {
    tempMediaRoot = await mkdtemp(path.join(tmpdir(), "qos-video-"));
    localStorage = new LocalMediaStorage(tempMediaRoot);
    setMediaStorage(localStorage);

    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  });

  afterAll(async () => {
    setMediaStorage(null);
    await sqlClient.end({ timeout: 5 });
    await rm(tempMediaRoot, { recursive: true, force: true });
  });

  async function seedAdministrator(
    tenantId: string,
    subject = "admin@test",
    email = "admin@test",
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId,
        staffIdentityId: identity.id,
        role: "administrator",
      })
      .returning();

    return {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };
  }

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.video_processing_jobs, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;

    const hierarchy = await createTenantHierarchy(db, {
      tenant: {
        publicId: "ten-quotes-video-test",
        name: "Quotes Video Test",
        businessProfile: "hospitality",
        baseCurrency: "AED",
        defaultLocale: "en",
        defaultTimezone: "Asia/Dubai",
        supportedLocales: ["en", "ar"],
      },
      organization: {
        publicId: "org-quotes-video",
        name: "Quotes Video Org",
      },
      brand: {
        publicId: "br-quotes-video-test",
        name: "Quotes Video",
      },
      location: {
        publicId: "loc-quotes-video-downtown",
        name: "Downtown",
        slug: "downtown",
        timezone: "Asia/Dubai",
      },
    });
    
    tenantId = hierarchy.tenant.id;
    admin = await seedAdministrator(tenantId);
  });

  it("creates a video upload grant with bounded size limit", async () => {
    const product = await createDraftProduct(
      db,
      tenantId,
      admin,
      productInput,
    );

    const grant = await createProductVideoUploadGrant(
      db,
      tenantId,
      admin,
      product.publicId,
      {
        byteSize: 1024 * 1024,
        contentType: "video/mp4",
      },
    );

    expect(grant.assetPublicId).toMatch(/^mas_/);
    expect(grant.grantToken).toHaveLength(32);
    expect(grant.uploadPath).toContain(product.publicId);
  });

  it("rejects video upload grant exceeding configured byte limit", async () => {
    const product = await createDraftProduct(
      db,
      tenantId,
      admin,
      productInput,
    );

    await expect(
      createProductVideoUploadGrant(db, tenantId, admin, product.publicId, {
        byteSize: 50 * 1024 * 1024,
        contentType: "video/mp4",
      }),
    ).rejects.toThrow(/owner-locked limit/);
  });

  it("rejects non-mp4 content type", async () => {
    const product = await createDraftProduct(
      db,
      tenantId,
      admin,
      productInput,
    );

    await expect(
      createProductVideoUploadGrant(db, tenantId, admin, product.publicId, {
        byteSize: 1024 * 1024,
        contentType: "video/webm",
      }),
    ).rejects.toThrow(/video\/mp4/);
  });

  it("ingests a valid video upload and marks it uploaded", async () => {
    const product = await createDraftProduct(
      db,
      tenantId,
      admin,
      productInput,
    );

    const videoBytes = await readFile(VALID_VIDEO_PATH);

    const grant = await createProductVideoUploadGrant(
      db,
      tenantId,
      admin,
      product.publicId,
      {
        byteSize: videoBytes.length,
        contentType: "video/mp4",
      },
    );

    const result = await ingestProductVideoUpload(
      db,
      tenantId,
      product.publicId,
      grant.grantToken,
      videoBytes,
    );

    expect(result.assetPublicId).toBe(grant.assetPublicId);
    expect(result.status).toBe("uploaded");
  });

  it("rejects video upload with wrong byte size", async () => {
    const product = await createDraftProduct(
      db,
      tenantId,
      admin,
      productInput,
    );

    const grant = await createProductVideoUploadGrant(
      db,
      tenantId,
      admin,
      product.publicId,
      {
        byteSize: 1024,
        contentType: "video/mp4",
      },
    );

    const videoBytes = await readFile(VALID_VIDEO_PATH);

    await expect(
      ingestProductVideoUpload(
        db,
        tenantId,
        product.publicId,
        grant.grantToken,
        videoBytes,
      ),
    ).rejects.toThrow(/size does not match/);
  });

  it("queues video processing after successful upload", async () => {
    const product = await createDraftProduct(
      db,
      tenantId,
      admin,
      productInput,
    );

    const videoBytes = await readFile(VALID_VIDEO_PATH);

    const grant = await createProductVideoUploadGrant(
      db,
      tenantId,
      admin,
      product.publicId,
      {
        byteSize: videoBytes.length,
        contentType: "video/mp4",
      },
    );

    await ingestProductVideoUpload(
      db,
      tenantId,
      product.publicId,
      grant.grantToken,
      videoBytes,
    );

    const queueResult = await queueProductVideoProcessing(
      db,
      tenantId,
      admin,
      product.publicId,
      grant.assetPublicId,
    );

    expect(queueResult.status).toBe("processing");
    expect(queueResult.correlationId).toMatch(/^vjob_/);
    expect(queueResult.jobId).toBeTruthy();
  });

  let productSeq = 0;

  async function queueUploadedVideo(
    forTenantId: string,
    membership: ActiveStaffMembership,
    fixture: string | Buffer = VALID_VIDEO_PATH,
  ) {
    productSeq += 1;
    const product = await createDraftProduct(db, forTenantId, membership, {
      ...productInput,
      internalName: `test-video-product-${productSeq}`,
    });
    const videoBytes =
      typeof fixture === "string" ? await readFile(fixture) : fixture;
    const grant = await createProductVideoUploadGrant(
      db,
      forTenantId,
      membership,
      product.publicId,
      { byteSize: videoBytes.length, contentType: "video/mp4" },
    );
    await ingestProductVideoUpload(
      db,
      forTenantId,
      product.publicId,
      grant.grantToken,
      videoBytes,
    );
    const queued = await queueProductVideoProcessing(
      db,
      forTenantId,
      membership,
      product.publicId,
      grant.assetPublicId,
    );
    return { ...queued, productPublicId: product.publicId };
  }

  async function createSecondTenant() {
    const hierarchy = await createTenantHierarchy(db, {
      tenant: {
        publicId: "ten-florea-video-test",
        name: "Florea Video Test",
        businessProfile: "generic_retail",
        baseCurrency: "AED",
        defaultLocale: "en",
        defaultTimezone: "Asia/Dubai",
        supportedLocales: ["en", "ar"],
      },
      organization: { publicId: "org-florea-video", name: "Florea Video Org" },
      brand: { publicId: "br-florea-video-test", name: "Florea Video" },
      location: {
        publicId: "loc-florea-video-marina",
        name: "Marina",
        slug: "marina",
        timezone: "Asia/Dubai",
      },
    });
    const membership = await seedAdministrator(
      hierarchy.tenant.id,
      "admin-florea@test",
      "admin-florea@test",
    );
    return { tenantId: hierarchy.tenant.id, membership };
  }

  async function makeAllJobsDue() {
    await sqlClient`UPDATE qos.video_processing_jobs SET next_attempt_at = now() - interval '1 second'`;
  }

  async function assetState(assetPublicId: string) {
    const rows = await sqlClient`
      SELECT status, failure_reason FROM qos.catalogue_media_assets WHERE public_id = ${assetPublicId}
    `;
    return rows[0] as { status: string; failure_reason: string | null };
  }

  describe("claiming, fairness and recovery", () => {
    afterEach(() => {
      setMediaStorage(localStorage);
    });

    it("serves the least recently served tenant first instead of FIFO", async () => {
      const tenantB = await createSecondTenant();
      const a1 = await queueUploadedVideo(tenantId, admin);
      const a2 = await queueUploadedVideo(tenantId, admin);
      const a3 = await queueUploadedVideo(tenantId, admin);
      const b1 = await queueUploadedVideo(tenantB.tenantId, tenantB.membership);
      const config = { ...testConfig, maxActiveJobsPerTenant: 2 };

      const first = await claimNextQueuedJob(db, { workerId: "w1", config });
      const second = await claimNextQueuedJob(db, { workerId: "w2", config });
      const third = await claimNextQueuedJob(db, { workerId: "w3", config });

      expect(first?.correlationId).toBe(a1.correlationId);
      // B jumps ahead of A's older backlog because A was just served.
      expect(second?.correlationId).toBe(b1.correlationId);
      expect(third?.correlationId).toBe(a2.correlationId);
      expect(a3.correlationId).toBeTruthy();
    });

    it("never gives one tenant more than its active-job cap", async () => {
      const tenantB = await createSecondTenant();
      const a1 = await queueUploadedVideo(tenantId, admin);
      const a2 = await queueUploadedVideo(tenantId, admin);
      const b1 = await queueUploadedVideo(tenantB.tenantId, tenantB.membership);

      const first = await claimNextQueuedJob(db, { workerId: "w1", config: testConfig });
      const second = await claimNextQueuedJob(db, { workerId: "w2", config: testConfig });
      const third = await claimNextQueuedJob(db, { workerId: "w3", config: testConfig });

      expect(first?.correlationId).toBe(a1.correlationId);
      expect(second?.correlationId).toBe(b1.correlationId);
      expect(third).toBeNull();

      await sqlClient`UPDATE qos.video_processing_jobs SET status = 'ready' WHERE id = ${first!.jobId}`;
      const fourth = await claimNextQueuedJob(db, { workerId: "w4", config: testConfig });
      expect(fourth?.correlationId).toBe(a2.correlationId);
    });

    it("re-queues a transient failure with backoff instead of retrying immediately", async () => {
      setMediaStorage(new UnreadableSourceStorage(localStorage));
      const queued = await queueUploadedVideo(tenantId, admin);

      const job = await claimNextQueuedJob(db, { workerId: "w1", config: testConfig });
      await expect(processVideoJob(db, job!, { config: testConfig })).rejects.toThrow(
        /simulated blob outage/,
      );

      const status = await getProductVideoJobStatus(db, tenantId, admin, queued.correlationId);
      expect(status.status).toBe("queued");
      expect(status.retryCount).toBe(1);
      expect(status.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
      expect(await claimNextQueuedJob(db, { workerId: "w2", config: testConfig })).toBeNull();
    });

    it("quarantines after exhausted retries and rejects the asset", async () => {
      setMediaStorage(new UnreadableSourceStorage(localStorage));
      const queued = await queueUploadedVideo(tenantId, admin);

      for (let attempt = 0; attempt < testConfig.maxRetries; attempt++) {
        await makeAllJobsDue();
        const job = await claimNextQueuedJob(db, { workerId: `w${attempt}`, config: testConfig });
        expect(job).not.toBeNull();
        await expect(processVideoJob(db, job!, { config: testConfig })).rejects.toThrow();
      }

      await makeAllJobsDue();
      expect(await claimNextQueuedJob(db, { workerId: "wx", config: testConfig })).toBeNull();

      const status = await getProductVideoJobStatus(db, tenantId, admin, queued.correlationId);
      expect(status.status).toBe("quarantined");
      expect(status.retryCount).toBe(testConfig.maxRetries);
      expect(status.lastErrorMessage).toMatch(/simulated blob outage/);
      const asset = await assetState(queued.assetPublicId);
      expect(asset.status).toBe("rejected");
      expect(asset.failure_reason).toMatch(/^Quarantined after 3 attempts/);
    });

    it("reclaims a job whose worker lease expired and fences out the stale worker", async () => {
      setMediaStorage(new UnreadableSourceStorage(localStorage));
      const queued = await queueUploadedVideo(tenantId, admin);

      const stale = await claimNextQueuedJob(db, { workerId: "dead-worker", config: testConfig });
      expect(stale).not.toBeNull();
      await sqlClient`UPDATE qos.video_processing_jobs SET lease_expires_at = now() - interval '1 second'`;

      const reclaimed = await claimNextQueuedJob(db, { workerId: "live-worker", config: testConfig });
      expect(reclaimed?.jobId).toBe(stale!.jobId);
      expect(reclaimed?.retryCount).toBe(1);

      // The stale worker finishing late must not overwrite the live worker's state.
      await expect(processVideoJob(db, stale!, { config: testConfig })).rejects.toThrow();
      const rows = await sqlClient`
        SELECT status, claimed_by, retry_count FROM qos.video_processing_jobs WHERE id = ${stale!.jobId}
      `;
      expect(rows[0]).toMatchObject({
        status: "processing",
        claimed_by: "live-worker",
        retry_count: 1,
      });

      const status = await getProductVideoJobStatus(db, tenantId, admin, queued.correlationId);
      expect(status.lastErrorMessage).toMatch(/lease expired.*dead-worker/);
    });

    it("exposes a scale-to-zero signal that counts due and in-flight jobs as qos_app", async () => {
      const tenantB = await createSecondTenant();
      const countAsApp = () =>
        runAsRole(sqlClient, "qos_app", async () => {
          const rows = await sqlClient`SELECT qos.count_active_video_processing_jobs() AS n`;
          return Number((rows[0] as { n: string }).n);
        });

      expect(await countAsApp()).toBe(0);

      const a1 = await queueUploadedVideo(tenantId, admin);
      await queueUploadedVideo(tenantB.tenantId, tenantB.membership);
      expect(await countAsApp()).toBe(2);

      // In-flight jobs keep the worker up; backed-off and finished jobs do not.
      const claimed = await claimNextQueuedJob(db, { workerId: "w1", config: testConfig });
      expect(claimed?.correlationId).toBe(a1.correlationId);
      expect(await countAsApp()).toBe(2);

      await sqlClient`UPDATE qos.video_processing_jobs SET status = 'ready' WHERE id = ${claimed!.jobId}`;
      await sqlClient`UPDATE qos.video_processing_jobs SET next_attempt_at = now() + interval '10 minutes' WHERE status = 'queued'`;
      expect(await countAsApp()).toBe(0);
    });

    it("claims and records failures as qos_app under tenant RLS", async () => {
      setMediaStorage(new UnreadableSourceStorage(localStorage));
      const queued = await queueUploadedVideo(tenantId, admin);

      await runAsRole(sqlClient, "qos_app", async () => {
        const job = await claimNextQueuedJob(db, { workerId: "app-worker", config: testConfig });
        expect(job?.correlationId).toBe(queued.correlationId);
        await expect(processVideoJob(db, job!, { config: testConfig })).rejects.toBeInstanceOf(
          VideoJobError,
        );
        const status = await getProductVideoJobStatus(db, tenantId, admin, queued.correlationId);
        expect(status.status).toBe("queued");
        expect(status.retryCount).toBe(1);
      });
    });
  });

  it.skipIf(!ffmpegAvailable)("processes queued video job to generate playback and poster", async () => {
    const queued = await queueUploadedVideo(tenantId, admin);

    const job = await claimNextQueuedJob(db, { config: testConfig });
    expect(job?.correlationId).toBe(queued.correlationId);
    await processVideoJob(db, job!, { config: testConfig });

    const status = await getProductVideoJobStatus(db, tenantId, admin, queued.correlationId);
    expect(status.status).toBe("ready");
    expect(status.completedAt).toBeTruthy();

    const urls = await getApprovedProductVideoUrls(db, tenantId, queued.productPublicId);
    expect(urls?.playbackUrl).toMatch(/^\/api\/media\/public\/mvp_/);
    expect(urls?.posterUrl).toMatch(/^\/api\/media\/public\/mpo_/);
  });

  it.skipIf(!ffmpegAvailable)("rejects an over-duration video on the first attempt", async () => {
    const queued = await queueUploadedVideo(tenantId, admin, OVERLIMIT_VIDEO_PATH);

    const job = await claimNextQueuedJob(db, { config: testConfig });
    await expect(processVideoJob(db, job!, { config: testConfig })).rejects.toThrow(/duration/);

    const status = await getProductVideoJobStatus(db, tenantId, admin, queued.correlationId);
    expect(status.status).toBe("rejected");
    expect(status.retryCount).toBe(1);
    expect(status.lastErrorMessage).toContain("duration");
    expect((await assetState(queued.assetPublicId)).status).toBe("rejected");
  });

  it("keeps non-MP4 bytes out of the queue at upload time", async () => {
    await expect(queueUploadedVideo(tenantId, admin, CORRUPT_VIDEO_PATH)).rejects.toThrow(
      /do not match the declared video content type/,
    );
  });

  it.skipIf(!ffmpegAvailable)("rejects a truncated MP4 without retrying", async () => {
    // Valid ftyp header passes upload sniffing, but the moov atom is gone.
    const truncated = (await readFile(VALID_VIDEO_PATH)).subarray(0, 2048);
    const queued = await queueUploadedVideo(tenantId, admin, truncated);

    const job = await claimNextQueuedJob(db, { config: testConfig });
    await expect(processVideoJob(db, job!, { config: testConfig })).rejects.toThrow();

    const status = await getProductVideoJobStatus(db, tenantId, admin, queued.correlationId);
    expect(status.status).toBe("rejected");
    expect(status.retryCount).toBe(1);
  });

  it.skipIf(!ffmpegAvailable)("replaces derivatives on replay instead of duplicating them", async () => {
    const queued = await queueUploadedVideo(tenantId, admin);

    const first = await claimNextQueuedJob(db, { config: testConfig });
    await processVideoJob(db, first!, { config: testConfig });
    const firstUrls = await getApprovedProductVideoUrls(db, tenantId, queued.productPublicId);

    await sqlClient`UPDATE qos.video_processing_jobs SET status = 'queued' WHERE id = ${first!.jobId}`;
    const replay = await claimNextQueuedJob(db, { config: testConfig });
    await processVideoJob(db, replay!, { config: testConfig });
    const replayUrls = await getApprovedProductVideoUrls(db, tenantId, queued.productPublicId);

    const derivativeRows = await sqlClient`
      SELECT derivative_kind FROM qos.catalogue_media_derivatives d
      JOIN qos.catalogue_media_assets a ON a.id = d.asset_id
      WHERE a.public_id = ${queued.assetPublicId}
    `;
    expect(derivativeRows).toHaveLength(2);
    expect(replayUrls?.playbackUrl).not.toBe(firstUrls?.playbackUrl);
  });

  it("rejects foreign-tenant product ID", async () => {
    const hierarchy2 = await createTenantHierarchy(db, {
      tenant: {
        publicId: "ten-foreign",
        name: "Foreign Tenant",
        businessProfile: "hospitality",
        baseCurrency: "AED",
        defaultLocale: "en",
        defaultTimezone: "Asia/Dubai",
        supportedLocales: ["en", "ar"],
      },
      organization: {
        publicId: "org-foreign",
        name: "Foreign Org",
      },
      brand: {
        publicId: "br-foreign",
        name: "Foreign Brand",
      },
      location: {
        publicId: "loc-foreign",
        name: "Foreign Location",
        slug: "foreign",
        timezone: "Asia/Dubai",
      },
    });
    const tenant2Id = hierarchy2.tenant.id;
    const [identityRow2] = await db.insert(staffIdentities).values({
      providerSubject: "auth0|foreign",
      email: "foreign@test.local",
    }).returning();
    const [membership2] = await db.insert(staffMemberships).values({
      tenantId: tenant2Id,
      staffIdentityId: identityRow2.id,
      role: "administrator",
    }).returning();
    const admin2: ActiveStaffMembership = {
      membershipId: membership2.id,
      role: "administrator",
      staffIdentityId: identityRow2.id,
    };

    const product2 = await createDraftProduct(db, tenant2Id, admin2, productInput);

    // Tenant 1 admin trying to upload to tenant 2 product
    await expect(
      createProductVideoUploadGrant(db, tenantId, admin, product2.publicId, {
        byteSize: 1000,
        contentType: "video/mp4",
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/not found/i),
      statusCode: 404,
    });

    // Create a valid upload for tenant 2
    const videoBytes = await readFile(VALID_VIDEO_PATH);
    const grant = await createProductVideoUploadGrant(
      db,
      tenant2Id,
      admin2,
      product2.publicId,
      { byteSize: videoBytes.byteLength, contentType: "video/mp4" },
    );
    await ingestProductVideoUpload(
      db,
      tenant2Id,
      product2.publicId,
      grant.grantToken,
      videoBytes,
    );
    const queued = await queueProductVideoProcessing(
      db,
      tenant2Id,
      admin2,
      product2.publicId,
      grant.assetPublicId,
    );

    // Tenant 1 admin trying to check tenant 2 job status
    await expect(
      getProductVideoJobStatus(db, tenantId, admin, queued.correlationId),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/not found/i),
      statusCode: 404,
    });

    // Tenant 1 admin trying to get tenant 2 approved URLs
    await expect(
      getApprovedProductVideoUrls(db, tenantId, product2.publicId),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/not found/i),
      statusCode: 404,
    });
  });

  it("rejects unauthorized role (user cannot upload)", async () => {
    const [userIdentity] = await db.insert(staffIdentities).values({
      providerSubject: "auth0|user",
      email: "user@test.local",
    }).returning();
    const [userMembership] = await db.insert(staffMemberships).values({
      tenantId,
      staffIdentityId: userIdentity.id,
      role: "user",
    }).returning();
    const user: ActiveStaffMembership = {
      membershipId: userMembership.id,
      role: "user",
      staffIdentityId: userIdentity.id,
    };

    const product = await createDraftProduct(db, tenantId, admin, productInput);

    await expect(
      createProductVideoUploadGrant(db, tenantId, user, product.publicId, {
        byteSize: 1000,
        contentType: "video/mp4",
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/administrator.*required/i),
      statusCode: 403,
    });
  });
});

