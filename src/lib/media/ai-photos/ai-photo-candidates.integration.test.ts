import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  catalogueMediaAssets,
  catalogueProducts,
  catalogueProductTranslations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { getMenuHealth } from "@/lib/catalogue/menu-health";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import {
  acceptMenuAiPhoto,
  AiPhotoError,
  generateMenuAiPhoto,
  getMenuAiPhotos,
  readMenuAiPhotoPreview,
  rejectMenuAiPhoto,
  type AiPhotoCaller,
} from "@/lib/media/ai-photos/ai-photo-candidates";
import type { AiPhotoConfig } from "@/lib/media/ai-photos/config";
import {
  AiPhotoProviderError,
  type AiPhotoProvider,
} from "@/lib/media/ai-photos/provider";
import {
  createProductImageUploadGrant,
  ingestProductImageUpload,
  processProductImage,
} from "@/lib/media/product-images";
import { LocalMediaStorage, setMediaStorage } from "@/lib/media/storage";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const config: AiPhotoConfig = {
  enabled: true,
  provider: "openai",
  openAiApiKey: null,
  model: "gpt-image-1",
  quality: "low",
  dailyLimitPerTenant: 5,
  requestTimeoutMs: 30_000,
};

async function jpeg(color: { r: number; g: number; b: number }, size = 96) {
  return sharp({ create: { width: size, height: size, channels: 3, background: color } })
    .jpeg()
    .toBuffer();
}

type Behaviour = "ok" | "fail" | "garbage" | "auth";

function fakeProvider(behaviour: (prompt: string) => Behaviour = () => "ok") {
  const prompts: string[] = [];
  const provider: AiPhotoProvider = {
    kind: "fake",
    capabilities: { network: false, submitIdempotency: "none", usageReporting: true, internalRetries: 0 },
    async generate(request) {
      prompts.push(request.prompt);
      const mode = behaviour(request.prompt);
      if (mode === "fail") {
        throw new AiPhotoProviderError("unsafe_output", "The image service declined this request.");
      }
      if (mode === "auth") {
        throw new AiPhotoProviderError("provider_auth", "The image service rejected QOS credentials.");
      }
      if (mode === "garbage") {
        return { bytes: Buffer.from("not an image"), model: "gpt-image-1", usage: null };
      }
      return {
        bytes: await jpeg({ r: 200, g: 120, b: 40 }),
        model: "gpt-image-1",
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };
    },
  };
  return { provider, prompts };
}

integrationDescribe("menu AI photo candidates", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let mediaRoot: string;

  beforeAll(async () => {
    mediaRoot = await mkdtemp(path.join(tmpdir(), "qos-ai-photos-"));
    setMediaStorage(new LocalMediaStorage(mediaRoot));
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    setMediaStorage(null);
    await sqlClient.end({ timeout: 5 });
    await rm(mediaRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(
    tenantId: string,
    locationIds: string[],
    role: "administrator" | "user",
    subject: string,
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    for (const locationId of locationIds) {
      await db
        .insert(staffLocationScopes)
        .values({ tenantId, staffMembershipId: membership.id, locationId });
    }
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  function productInput(internalName: string, displayName: string) {
    return {
      internalName,
      translations: {
        en: { displayName, description: `${displayName} with steamed milk` },
        ar: { displayName: `${displayName} عربي`, description: "وصف" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    } as const;
  }

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const adminMembership = await seedMember(tenantId, [quotes.location.id], "administrator", "admin@test");
    const userMembership = await seedMember(tenantId, [quotes.location.id], "user", "user@test");
    const admin: AiPhotoCaller = { tenantId, subject: "admin@test", membership: adminMembership };
    const user: AiPhotoCaller = { tenantId, subject: "user@test", membership: userMembership };

    const latte = await createDraftProduct(db, tenantId, adminMembership, productInput("latte", "Latte"));
    const mocha = await createDraftProduct(db, tenantId, adminMembership, productInput("mocha", "Mocha"));
    const photographed = await createDraftProduct(db, tenantId, adminMembership, productInput("flat-white", "Flat White"));
    const offMenu = await createDraftProduct(db, tenantId, adminMembership, productInput("off-menu", "Off Menu"));

    const menu = await createDraftMenu(db, tenantId, adminMembership, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "فطور" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "قهوة" } },
          products: [
            { productPublicId: latte.publicId, sortOrder: 0 },
            { productPublicId: mocha.publicId, sortOrder: 1 },
            { productPublicId: photographed.publicId, sortOrder: 2 },
          ],
        },
      ],
    });

    // A real operator photo through the normal pipeline.
    const bytes = await jpeg({ r: 10, g: 20, b: 30 });
    const grant = await createProductImageUploadGrant(db, tenantId, adminMembership, photographed.publicId, {
      expectedByteSize: bytes.byteLength,
      expectedContentType: "image/jpeg",
    });
    await ingestProductImageUpload(db, tenantId, photographed.publicId, grant!.grantToken, bytes);
    await processProductImage(db, tenantId, adminMembership, photographed.publicId, grant!.assetPublicId, "admin@test");

    return { tenantId, admin, user, menu, latte, mocha, photographed, offMenu, operatorAssetPublicId: grant!.assetPublicId };
  }

  async function productRow(tenantId: string, productPublicId: string) {
    const [row] = await db
      .select()
      .from(catalogueProducts)
      .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.publicId, productPublicId)));
    return row!;
  }

  async function assetRow(tenantId: string, assetPublicId: string) {
    const [row] = await db
      .select()
      .from(catalogueMediaAssets)
      .where(and(eq(catalogueMediaAssets.tenantId, tenantId), eq(catalogueMediaAssets.publicId, assetPublicId)));
    return row!;
  }

  function missingPhotoIds(report: Awaited<ReturnType<typeof getMenuHealth>>) {
    return report.issueGroups.find((group) => group.type === "missing_photo")!.productPublicIds.sort();
  }

  it("stores a private, reviewable candidate that does not count as a photo until accepted", async () => {
    const { tenantId, admin, menu, latte, mocha } = await seed();
    const { provider, prompts } = fakeProvider();

    const result = await runAsRole(sqlClient, "qos_app", () =>
      generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: latte.publicId }, { config, provider }),
    );

    expect(result.created).toBe(true);
    expect(result.candidate.status).toBe("pending_review");
    expect(result.candidate.previewPath).toContain(`/ai-photos/${result.candidate.assetPublicId}/preview`);
    expect(prompts[0]).toContain('Menu item name: "Latte"');
    expect(prompts[0]).toContain("Latte with steamed milk");

    const asset = await assetRow(tenantId, result.candidate.assetPublicId);
    expect(asset.status).toBe("uploaded");
    expect(asset.sourceProvenance).toBe("ai_generated");
    expect(asset.generationMetadata).toMatchObject({
      schema: "qos.ai_photo_generation.v1",
      model: "gpt-image-1",
      requestedBySubject: "admin@test",
      menuPublicId: menu.publicId,
      usage: { totalTokens: 30 },
    });
    expect((await productRow(tenantId, latte.publicId)).primaryMediaAssetId).toBeNull();

    const health = await getMenuHealth(db, tenantId, admin.membership, menu.publicId);
    expect(missingPhotoIds(health)).toEqual([latte.publicId, mocha.publicId].sort());

    const preview = await readMenuAiPhotoPreview(db, admin, {
      menuPublicId: menu.publicId,
      assetPublicId: result.candidate.assetPublicId,
    });
    expect((await sharp(preview.bytes).metadata()).format).toBe("jpeg");

    const view = await getMenuAiPhotos(db, admin, menu.publicId, { config, provider });
    expect(view.availability).toMatchObject({ available: true, canGenerate: true, usedToday: 1, remainingToday: 4 });
    expect(view.candidates).toEqual([expect.objectContaining({ productPublicId: latte.publicId, status: "pending_review" })]);
  });

  it("accepts through the derivative pipeline, updates completeness and labels the photo as AI", async () => {
    const { tenantId, admin, menu, latte, mocha } = await seed();
    const { provider } = fakeProvider();
    const { candidate } = await generateMenuAiPhoto(
      db,
      admin,
      { menuPublicId: menu.publicId, productPublicId: latte.publicId },
      { config, provider },
    );

    await expect(
      acceptMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, assetPublicId: candidate.assetPublicId, accuracyConfirmed: false }),
    ).rejects.toMatchObject({ code: "accuracy_review_required" });

    const accepted = await runAsRole(sqlClient, "qos_app", () =>
      acceptMenuAiPhoto(db, admin, {
        menuPublicId: menu.publicId,
        assetPublicId: candidate.assetPublicId,
        accuracyConfirmed: true,
      }),
    );
    expect(accepted.status).toBe("accepted");

    const asset = await assetRow(tenantId, candidate.assetPublicId);
    expect(asset.status).toBe("approved");
    expect(asset.sourceProvenance).toBe("ai_generated");
    expect(asset.generationMetadata).toMatchObject({
      review: { decision: "accepted", decidedBySubject: "admin@test", accuracyConfirmed: true, replacedAssetPublicId: null },
    });
    expect((await productRow(tenantId, latte.publicId)).primaryMediaAssetId).toBe(asset.id);

    const health = await getMenuHealth(db, tenantId, admin.membership, menu.publicId);
    expect(missingPhotoIds(health)).toEqual([mocha.publicId]);

    const view = await getMenuAiPhotos(db, admin, menu.publicId, { config, provider });
    expect(view.aiPhotoProductPublicIds).toEqual([latte.publicId]);
    expect(view.candidates).toEqual([]);

    // Accept retries are idempotent and do not create duplicate derivatives.
    const again = await acceptMenuAiPhoto(db, admin, {
      menuPublicId: menu.publicId,
      assetPublicId: candidate.assetPublicId,
      accuracyConfirmed: true,
    });
    expect(again.status).toBe("accepted");
    const derivativeCount = await sqlClient`SELECT count(*)::int AS count FROM qos.catalogue_media_derivatives WHERE asset_id = ${asset.id}`;
    expect(derivativeCount[0]!.count).toBe(2);

    const actions = (await db.select({ action: tenantAuditEvents.action }).from(tenantAuditEvents)).map((row) => row.action);
    expect(actions).toEqual(
      expect.arrayContaining(["catalogue.media.ai_photo_requested", "catalogue.media.ai_photo_accepted"]),
    );
  });

  it("never silently replaces an approved photo", async () => {
    const { tenantId, admin, menu, photographed, operatorAssetPublicId } = await seed();
    const { provider } = fakeProvider();
    const operatorAsset = await assetRow(tenantId, operatorAssetPublicId);
    const { candidate } = await generateMenuAiPhoto(
      db,
      admin,
      { menuPublicId: menu.publicId, productPublicId: photographed.publicId },
      { config, provider },
    );

    await expect(
      acceptMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, assetPublicId: candidate.assetPublicId, accuracyConfirmed: true }),
    ).rejects.toMatchObject({ code: "existing_photo", statusCode: 409 });
    expect((await productRow(tenantId, photographed.publicId)).primaryMediaAssetId).toBe(operatorAsset.id);
    expect((await assetRow(tenantId, candidate.assetPublicId)).status).toBe("uploaded");

    await acceptMenuAiPhoto(db, admin, {
      menuPublicId: menu.publicId,
      assetPublicId: candidate.assetPublicId,
      accuracyConfirmed: true,
      replaceExisting: true,
    });
    const accepted = await assetRow(tenantId, candidate.assetPublicId);
    expect((await productRow(tenantId, photographed.publicId)).primaryMediaAssetId).toBe(accepted.id);
    expect(accepted.generationMetadata).toMatchObject({ review: { replacedAssetPublicId: operatorAssetPublicId } });
    expect((await assetRow(tenantId, operatorAssetPublicId)).status).toBe("approved");
  });

  it("isolates failures: a failed item records honestly and does not touch successful ones", async () => {
    const { tenantId, admin, menu, latte, mocha } = await seed();
    const { provider } = fakeProvider((prompt) => (prompt.includes("Mocha") ? "fail" : "ok"));

    const [ok, failed] = await Promise.all([
      generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: latte.publicId }, { config, provider }),
      generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: mocha.publicId }, { config, provider }),
    ]);

    expect(ok.candidate.status).toBe("pending_review");
    expect(failed.candidate).toMatchObject({ status: "failed", failureCode: "unsafe_output", previewPath: null });
    expect((await assetRow(tenantId, failed.candidate.assetPublicId)).status).toBe("failed");
    expect((await assetRow(tenantId, ok.candidate.assetPublicId)).status).toBe("uploaded");
    expect((await productRow(tenantId, mocha.publicId)).primaryMediaAssetId).toBeNull();

    await expect(
      acceptMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, assetPublicId: failed.candidate.assetPublicId, accuracyConfirmed: true }),
    ).rejects.toMatchObject({ code: "candidate_not_reviewable" });

    await acceptMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, assetPublicId: ok.candidate.assetPublicId, accuracyConfirmed: true });
    const health = await getMenuHealth(db, tenantId, admin.membership, menu.publicId);
    expect(missingPhotoIds(health)).toEqual([mocha.publicId]);

    // Failures still consume the daily budget.
    const view = await getMenuAiPhotos(db, admin, menu.publicId, { config, provider });
    expect(view.availability.usedToday).toBe(2);
    expect(view.candidates).toEqual([expect.objectContaining({ productPublicId: mocha.publicId, status: "failed" })]);
  });

  it("rejects provider output that is not an image", async () => {
    const { tenantId, admin, menu, latte } = await seed();
    const { provider } = fakeProvider(() => "garbage");
    const { candidate } = await generateMenuAiPhoto(
      db,
      admin,
      { menuPublicId: menu.publicId, productPublicId: latte.publicId },
      { config, provider },
    );
    expect(candidate).toMatchObject({ status: "failed", failureCode: "invalid_output" });
    expect((await productRow(tenantId, latte.publicId)).primaryMediaAssetId).toBeNull();
  });

  it("reuses a pending candidate instead of spending again, and enforces the daily limit", async () => {
    const { admin, menu, latte, mocha } = await seed();
    const { provider, prompts } = fakeProvider();
    const limited = { ...config, dailyLimitPerTenant: 2 };

    const first = await generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: latte.publicId }, { config: limited, provider });
    const replay = await generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: latte.publicId }, { config: limited, provider });
    expect(replay.created).toBe(false);
    expect(replay.candidate.assetPublicId).toBe(first.candidate.assetPublicId);
    expect(prompts).toHaveLength(1);

    await generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: mocha.publicId }, { config: limited, provider });
    await rejectMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, assetPublicId: first.candidate.assetPublicId });

    await expect(
      generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: latte.publicId }, { config: limited, provider }),
    ).rejects.toMatchObject({ code: "daily_limit_reached", statusCode: 429 });
    expect(prompts).toHaveLength(2);
  });

  it("does not spend the allowance on requests the provider refused, but does on billable failures", async () => {
    const { admin, menu, latte, mocha } = await seed();
    const limited = { ...config, dailyLimitPerTenant: 2 };
    const rejected = fakeProvider(() => "auth").provider;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const { candidate } = await generateMenuAiPhoto(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicId: latte.publicId },
        { config: limited, provider: rejected },
      );
      expect(candidate).toMatchObject({ status: "failed", failureCode: "provider_auth" });
    }
    expect((await getMenuAiPhotos(db, admin, menu.publicId, { config: limited })).availability).toMatchObject({
      usedToday: 0,
      remainingToday: 2,
    });

    const garbage = fakeProvider(() => "garbage").provider;
    await generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: mocha.publicId }, { config: limited, provider: garbage });
    expect((await getMenuAiPhotos(db, admin, menu.publicId, { config: limited })).availability).toMatchObject({
      usedToday: 1,
      remainingToday: 1,
    });
  });

  it("serializes concurrent requests so the daily limit cannot be overshot", async () => {
    const { admin, menu, latte, mocha, photographed } = await seed();
    const { provider, prompts } = fakeProvider();
    const limited = { ...config, dailyLimitPerTenant: 2 };

    const results = await Promise.allSettled(
      [latte, mocha, photographed].map((product) =>
        generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: product.publicId }, { config: limited, provider }),
      ),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: "daily_limit_reached" });
    expect(prompts).toHaveLength(2);
  });

  it("reject leaves the existing photo unchanged and the candidate can no longer be accepted", async () => {
    const { tenantId, admin, user, menu, photographed, operatorAssetPublicId } = await seed();
    const { provider } = fakeProvider();
    const operatorAsset = await assetRow(tenantId, operatorAssetPublicId);
    const { candidate } = await generateMenuAiPhoto(
      db,
      admin,
      { menuPublicId: menu.publicId, productPublicId: photographed.publicId },
      { config, provider },
    );

    const rejected = await rejectMenuAiPhoto(db, user, { menuPublicId: menu.publicId, assetPublicId: candidate.assetPublicId });
    expect(rejected.status).toBe("rejected");
    expect((await productRow(tenantId, photographed.publicId)).primaryMediaAssetId).toBe(operatorAsset.id);
    expect((await assetRow(tenantId, candidate.assetPublicId)).generationMetadata).toMatchObject({
      review: { decision: "rejected", decidedBySubject: "user@test" },
    });
    await expect(
      acceptMenuAiPhoto(db, admin, {
        menuPublicId: menu.publicId,
        assetPublicId: candidate.assetPublicId,
        accuracyConfirmed: true,
        replaceExisting: true,
      }),
    ).rejects.toMatchObject({ code: "candidate_not_reviewable" });
    await expect(
      readMenuAiPhotoPreview(db, admin, { menuPublicId: menu.publicId, assetPublicId: candidate.assetPublicId }),
    ).rejects.toMatchObject({ code: "candidate_not_found" });
  });

  it("requires renewed review when the item text changed after generation", async () => {
    const { tenantId, admin, menu, latte } = await seed();
    const { provider } = fakeProvider();
    const { candidate } = await generateMenuAiPhoto(
      db,
      admin,
      { menuPublicId: menu.publicId, productPublicId: latte.publicId },
      { config, provider },
    );

    const product = await productRow(tenantId, latte.publicId);
    await db
      .update(catalogueProductTranslations)
      .set({ description: "Iced latte with oat milk" })
      .where(
        and(
          eq(catalogueProductTranslations.productId, product.id),
          eq(catalogueProductTranslations.locale, "en"),
        ),
      );

    await expect(
      acceptMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, assetPublicId: candidate.assetPublicId, accuracyConfirmed: true }),
    ).rejects.toMatchObject({ code: "stale_candidate", statusCode: 409 });
    expect((await productRow(tenantId, latte.publicId)).primaryMediaAssetId).toBeNull();
  });

  it("restricts spend and approval to administrators and to products on the menu", async () => {
    const { admin, user, menu, latte, offMenu } = await seed();
    const { provider, prompts } = fakeProvider();

    await expect(
      generateMenuAiPhoto(db, user, { menuPublicId: menu.publicId, productPublicId: latte.publicId }, { config, provider }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
    await expect(
      generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: offMenu.publicId }, { config, provider }),
    ).rejects.toMatchObject({ code: "product_not_in_menu" });
    await expect(
      generateMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, productPublicId: latte.publicId }, { config: { ...config, enabled: false }, provider }),
    ).rejects.toBeInstanceOf(AiPhotoError);
    expect(prompts).toHaveLength(0);

    const { candidate } = await generateMenuAiPhoto(
      db,
      admin,
      { menuPublicId: menu.publicId, productPublicId: latte.publicId },
      { config, provider },
    );
    await expect(
      acceptMenuAiPhoto(db, user, { menuPublicId: menu.publicId, assetPublicId: candidate.assetPublicId, accuracyConfirmed: true }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    const userView = await getMenuAiPhotos(db, user, menu.publicId, { config, provider });
    expect(userView.availability.canGenerate).toBe(false);
  });

  it("does not expose candidates across tenants", async () => {
    const { admin, menu, latte } = await seed();
    const { provider } = fakeProvider();
    const { candidate } = await generateMenuAiPhoto(
      db,
      admin,
      { menuPublicId: menu.publicId, productPublicId: latte.publicId },
      { config, provider },
    );

    const other = await createTenantHierarchy(db, flowerTenantFixture());
    const otherAdmin = await seedMember(other.tenant.id, [other.location.id], "administrator", "other@test");
    await expect(
      readMenuAiPhotoPreview(
        db,
        { tenantId: other.tenant.id, subject: "other@test", membership: otherAdmin },
        { menuPublicId: menu.publicId, assetPublicId: candidate.assetPublicId },
      ),
    ).rejects.toThrow();
  });
});
