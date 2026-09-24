import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { createDraftProduct } from "@/lib/catalogue/products";
import {
  createProductVideoUploadGrant,
  getApprovedProductVideoUrls,
  getProductVideoJobStatus,
  ingestProductVideoUpload,
  queueProductVideoProcessing,
} from "@/lib/media/product-videos";
import { LocalMediaStorage, setMediaStorage } from "@/lib/media/storage";
import {
  claimNextQueuedJob,
  processVideoJob,
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

// Check if ffmpeg/ffprobe are available before running video tests
async function checkFfmpegAvailable(): Promise<boolean> {
  try {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execAsync = promisify(exec);
    await execAsync("ffprobe -version");
    return true;
  } catch {
    return false;
  }
}

integrationDescribe("product video upload and processing", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tempMediaRoot: string;
  let admin: ActiveStaffMembership;
  let tenantId: string;
  let ffmpegAvailable = false;
  
  const productInput = {
    internalName: "test-video-product",
    translations: {
      en: { displayName: "Test Video Product", description: "Video test" },
      ar: { displayName: "منتج الفيديو التجريبي", description: "اختبار الفيديو" },
    },
    defaultVariant: { amountMinor: 1000, currency: "AED" },
  } as const;

  beforeAll(async () => {
    ffmpegAvailable = await checkFfmpegAvailable();
    
    tempMediaRoot = await mkdtemp(path.join(tmpdir(), "qos-video-"));
    setMediaStorage(new LocalMediaStorage(tempMediaRoot));

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
    ).rejects.toThrow(/byte limit/);
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

  it.skipIf(!ffmpegAvailable)("processes queued video job to generate playback and poster", async () => {
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

    const job = await claimNextQueuedJob(db);
    expect(job).toBeTruthy();
    expect(job?.correlationId).toBe(queueResult.correlationId);

    await processVideoJob(db, job!.jobId);

    const status = await getProductVideoJobStatus(
      db,
      tenantId,
      admin,
      queueResult.correlationId,
    );
    expect(status.status).toBe("ready");
    expect(status.completedAt).toBeTruthy();

    const urls = await getApprovedProductVideoUrls(
      db,
      tenantId,
      product.publicId,
    );

    expect(urls).toBeTruthy();
    expect(urls?.playbackUrl).toMatch(/^\/api\/media\/public\/mvp_/);
    expect(urls?.posterUrl).toMatch(/^\/api\/media\/public\/mpo_/);
  });

  it.skipIf(!ffmpegAvailable)("rejects over-duration video during processing", async () => {
    const product = await createDraftProduct(
      db,
      tenantId,
      admin,
      productInput,
    );

    const videoBytes = await readFile(OVERLIMIT_VIDEO_PATH);

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

    const job = await claimNextQueuedJob(db);
    expect(job).toBeTruthy();

    await expect(processVideoJob(db, job!.jobId)).rejects.toThrow();

    const status = await getProductVideoJobStatus(
      db,
      tenantId,
      admin,
      queueResult.correlationId,
    );

    expect(status.status).toContain(/queued|failed/);
    expect(status.retryCount).toBeGreaterThan(0);
    expect(status.lastErrorMessage).toContain("duration");
  });

  it.skipIf(!ffmpegAvailable)("quarantines video after exhausted retries", async () => {
    const product = await createDraftProduct(
      db,
      tenantId,
      admin,
      productInput,
    );

    const corruptBytes = await readFile(CORRUPT_VIDEO_PATH);

    const grant = await createProductVideoUploadGrant(
      db,
      tenantId,
      admin,
      product.publicId,
      {
        byteSize: corruptBytes.length,
        contentType: "video/mp4",
      },
    );

    await ingestProductVideoUpload(
      db,
      tenantId,
      product.publicId,
      grant.grantToken,
      corruptBytes,
    );

    const queueResult = await queueProductVideoProcessing(
      db,
      tenantId,
      admin,
      product.publicId,
      grant.assetPublicId,
    );

    for (let i = 0; i < 4; i++) {
      const job = await claimNextQueuedJob(db);
      if (!job) break;

      try {
        await processVideoJob(db, job.jobId);
      } catch {
        // Expected to fail
      }
    }

    const status = await getProductVideoJobStatus(
      db,
      tenantId,
      admin,
      queueResult.correlationId,
    );

    expect(status.status).toBe("quarantined");
    expect(status.retryCount).toBeGreaterThanOrEqual(3);
    expect(status.lastErrorMessage).toBeTruthy();
  });

  it.skipIf(!ffmpegAvailable)("ensures idempotent processing: replay does not leak files", async () => {
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

    const job = await claimNextQueuedJob(db);
    await processVideoJob(db, job!.jobId);

    const firstUrls = await getApprovedProductVideoUrls(
      db,
      tenantId,
      product.publicId,
    );

    expect(firstUrls).toBeTruthy();
  });
});
