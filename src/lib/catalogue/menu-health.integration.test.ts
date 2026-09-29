import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  catalogueMediaAssets,
  catalogueMediaDerivatives,
  catalogueProducts,
  locations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { assignProductToCategory, createCategory } from "@/lib/catalogue/categories";
import { createLocationStopSale } from "@/lib/catalogue/location-availability";
import { getMenuHealth } from "@/lib/catalogue/menu-health";
import { createDraftMenu, MenuError } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("menu health", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.location_item_stop_sales, qos.catalogue_product_categories, qos.catalogue_categories, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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
        en: { displayName, description: `${displayName} description` },
        ar: { displayName: `${displayName} عربي`, description: "وصف" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    } as const;
  }

  async function attachApprovedThumbnail(tenantId: string, productPublicId: string) {
    const [product] = await db
      .select({ id: catalogueProducts.id })
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, tenantId),
          eq(catalogueProducts.publicId, productPublicId),
        ),
      );
    const [asset] = await db
      .insert(catalogueMediaAssets)
      .values({
        tenantId,
        publicId: `med_${productPublicId}`,
        productId: product!.id,
        status: "approved",
        contentType: "image/png",
      })
      .returning();
    await db.insert(catalogueMediaDerivatives).values({
      tenantId,
      assetId: asset.id,
      derivativeKind: "thumbnail",
      publicDerivativeId: `mda_${productPublicId}_thumb`,
      storagePath: `${tenantId}/public/mda_${productPublicId}_thumb.jpg`,
      contentType: "image/jpeg",
      width: 100,
      height: 100,
      byteSize: 512,
    });
    await db
      .update(catalogueProducts)
      .set({ primaryMediaAssetId: asset.id })
      .where(eq(catalogueProducts.id, product!.id));
  }

  async function seedMenu() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const adminSubject = "admin.quotes@test";
    const admin = await seedMember(quotes.tenant.id, [quotes.location.id], "administrator", adminSubject);

    const withPhoto = await createDraftProduct(db, quotes.tenant.id, admin, productInput("flat-white", "Flat White"));
    const noPhoto = await createDraftProduct(db, quotes.tenant.id, admin, productInput("latte", "Latte"));
    const duplicate = await createDraftProduct(db, quotes.tenant.id, admin, productInput("latte-2", "LATTE!"));

    for (const product of [withPhoto, noPhoto, duplicate]) {
      for (const locale of ["en", "ar"] as const) {
        await approveProductTranslation(db, quotes.tenant.id, adminSubject, product.publicId, locale, {
          expectedTranslationVersion: product.translations[locale].translationVersion,
        });
      }
    }

    await attachApprovedThumbnail(quotes.tenant.id, withPhoto.publicId);

    const category = await createCategory(
      db,
      quotes.tenant.id,
      {
        internalName: "coffee",
        translations: { en: { displayName: "Coffee" }, ar: { displayName: "قهوة" } },
      },
      adminSubject,
      admin,
    );
    await assignProductToCategory(
      db,
      quotes.tenant.id,
      category.publicId,
      { productPublicId: withPhoto.publicId },
      adminSubject,
      admin,
    );

    await createLocationStopSale(db, quotes.tenant.id, adminSubject, quotes.location.publicId, {
      targetType: "product",
      targetPublicId: noPhoto.publicId,
      reason: "Out of milk",
    });

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "فطور" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "قهوة" } },
          products: [
            { productPublicId: withPhoto.publicId, sortOrder: 0 },
            { productPublicId: noPhoto.publicId, sortOrder: 1 },
            { productPublicId: duplicate.publicId, sortOrder: 2 },
          ],
        },
        {
          internalName: "specials",
          sortOrder: 1,
          translations: { en: { displayName: "Specials" }, ar: { displayName: "عروض" } },
          products: [{ productPublicId: withPhoto.publicId, sortOrder: 0 }],
        },
      ],
    });

    return { quotes, admin, adminSubject, menu, withPhoto, noPhoto, duplicate };
  }

  it("computes health from the batched facts through qos_app RLS", async () => {
    const { quotes, admin, menu, withPhoto, noPhoto, duplicate } = await seedMenu();

    const report = await runAsRole(sqlClient, "qos_app", () =>
      getMenuHealth(db, quotes.tenant.id, admin, menu.publicId),
    );

    const group = (type: string) => report.issueGroups.find((entry) => entry.type === type)!;

    expect(report.totals).toEqual({ products: 3, sections: 2, locations: 1, productsWithIssues: 2 });
    expect(group("missing_photo").productPublicIds.sort()).toEqual(
      [noPhoto.publicId, duplicate.publicId].sort(),
    );
    expect(group("uncategorised").productPublicIds.sort()).toEqual(
      [noPhoto.publicId, duplicate.publicId].sort(),
    );
    expect(group("duplicate_name").productPublicIds.sort()).toEqual(
      [noPhoto.publicId, duplicate.publicId].sort(),
    );
    expect(group("stop_sale").productPublicIds).toEqual([noPhoto.publicId]);
    expect(group("missing_translation").productCount).toBe(0);
    expect(group("missing_price").productCount).toBe(0);

    const healthy = report.products.find((product) => product.productPublicId === withPhoto.publicId)!;
    expect(healthy.issues).toEqual([]);
    expect(healthy.thumbnailPublicId).toBe(`mda_${withPhoto.publicId}_thumb`);
    expect(report.completeness).toEqual({ percent: 77, passedChecks: 14, totalChecks: 18 });
    expect(report.availability.checkedLocations).toEqual([
      { publicId: quotes.location.publicId, name: quotes.location.name },
    ]);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(quotes.tenant.id);
    expect(serialized).not.toContain(quotes.location.id);
    expect(serialized).not.toContain(admin.membershipId);
  });

  it("does not expose another tenant's menu", async () => {
    const { menu } = await seedMenu();
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const flowersAdmin = await seedMember(flowers.tenant.id, [flowers.location.id], "administrator", "admin.flowers@test");

    await expect(
      runAsRole(sqlClient, "qos_app", () =>
        getMenuHealth(db, flowers.tenant.id, flowersAdmin, menu.publicId),
      ),
    ).rejects.toBeInstanceOf(MenuError);
  });

  it("requires the caller's location scope to cover every menu location", async () => {
    const { quotes, admin, menu } = await seedMenu();
    const [extra] = await db
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
    const extraMenu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "two-locations",
      locationIds: [quotes.location.id, extra!.id],
      translations: { en: { displayName: "Two Locations" }, ar: { displayName: "موقعان" } },
    });
    const scopedUser = await seedMember(quotes.tenant.id, [quotes.location.id], "user", "user.quotes@test");

    const allowed = await getMenuHealth(db, quotes.tenant.id, scopedUser, menu.publicId);
    expect(allowed.totals.products).toBe(3);

    await expect(
      getMenuHealth(db, quotes.tenant.id, scopedUser, extraMenu.publicId),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
  });

  it("returns 404 for an unknown menu", async () => {
    const { quotes, admin } = await seedMenu();

    await expect(
      getMenuHealth(db, quotes.tenant.id, admin, "mnu_does_not_exist"),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
