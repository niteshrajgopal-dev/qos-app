import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  catalogueMediaAssets,
  catalogueProducts,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { assertPublicMenuResponseIsAllowlisted } from "@/lib/catalogue/public-menu-contract";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { getMenuHealth } from "@/lib/catalogue/menu-health";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct, updateDraftProduct } from "@/lib/catalogue/products";
import { resolvePublicMenuByKey } from "@/lib/catalogue/public-menu-resolver";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { AI_PHOTO_CUSTOMER_DISCLOSURE_I18N_KEY } from "@/lib/media/ai-photos/customer-disclosure";
import {
  acceptMenuAiPhoto,
  generateMenuAiPhoto,
  getMenuAiPhotos,
  metadataOf,
  rejectMenuAiPhoto,
  type AiPhotoCaller,
} from "@/lib/media/ai-photos/ai-photo-candidates";
import type { AiPhotoConfig } from "@/lib/media/ai-photos/config";
import { AiPhotoProviderError, type AiPhotoProvider } from "@/lib/media/ai-photos/provider";
import { getStaffProductPrimaryMediaProvenance } from "@/lib/media/ai-photos/staff-media-provenance";
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
  dailyLimitPerTenant: 10,
  requestTimeoutMs: 30_000,
  executionMode: "sync",
  queuedStaleMs: 600_000,
};

async function jpeg() {
  return sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 1, g: 2, b: 3 } } })
    .jpeg()
    .toBuffer();
}

function fakeProvider() {
  const provider: AiPhotoProvider = {
    kind: "fake",
    capabilities: { network: false, submitIdempotency: "none", usageReporting: true, internalRetries: 0 },
    async generate() {
      return {
        bytes: await jpeg(),
        model: "gpt-image-1",
        usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
      };
    },
  };
  return provider;
}

integrationDescribe("QOS-33 acceptance", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let mediaRoot: string;

  beforeAll(async () => {
    mediaRoot = await mkdtemp(path.join(tmpdir(), "qos-33-"));
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedMember(
    tenantId: string,
    locationIds: string[],
    role: "administrator" | "user",
    subject: string,
  ) {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    for (const locationId of locationIds) {
      await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership.id, locationId });
    }
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  async function seedMenu() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const adminMembership = await seedMember(tenantId, [quotes.location.id], "administrator", "admin@test");
    const userMembership = await seedMember(tenantId, [quotes.location.id], "user", "user@test");
    const admin: AiPhotoCaller = { tenantId, subject: "admin@test", membership: adminMembership };
    const user: AiPhotoCaller = { tenantId, subject: "user@test", membership: userMembership };

    const product = await createDraftProduct(db, tenantId, adminMembership, {
      internalName: "latte",
      translations: {
        en: { displayName: "Latte", description: "Steamed milk" },
        ar: { displayName: "لاتيه", description: "حليب" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    const menu = await createDraftMenu(db, tenantId, adminMembership, {
      internalName: "main",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Main" }, ar: { displayName: "رئيسي" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "قهوة" } },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    return { tenantId, admin, user, menu, product, locationId: quotes.location.id };
  }

  describe("1. photo completeness", () => {
    it("counts only approved photos; queued and rejected candidates do not", async () => {
      const { tenantId, admin, user, menu, product } = await seedMenu();
      const provider = fakeProvider();
      const { candidate } = await generateMenuAiPhoto(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicId: product.publicId },
        { config, provider },
      );

      let health = await getMenuHealth(db, tenantId, admin.membership, menu.publicId);
      expect(health.issueGroups.find((g) => g.type === "missing_photo")?.productPublicIds).toContain(
        product.publicId,
      );

      await rejectMenuAiPhoto(db, user, { menuPublicId: menu.publicId, assetPublicId: candidate.assetPublicId });
      health = await getMenuHealth(db, tenantId, admin.membership, menu.publicId);
      expect(health.issueGroups.find((g) => g.type === "missing_photo")?.productPublicIds).toContain(
        product.publicId,
      );

      const regen = await generateMenuAiPhoto(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicId: product.publicId },
        { config, provider },
      );
      await acceptMenuAiPhoto(db, admin, {
        menuPublicId: menu.publicId,
        assetPublicId: regen.candidate.assetPublicId,
        accuracyConfirmed: true,
      });
      health = await getMenuHealth(db, tenantId, admin.membership, menu.publicId);
      expect(health.issueGroups.find((g) => g.type === "missing_photo")?.productPublicIds ?? []).not.toContain(
        product.publicId,
      );
    });
  });

  describe("2. idempotency and budget", () => {
    it("does not double-spend or duplicate attachments on generate/accept retries", async () => {
      const { admin, menu, product } = await seedMenu();
      const provider = fakeProvider();
      const first = await generateMenuAiPhoto(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicId: product.publicId },
        { config, provider },
      );
      const second = await generateMenuAiPhoto(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicId: product.publicId },
        { config, provider },
      );
      expect(second.created).toBe(false);
      expect(second.candidate.assetPublicId).toBe(first.candidate.assetPublicId);

      await acceptMenuAiPhoto(db, admin, {
        menuPublicId: menu.publicId,
        assetPublicId: first.candidate.assetPublicId,
        accuracyConfirmed: true,
      });
      await acceptMenuAiPhoto(db, admin, {
        menuPublicId: menu.publicId,
        assetPublicId: first.candidate.assetPublicId,
        accuracyConfirmed: true,
      });

      const derivatives = await sqlClient`SELECT count(*)::int AS count FROM qos.catalogue_media_derivatives`;
      expect(derivatives[0]!.count).toBe(2);
      expect((await getMenuAiPhotos(db, admin, menu.publicId, { config })).availability.usedToday).toBe(1);
    });
  });

  describe("3. reject and stale product revision", () => {
    it("reject keeps approved media; product revision bumps require renewed review", async () => {
      const { tenantId, admin, menu, product } = await seedMenu();
      const provider = fakeProvider();
      const { candidate } = await generateMenuAiPhoto(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicId: product.publicId },
        { config, provider },
      );

      await rejectMenuAiPhoto(db, admin, { menuPublicId: menu.publicId, assetPublicId: candidate.assetPublicId });
      const [row] = await db
        .select()
        .from(catalogueProducts)
        .where(and(eq(catalogueProducts.tenantId, tenantId), eq(catalogueProducts.publicId, product.publicId)));
      expect(row!.primaryMediaAssetId).toBeNull();

      const regen = await generateMenuAiPhoto(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicId: product.publicId },
        { config, provider },
      );
      await updateDraftProduct(db, tenantId, admin.membership, product.publicId, {
        expectedVersion: product.version,
        sku: "SKU-REV",
      }, admin.subject);

      await expect(
        acceptMenuAiPhoto(db, admin, {
          menuPublicId: menu.publicId,
          assetPublicId: regen.candidate.assetPublicId,
          accuracyConfirmed: true,
        }),
      ).rejects.toMatchObject({ code: "stale_candidate" });
    });
  });

  describe("4. authorization and unsafe output", () => {
    it("returns 404 for cross-tenant ids, rejects garbage output, and blocks read-only staff from spend", async () => {
      const { admin, user, menu, product } = await seedMenu();
      const bad: AiPhotoProvider = {
        kind: "bad",
        capabilities: { network: false, submitIdempotency: "none", usageReporting: false, internalRetries: 0 },
        async generate() {
          throw new AiPhotoProviderError("unsafe_output", "blocked");
        },
      };
      const failed = await generateMenuAiPhoto(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicId: product.publicId },
        { config, provider: bad },
      );
      expect(failed.candidate.status).toBe("failed");

      await expect(
        generateMenuAiPhoto(db, user, { menuPublicId: menu.publicId, productPublicId: product.publicId }, { config, provider: fakeProvider() }),
      ).rejects.toBeInstanceOf(StaffAuthorizationError);

      const other = await createTenantHierarchy(db, flowerTenantFixture());
      const otherAdmin = await seedMember(other.tenant.id, [other.location.id], "administrator", "other@test");
      await expect(
        getMenuAiPhotos(
          db,
          { tenantId: other.tenant.id, subject: "other@test", membership: otherAdmin },
          menu.publicId,
          { config },
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe("5. provenance visibility and public payloads", () => {
    it("keeps provenance on the asset after derivatives, exposes it to staff without leaking prompts publicly", async () => {
      const { tenantId, admin, user, menu, product, locationId } = await seedMenu();
      const provider = fakeProvider();
      const { candidate } = await generateMenuAiPhoto(
        db,
        admin,
        { menuPublicId: menu.publicId, productPublicId: product.publicId },
        { config, provider },
      );
      await acceptMenuAiPhoto(db, admin, {
        menuPublicId: menu.publicId,
        assetPublicId: candidate.assetPublicId,
        accuracyConfirmed: true,
      });

      const [asset] = await db
        .select()
        .from(catalogueMediaAssets)
        .where(and(eq(catalogueMediaAssets.tenantId, tenantId), eq(catalogueMediaAssets.publicId, candidate.assetPublicId)));
      expect(asset!.sourceProvenance).toBe("ai_generated");
      expect(metadataOf(asset!).productVersion).toBe(product.version);
      expect(metadataOf(asset!).prompt).toContain("Latte");

      const adminProv = await getStaffProductPrimaryMediaProvenance(db, tenantId, admin.membership, product.publicId);
      expect(adminProv?.generation.prompt).toContain("Latte");
      const userProv = await getStaffProductPrimaryMediaProvenance(db, tenantId, user.membership, product.publicId);
      expect(userProv?.generation).not.toHaveProperty("prompt");

      await approveProductTranslation(db, tenantId, admin.subject, product.publicId, "en", {
        expectedTranslationVersion: product.translations.en.translationVersion,
      });
      await approveProductTranslation(db, tenantId, admin.subject, product.publicId, "ar", {
        expectedTranslationVersion: product.translations.ar.translationVersion,
      });

      const publish = await publishDraftMenuToLocations(db, tenantId, admin.subject, menu.publicId, {
        locationIds: [locationId],
      });
      const publicKey = publish.results[0]!.publicKey!;
      const resolved = await resolvePublicMenuByKey(db, publicKey, "en");
      const productRow = resolved.sections[0]!.products[0]!;
      expect(productRow.mediaImageDisclosureI18nKey).toBe(AI_PHOTO_CUSTOMER_DISCLOSURE_I18N_KEY);
      assertPublicMenuResponseIsAllowlisted(resolved);
      const serialized = JSON.stringify(resolved);
      expect(serialized).not.toContain("Menu item name:");
      expect(serialized).not.toContain(metadataOf(asset!).prompt);
    });
  });
});
