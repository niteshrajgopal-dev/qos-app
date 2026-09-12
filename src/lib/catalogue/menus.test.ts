import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  locations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { createDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import {
  createDraftMenu,
  getDraftMenu,
  MenuConflictError,
  MenuError,
  updateDraftMenu,
} from "@/lib/catalogue/menus";
import {
  getCustomerMenuPayload,
  publishDraftMenuToLocations,
} from "@/lib/catalogue/menu-publish";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { StaffAuthorizationError } from "@/lib/staff/auth";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue draft menus", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(
    tenantId: string,
    locationId: string,
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

    await db.insert(staffLocationScopes).values({
      tenantId,
      staffMembershipId: membership.id,
      locationId,
    });

    return {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };
  }

  async function seedUser(
    tenantId: string,
    locationId: string,
    subject = "user.quotes@test",
    email = "user.quotes@test",
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
    defaultVariant: { amountMinor: 1800, currency: "AED" },
  } as const;

  async function approveBilingualProduct(
    tenantId: string,
    adminSubject: string,
    productPublicId: string,
    enVersion: number,
    arVersion: number,
  ) {
    await approveProductTranslation(
      db,
      tenantId,
      adminSubject,
      productPublicId,
      "en",
      { expectedTranslationVersion: enVersion },
    );
    await approveProductTranslation(
      db,
      tenantId,
      adminSubject,
      productPublicId,
      "ar",
      { expectedTranslationVersion: arVersion },
    );
  }

  it("creates a menu with two sections and one product placed in both", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedAdministrator(quotes.tenant.id, quotes.location.id);

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "hbz-breakfast",
      locationIds: [quotes.location.id],
      translations: {
        en: { displayName: "HBZ Breakfast", description: "Morning menu" },
        ar: { displayName: "فطور HBZ", description: "قائمة الصباح" },
      },
      sections: [
        {
          internalName: "hot-drinks",
          sortOrder: 0,
          translations: {
            en: { displayName: "Hot Drinks" },
            ar: { displayName: "مشروبات ساخنة" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
        {
          internalName: "specials",
          sortOrder: 1,
          translations: {
            en: { displayName: "Specials" },
            ar: { displayName: "عروض" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    expect(menu.sections).toHaveLength(2);
    expect(menu.sections[0]?.products[0]?.productPublicId).toBe(product.publicId);
    expect(menu.sections[1]?.products[0]?.productPublicId).toBe(product.publicId);

    const reloaded = await getDraftMenu(db, quotes.tenant.id, menu.publicId);
    expect(reloaded.sections.map((section) => section.sortOrder)).toEqual([0, 1]);
    expect(reloaded.itemCount).toBe(2);
  });

  it("keeps live customer payload unchanged while draft edits accumulate", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedAdministrator(quotes.tenant.id, quotes.location.id);

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      productInput,
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "hbz-lunch",
      locationIds: [quotes.location.id],
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
            ar: { displayName: "أطباق رئيسية" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    await approveBilingualProduct(
      quotes.tenant.id,
      "admin.quotes@test",
      product.publicId,
      product.translations.en.translationVersion,
      product.translations.ar.translationVersion,
    );

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.location.id] },
    );

    const liveBefore = await getCustomerMenuPayload(
      db,
      quotes.tenant.id,
      menu.publicId,
      quotes.location.publicId,
    );

    const updated = await updateDraftMenu(
      db,
      quotes.tenant.id,
      admin,
      menu.publicId,
      {
        expectedVersion: menu.version,
        translations: {
          en: { displayName: "HBZ Lunch Draft Edit" },
        },
      },
    );

    expect(updated.hasUnpublishedChanges).toBe(true);

    const liveAfter = await getCustomerMenuPayload(
      db,
      quotes.tenant.id,
      menu.publicId,
      quotes.location.publicId,
    );

    expect(liveAfter).toEqual(liveBefore);
    expect(liveAfter?.translations.en.displayName).toBe("HBZ Lunch");
  });

  it("returns a conflict on stale menu version updates", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedAdministrator(quotes.tenant.id, quotes.location.id);

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "hbz-snacks",
      locationIds: [quotes.location.id],
      translations: {
        en: { displayName: "Snacks" },
        ar: { displayName: "وجبات خفيفة" },
      },
    });

    await expect(
      updateDraftMenu(db, quotes.tenant.id, admin, menu.publicId, {
        expectedVersion: menu.version + 1,
        internalName: "stale-edit",
      }),
    ).rejects.toBeInstanceOf(MenuConflictError);
  });

  it("rejects foreign tenant locations and cross-tenant menu reads", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, {
      ...quotesTenantFixture(),
      tenant: {
        ...quotesTenantFixture().tenant,
        publicId: "ten_flowers_alt",
        name: "Flowers Alt",
      },
      organization: {
        ...quotesTenantFixture().organization,
        publicId: "org_flowers_alt",
      },
      brand: {
        ...quotesTenantFixture().brand,
        publicId: "brd_flowers_alt",
      },
      location: {
        ...quotesTenantFixture().location,
        publicId: "loc_flowers_alt",
        slug: "flowers-alt",
      },
    });

    const admin = await seedAdministrator(quotes.tenant.id, quotes.location.id);

    await expect(
      createDraftMenu(db, quotes.tenant.id, admin, {
        internalName: "invalid-menu",
        locationIds: [flowers.location.id],
        translations: {
          en: { displayName: "Invalid" },
          ar: { displayName: "غير صالح" },
        },
      }),
    ).rejects.toBeInstanceOf(MenuError);

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "valid-menu",
      locationIds: [quotes.location.id],
      translations: {
        en: { displayName: "Valid" },
        ar: { displayName: "صالح" },
      },
    });

    await expect(
      getDraftMenu(db, flowers.tenant.id, menu.publicId),
    ).rejects.toBeInstanceOf(MenuError);
  });

  it("blocks user role from assigning unauthorized locations", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedAdministrator(quotes.tenant.id, quotes.location.id);
    const user = await seedUser(quotes.tenant.id, quotes.location.id);

    const extraLocation = await db
      .insert(locations)
      .values({
        tenantId: quotes.tenant.id,
        brandId: quotes.brand.id,
        publicId: "loc_quotes_extra",
        name: "Extra Location",
        slug: "extra",
        timezone: "Asia/Dubai",
      })
      .returning();

    await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "admin-menu",
      locationIds: [quotes.location.id],
      translations: {
        en: { displayName: "Admin Menu" },
        ar: { displayName: "قائمة المسؤول" },
      },
    });

    await expect(
      createDraftMenu(db, quotes.tenant.id, user, {
        internalName: "user-invalid",
        locationIds: [extraLocation[0]!.id],
        translations: {
          en: { displayName: "User Invalid" },
          ar: { displayName: "غير مصرح" },
        },
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
  });
});
