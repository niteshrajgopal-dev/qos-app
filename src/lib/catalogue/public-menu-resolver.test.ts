import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  catalogueMenuPublicLinks,
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
  publishDraftMenuToLocations,
} from "@/lib/catalogue/menu-publish";
import {
  deriveStableMenuPublicKey,
  PublicMenuResolverError,
  resolvePublicMenuByKey,
  resolvePublicMenuByReference,
} from "@/lib/catalogue/public-menu-resolver";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { PublicMenuContractError } from "@/lib/catalogue/public-menu-contract";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("public menu resolver", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
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

  it("resolves a stable public key after republish with updated release version", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id, [
      quotes.locationA.id,
    ]);

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "hbz-lunch",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "HBZ Lunch" },
        ar: { displayName: "غداء HBZ" },
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

    const firstPublish = await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const publicKey = firstPublish.results[0]?.publicKey;
    expect(publicKey).toBe(
      deriveStableMenuPublicKey(menu.publicId, quotes.locationA.publicId),
    );

    await updateDraftMenu(db, quotes.tenant.id, admin, menu.publicId, {
      expectedVersion: menu.version,
      translations: {
        en: { displayName: "HBZ Lunch Updated" },
      },
    });

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const resolved = await resolvePublicMenuByKey(db, publicKey!, "en");
    expect(resolved.publicKey).toBe(publicKey);
    expect(resolved.releaseVersion).toBe(2);
    expect(resolved.displayName).toBe("HBZ Lunch Updated");
  });

  it("rejects missing locale and foreign tenant references safely", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const admin = await seedAdministrator(quotes.tenant.id, [
      quotes.locationA.id,
    ]);

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "hbz-snacks",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Snacks" },
        ar: { displayName: "وجبات" },
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

    await expect(resolvePublicMenuByKey(db, "mqr_missing", "en")).rejects.toBeInstanceOf(
      PublicMenuResolverError,
    );

    await expect(
      resolvePublicMenuByKey(db, deriveStableMenuPublicKey(menu.publicId, quotes.locationA.publicId), null),
    ).rejects.toBeInstanceOf(PublicMenuContractError);

    await expect(
      resolvePublicMenuByReference(
        db,
        flowers.tenant.publicId,
        menu.publicId,
        quotes.locationA.publicId,
        "en",
      ),
    ).rejects.toBeInstanceOf(PublicMenuResolverError);
  });

  it("returns localized EN and AR product names from the same release", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id, [
      quotes.locationA.id,
    ]);

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "hbz-drinks",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Drinks" },
        ar: { displayName: "مشروبات" },
      },
      sections: [
        {
          internalName: "hot",
          sortOrder: 0,
          translations: {
            en: { displayName: "Hot" },
            ar: { displayName: "ساخن" },
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

    const published = await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const publicKey = published.results[0]?.publicKey;
    if (!publicKey) {
      throw new Error("Expected publish result to include a publicKey.");
    }

    const english = await resolvePublicMenuByKey(db, publicKey, "en");
    const arabic = await resolvePublicMenuByKey(db, publicKey, "ar");

    expect(english.locale).toBe("en");
    expect(arabic.locale).toBe("ar");
    expect(english.sections[0]?.products[0]?.productPublicId).toBe(
      arabic.sections[0]?.products[0]?.productPublicId,
    );
    expect(english.sections[0]?.products[0]?.displayName).toBe("Flat White");
    expect(arabic.sections[0]?.products[0]?.displayName).toBe("فلات وايت");

    const links = await db.select().from(catalogueMenuPublicLinks);
    expect(links).toHaveLength(1);
    expect(links[0]?.publicKey).toBe(publicKey);
  });
});
