import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenants,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { createAnonymousBasket } from "@/lib/basket/anonymous-basket";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { resolvePublicMenuByReference } from "@/lib/catalogue/public-menu-resolver";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { requireActiveStaffMembership } from "@/lib/staff/auth";
import {
  assignPublishedCollection,
  createStorefront,
  publishStorefrontRelease,
} from "@/lib/storefront/storefronts";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { requireActiveTenant, TenantInactiveError } from "@/lib/tenant/tenant-status";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("platform tenant suspension", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient?.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.agent_runs, qos.tenant_agent_bindings, qos.agent_provider_credentials, qos.agent_provider_connections, qos.storefront_anonymous_basket_mutations, qos.storefront_anonymous_basket_lines, qos.storefront_anonymous_baskets, qos.storefront_anonymous_sessions, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(tenantId: string, locationId: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin.quotes@test", email: "admin.quotes@test" })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId,
        staffIdentityId: identity!.id,
        role: "administrator",
      })
      .returning();

    await db.insert(staffLocationScopes).values({
      tenantId,
      staffMembershipId: membership!.id,
      locationId,
    });

    return {
      membershipId: membership!.id,
      role: "administrator" as const,
      staffIdentityId: identity!.id,
    };
  }

  async function seedPublishedStorefront() {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id, quotes.locationA.id);

    const product = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "flat-white",
      translations: {
        en: { displayName: "Flat White", description: "Coffee" },
        ar: { displayName: "فلات وايت", description: "قهوة" },
      },
      defaultVariant: { amountMinor: 2000, currency: "AED" },
    });

    await approveProductTranslation(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      product.publicId,
      "en",
      { expectedTranslationVersion: product.translations.en.translationVersion },
    );
    await approveProductTranslation(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      product.publicId,
      "ar",
      { expectedTranslationVersion: product.translations.ar.translationVersion },
    );

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "suspension-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Suspension Menu" },
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

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Store",
      slug: "quotes-store",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      locationPublicIds: [quotes.locationA.publicId],
    });

    await assignPublishedCollection(
      db,
      quotes.tenant.id,
      storefront.publicId,
      quotes.locationA.publicId,
      menu.publicId,
    );

    await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      "admin.quotes@test",
    );

    return { quotes, admin, menu, storefront };
  }

  async function suspendTenant(tenantId: string) {
    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenantId));
  }

  it("blocks staff membership checks and protected writes for a suspended business", async () => {
    const { quotes, menu } = await seedPublishedStorefront();
    await suspendTenant(quotes.tenant.id);

    await expect(
      requireActiveStaffMembership(db, quotes.tenant.id, "admin.quotes@test"),
    ).rejects.toBeInstanceOf(TenantInactiveError);

    await expect(
      publishDraftMenuToLocations(db, quotes.tenant.id, "admin.quotes@test", menu.publicId, {
        locationIds: [quotes.locationA.id],
      }),
    ).rejects.toBeInstanceOf(TenantInactiveError);
  });

  it("blocks storefront basket creation and public menu reads when suspended", async () => {
    const { quotes, storefront, menu } = await seedPublishedStorefront();
    await suspendTenant(quotes.tenant.id);

    await expect(
      createAnonymousBasket(db, {
        storefrontPublicId: storefront.publicId,
        locationPublicId: quotes.locationA.publicId,
      }),
    ).rejects.toBeInstanceOf(TenantInactiveError);

    await expect(
      resolvePublicMenuByReference(
        db,
        quotes.tenant.publicId,
        menu.publicId,
        quotes.locationA.publicId,
        "en",
      ),
    ).rejects.toBeInstanceOf(TenantInactiveError);
  });

  it("still allows active businesses through staff and storefront paths", async () => {
    const { quotes, storefront } = await seedPublishedStorefront();

    await expect(
      requireActiveStaffMembership(db, quotes.tenant.id, "admin.quotes@test"),
    ).resolves.toMatchObject({ role: "administrator" });

    const basket = await createAnonymousBasket(db, {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    });

    expect(basket.basket.storefrontPublicId).toBe(storefront.publicId);
  });

  it("uses the same tenant-active primitive as the AI execution path", async () => {
    const { quotes } = await seedPublishedStorefront();

    await expect(requireActiveTenant(db, quotes.tenant.id)).resolves.toBeUndefined();

    await suspendTenant(quotes.tenant.id);

    await expect(requireActiveTenant(db, quotes.tenant.id)).rejects.toMatchObject({
      code: "tenant_inactive",
    });
  });
});
