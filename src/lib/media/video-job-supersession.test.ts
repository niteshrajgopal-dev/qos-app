import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/db";
import { catalogueMediaAssets, catalogueProducts, staffIdentities, staffMemberships, videoProcessingJobs } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { createDraftProduct } from "@/lib/catalogue/products";
import {
  createProductVideoUploadGrant,
  ingestProductVideoUpload,
  queueProductVideoProcessing,
} from "@/lib/media/product-videos";
import { LocalMediaStorage, setMediaStorage } from "@/lib/media/storage";
import { claimNextQueuedJob, processVideoJob } from "@/lib/media/video-job-queue";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { withTenantContext } from "@/lib/tenant/context";
import { eq } from "drizzle-orm";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const VALID_VIDEO_PATH = path.join(
  __dirname,
  "../../../test-fixtures/video/audio-first.mp4",
);

integrationDescribe("Video job supersession (integration)", () => {
  let testDb: typeof db;
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let storage: LocalMediaStorage;
  let tenantId: string;
  let membership: ActiveStaffMembership;

  const productInput = {
    internalName: "test-supersession-product",
    translations: {
      en: { displayName: "Test Product", description: null },
      ar: { displayName: "منتج اختبار", description: null },
    },
    defaultVariant: { amountMinor: 1000, currency: "AED" },
  } as const;

  beforeAll(async () => {
    const storageRoot = "/tmp/qos-test-supersession";
    storage = new LocalMediaStorage(storageRoot);
    setMediaStorage(storage);

    const connection = await resetAndMigrate();
    testDb = connection.db;
    sqlClient = connection.sql;
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.video_processing_jobs, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;

    const hierarchy = await createTenantHierarchy(testDb, {
      tenant: {
        publicId: "ten-supersession-test",
        name: "Supersession Test",
        businessProfile: "hospitality",
        baseCurrency: "AED",
        defaultLocale: "en",
        defaultTimezone: "Asia/Dubai",
        supportedLocales: ["en", "ar"],
      },
      organization: {
        publicId: "org-supersession",
        name: "Supersession Org",
      },
      brand: {
        publicId: "br-supersession",
        name: "Supersession Brand",
      },
      location: {
        publicId: "loc-supersession",
        name: "Supersession Location",
        slug: "supersession-location",
        timezone: "Asia/Dubai",
      },
    });

    tenantId = hierarchy.tenant.id;

    const [identity] = await testDb
      .insert(staffIdentities)
      .values({ providerSubject: "admin@supersession-test", email: "admin@supersession-test" })
      .returning();

    const [staffMembership] = await testDb
      .insert(staffMemberships)
      .values({
        tenantId,
        staffIdentityId: identity.id,
        role: "administrator",
      })
      .returning();

    membership = {
      membershipId: staffMembership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  it("queued job is superseded when a newer upload arrives", async () => {
    const product = await createDraftProduct(testDb, tenantId, membership, productInput);

    const videoBytes = await readFile(VALID_VIDEO_PATH);

    const grant1 = await createProductVideoUploadGrant(testDb, tenantId, membership, product.publicId, {
      byteSize: videoBytes.length,
      contentType: "video/mp4",
    });

    await ingestProductVideoUpload(testDb, tenantId, product.publicId, grant1.grantToken, videoBytes);

    const job1 = await queueProductVideoProcessing(testDb, tenantId, membership, product.publicId, grant1.assetPublicId);

    const grant2 = await createProductVideoUploadGrant(testDb, tenantId, membership, product.publicId, {
      byteSize: videoBytes.length,
      contentType: "video/mp4",
    });

    await ingestProductVideoUpload(testDb, tenantId, product.publicId, grant2.grantToken, videoBytes);

    const job2 = await queueProductVideoProcessing(testDb, tenantId, membership, product.publicId, grant2.assetPublicId);

    const [oldJob] = await withTenantContext(testDb, tenantId, (tx) =>
      tx
        .select()
        .from(videoProcessingJobs)
        .where(eq(videoProcessingJobs.correlationId, job1.correlationId))
        .limit(1),
    );

    expect(oldJob.status).toBe("rejected");
    expect(oldJob.lastErrorMessage).toBe("Superseded by a newer upload.");

    const [newJob] = await withTenantContext(testDb, tenantId, (tx) =>
      tx
        .select()
        .from(videoProcessingJobs)
        .where(eq(videoProcessingJobs.correlationId, job2.correlationId))
        .limit(1),
    );

    expect(newJob.status).toBe("queued");
  });

  it("processing job is not superseded, only queued jobs", async () => {
    const product = await createDraftProduct(testDb, tenantId, membership, productInput);

    const videoBytes = await readFile(VALID_VIDEO_PATH);

    const grant1 = await createProductVideoUploadGrant(testDb, tenantId, membership, product.publicId, {
      byteSize: videoBytes.length,
      contentType: "video/mp4",
    });

    await ingestProductVideoUpload(testDb, tenantId, product.publicId, grant1.grantToken, videoBytes);

    const job1 = await queueProductVideoProcessing(testDb, tenantId, membership, product.publicId, grant1.assetPublicId);

    await withTenantContext(testDb, tenantId, (tx) =>
      tx
        .update(videoProcessingJobs)
        .set({ status: "processing" })
        .where(eq(videoProcessingJobs.correlationId, job1.correlationId)),
    );

    const grant2 = await createProductVideoUploadGrant(testDb, tenantId, membership, product.publicId, {
      byteSize: videoBytes.length,
      contentType: "video/mp4",
    });

    await ingestProductVideoUpload(testDb, tenantId, product.publicId, grant2.grantToken, videoBytes);

    await queueProductVideoProcessing(testDb, tenantId, membership, product.publicId, grant2.assetPublicId);

    const [oldJob] = await withTenantContext(testDb, tenantId, (tx) =>
      tx
        .select()
        .from(videoProcessingJobs)
        .where(eq(videoProcessingJobs.correlationId, job1.correlationId))
        .limit(1),
    );

    expect(oldJob.status).toBe("processing");
  });

  it("processing job finishing after newer upload is queued gets rejected", async () => {
    const product = await createDraftProduct(testDb, tenantId, membership, productInput);

    const videoBytes = await readFile(VALID_VIDEO_PATH);

    const grant1 = await createProductVideoUploadGrant(testDb, tenantId, membership, product.publicId, {
      byteSize: videoBytes.length,
      contentType: "video/mp4",
    });

    await ingestProductVideoUpload(testDb, tenantId, product.publicId, grant1.grantToken, videoBytes);

    const job1 = await queueProductVideoProcessing(testDb, tenantId, membership, product.publicId, grant1.assetPublicId);

    const claimed1 = await claimNextQueuedJob(testDb, { workerId: "test-worker" });

    expect(claimed1).not.toBeNull();

    const grant2 = await createProductVideoUploadGrant(testDb, tenantId, membership, product.publicId, {
      byteSize: videoBytes.length,
      contentType: "video/mp4",
    });

    await ingestProductVideoUpload(testDb, tenantId, product.publicId, grant2.grantToken, videoBytes);

    await queueProductVideoProcessing(db, tenantId, membership, product.publicId, grant2.assetPublicId);

    try {
      await processVideoJob(testDb, claimed1!);
      throw new Error("Expected processVideoJob to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("Superseded by a newer upload");
    }

    const [oldJob] = await withTenantContext(db, tenantId, (tx) =>
      tx
        .select()
        .from(videoProcessingJobs)
        .where(eq(videoProcessingJobs.correlationId, job1.correlationId))
        .limit(1),
    );

    expect(oldJob.status).toBe("rejected");
    expect(oldJob.lastErrorMessage).toBe("Superseded by a newer upload.");

    const [oldAsset] = await withTenantContext(db, tenantId, (tx) =>
      tx
        .select()
        .from(catalogueMediaAssets)
        .where(eq(catalogueMediaAssets.publicId, grant1.assetPublicId))
        .limit(1),
    );

    expect(oldAsset.status).toBe("rejected");
  });

  it("newer IMAGE asset does not supersede video job", async () => {
    const product = await createDraftProduct(testDb, tenantId, membership, productInput);

    const videoBytes = await readFile(VALID_VIDEO_PATH);

    const grant1 = await createProductVideoUploadGrant(testDb, tenantId, membership, product.publicId, {
      byteSize: videoBytes.length,
      contentType: "video/mp4",
    });

    await ingestProductVideoUpload(testDb, tenantId, product.publicId, grant1.grantToken, videoBytes);

    const job1 = await queueProductVideoProcessing(testDb, tenantId, membership, product.publicId, grant1.assetPublicId);

    const claimed1 = await claimNextQueuedJob(testDb, { workerId: "test-worker" });

    expect(claimed1).not.toBeNull();

    const productInternalId = await withTenantContext(testDb, tenantId, async (tx) => {
      const [p] = await tx
        .select({ id: catalogueProducts.id })
        .from(catalogueProducts)
        .where(eq(catalogueProducts.publicId, product.publicId))
        .limit(1);
      return p.id;
    });

    await withTenantContext(testDb, tenantId, (tx) =>
      tx.insert(catalogueMediaAssets).values({
        tenantId,
        productId: productInternalId,
        publicId: `img-asset-${Date.now()}`,
        status: "approved",
        contentType: "image/jpeg",
        sourceProvenance: "operator_entered",
      }),
    );

    await expect(processVideoJob(testDb, claimed1!)).resolves.not.toThrow();

    const [job] = await withTenantContext(db, tenantId, (tx) =>
      tx
        .select()
        .from(videoProcessingJobs)
        .where(eq(videoProcessingJobs.correlationId, job1.correlationId))
        .limit(1),
    );

    expect(job.status).toBe("ready");
  });

  it("pending_upload grant does not supersede video job", async () => {
    const product = await createDraftProduct(testDb, tenantId, membership, productInput);

    const videoBytes = await readFile(VALID_VIDEO_PATH);

    const grant1 = await createProductVideoUploadGrant(testDb, tenantId, membership, product.publicId, {
      byteSize: videoBytes.length,
      contentType: "video/mp4",
    });

    await ingestProductVideoUpload(testDb, tenantId, product.publicId, grant1.grantToken, videoBytes);

    const job1 = await queueProductVideoProcessing(testDb, tenantId, membership, product.publicId, grant1.assetPublicId);

    const claimed1 = await claimNextQueuedJob(testDb, { workerId: "test-worker" });

    expect(claimed1).not.toBeNull();

    await createProductVideoUploadGrant(db, tenantId, membership, product.publicId, {
      byteSize: videoBytes.length,
      contentType: "video/mp4",
    });

    await expect(processVideoJob(testDb, claimed1!)).resolves.not.toThrow();

    const [job] = await withTenantContext(db, tenantId, (tx) =>
      tx
        .select()
        .from(videoProcessingJobs)
        .where(eq(videoProcessingJobs.correlationId, job1.correlationId))
        .limit(1),
    );

    expect(job.status).toBe("ready");
  });
});
