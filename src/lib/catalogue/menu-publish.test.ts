import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { createDraftProduct } from "@/lib/catalogue/products";
import { createDraftMenu, updateDraftMenu } from "@/lib/catalogue/menus";
import {
  getCustomerMenuPayload,
  publishDraftMenuToLocations,
} from "@/lib/catalogue/menu-publish";
import {
  createProductImageUploadGrant,
  ingestProductImageUpload,
  processProductImage,
} from "@/lib/media/product-images";
import { LocalMediaStorage, setMediaStorage } from "@/lib/media/storage";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { MenuError } from "@/lib/catalogue/menus";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue menu publish", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tempMediaRoot: string;

  beforeAll(async () => {
    tempMediaRoot = await mkdtemp(path.join(tmpdir(), "qos-media-"));
    setMediaStorage(new LocalMediaStorage(tempMediaRoot));

    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  });

  afterAll(async () => {
    setMediaStorage(null);
    await sqlClient.end({ timeout: 5 });
    await rm(tempMediaRoot, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(
    tenantId: string,
    locationIds: string[],
    subject = "admin.quotes@test",
    email = "admin.quotes@test",
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

    for (const locationId of locationIds) {
      await db.insert(staffLocationScopes).values({
        tenantId,
        staffMembershipId: membership.id,
        locationId,
      });
    }

    return {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };
  }

  async function seedUser(tenantId: string, locationId: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({
        providerSubject: "user.quotes@test",
        email: "user.quotes@test",
      })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId,
        staffIdentityId: identity.id,
        role: "user",
      })
      .returning();

    await db.insert(staffLocationScopes).values({
      tenantId,
      staffMembershipId: membership.id,
      locationId,
    });

    return {
      membershipId: membership.id,
      role: "user" as const,
      staffIdentityId: identity.id,
    };
  }

  const productInput = {
    internalName: "flat-white",
    translations: {
      en: { displayName: "Flat White", description: "Coffee" },
      ar: { displayName: "فلات وايت", description: "قهوة" },
    },
    defaultVariant: { amountMinor: 2000, currency: "AED" },
  } as const;

  async function approveBilingualProduct(
    tenantId: string,
    productPublicId: string,
    enVersion: number,
    arVersion: number,
  ) {
    await approveProductTranslation(
      db,
      tenantId,
      "admin.quotes@test",
      productPublicId,
      "en",
      { expectedTranslationVersion: enVersion },
    );
    await approveProductTranslation(
      db,
      tenantId,
      "admin.quotes@test",
      productPublicId,
      "ar",
      { expectedTranslationVersion: arVersion },
    );
  }

  it("publishes only selected locations and leaves other live releases unchanged", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id, [
      quotes.locationA.id,
      quotes.locationB.id,
    ]);

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "shared-menu",
      locationIds: [quotes.locationA.id, quotes.locationB.id],
      translations: {
        en: { displayName: "Shared Menu" },
        ar: { displayName: "قائمة مشتركة" },
      },
      sections: [
        {
          internalName: "mains",
          sortOrder: 0,
          translations: {
            en: { displayName: "Mains" },
            ar: { displayName: "أطباق" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    await approveBilingualProduct(
      quotes.tenant.id,
      product.publicId,
      product.translations.en.translationVersion,
      product.translations.ar.translationVersion,
    );

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id, quotes.locationB.id] },
    );

    await updateDraftMenu(db, quotes.tenant.id, admin, menu.publicId, {
      expectedVersion: menu.version,
      translations: {
        en: { displayName: "Shared Menu v2" },
      },
    });

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const liveA = await getCustomerMenuPayload(
      db,
      quotes.tenant.id,
      menu.publicId,
      quotes.locationA.publicId,
    );
    const liveB = await getCustomerMenuPayload(
      db,
      quotes.tenant.id,
      menu.publicId,
      quotes.locationB.publicId,
    );

    expect(liveA?.translations.en.displayName).toBe("Shared Menu v2");
    expect(liveB?.translations.en.displayName).toBe("Shared Menu");
    expect(liveA?.locationPublicId).toBe(quotes.locationA.publicId);
    expect(liveB?.locationPublicId).toBe(quotes.locationB.publicId);
  });

  it("rejects user publish attempts and foreign publish targets", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id, [
      quotes.locationA.id,
      quotes.locationB.id,
    ]);
    await seedUser(quotes.tenant.id, quotes.locationA.id);

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "restricted-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Restricted Menu" },
        ar: { displayName: "قائمة" },
      },
      sections: [
        {
          internalName: "mains",
          sortOrder: 0,
          translations: {
            en: { displayName: "Mains" },
            ar: { displayName: "أطباق" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    await approveBilingualProduct(
      quotes.tenant.id,
      product.publicId,
      product.translations.en.translationVersion,
      product.translations.ar.translationVersion,
    );

    await expect(
      publishDraftMenuToLocations(
        db,
        quotes.tenant.id,
        "user.quotes@test",
        menu.publicId,
        { locationIds: [quotes.locationA.id] },
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    await expect(
      publishDraftMenuToLocations(
        db,
        quotes.tenant.id,
        "admin.quotes@test",
        menu.publicId,
        { locationIds: [quotes.locationB.id] },
      ),
    ).rejects.toBeInstanceOf(MenuError);
  });

  it("returns the same publish result for an idempotent retry", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id, [quotes.locationA.id]);

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "retry-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Retry Menu" },
        ar: { displayName: "قائمة" },
      },
      sections: [
        {
          internalName: "mains",
          sortOrder: 0,
          translations: {
            en: { displayName: "Mains" },
            ar: { displayName: "أطباق" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    await approveBilingualProduct(
      quotes.tenant.id,
      product.publicId,
      product.translations.en.translationVersion,
      product.translations.ar.translationVersion,
    );

    const first = await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      {
        locationIds: [quotes.locationA.id],
        operationId: "pub_retry_1",
      },
    );

    const second = await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      {
        locationIds: [quotes.locationA.id],
        operationId: "pub_retry_1",
      },
    );

    expect(second).toEqual(first);
  });

  it("includes approved thumbnail public ids in published menu snapshots", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id, [quotes.locationA.id]);

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );

    const pngBytes = await sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: { r: 200, g: 100, b: 50 },
      },
    })
      .png()
      .toBuffer();

    const grant = await createProductImageUploadGrant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedByteSize: pngBytes.byteLength,
        expectedContentType: "image/png",
      },
    );

    await ingestProductImageUpload(
      db,
      quotes.tenant.id,
      product.publicId,
      grant.grantToken,
      pngBytes,
    );

    const processed = await processProductImage(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      grant.assetPublicId,
      "admin.quotes@test",
    );

    const thumbnailId = processed.derivatives.find(
      (derivative) => derivative.kind === "thumbnail",
    )?.publicDerivativeId;

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "media-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Media Menu" },
        ar: { displayName: "قائمة" },
      },
      sections: [
        {
          internalName: "mains",
          sortOrder: 0,
          translations: {
            en: { displayName: "Mains" },
            ar: { displayName: "أطباق" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    await approveBilingualProduct(
      quotes.tenant.id,
      product.publicId,
      product.translations.en.translationVersion,
      product.translations.ar.translationVersion,
    );

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const live = await getCustomerMenuPayload(
      db,
      quotes.tenant.id,
      menu.publicId,
      quotes.locationA.publicId,
    );

    expect(live?.sections[0]?.products[0]?.mediaAssetId).toBe(thumbnailId);
  });
});
