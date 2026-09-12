import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { createDraftProduct } from "@/lib/catalogue/products";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import {
  createAnonymousBasket,
  getAnonymousBasket,
  rejectAnonymousCheckoutQuote,
  removeAnonymousBasketLine,
  upsertAnonymousBasketLine,
} from "@/lib/basket/anonymous-basket";
import { AnonymousBasketAuthError } from "@/lib/basket/session-cookies";
import {
  assignPublishedCollection,
  createStorefront,
  publishStorefrontRelease,
} from "@/lib/storefront/storefronts";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

function buildMutationRequest(sessionToken: string, csrfToken: string) {
  return new Request("http://localhost/api/public/baskets/current/lines", {
    method: "POST",
    headers: {
      Cookie: `qos_anon_session=${encodeURIComponent(sessionToken)}; qos_anon_csrf=${encodeURIComponent(csrfToken)}`,
      "X-QOS-CSRF-Token": csrfToken,
    },
  });
}

integrationDescribe("anonymous storefront basket", () => {
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
    await sqlClient`TRUNCATE TABLE qos.storefront_anonymous_basket_mutations, qos.storefront_anonymous_basket_lines, qos.storefront_anonymous_baskets, qos.storefront_anonymous_sessions, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(tenantId: string, locationIds: string[]) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin.quotes@test", email: "admin.quotes@test" })
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

  async function seedPublishedStorefrontMenu() {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedAdministrator(quotes.tenant.id, [quotes.locationA.id]);

    const product = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "flat-white",
      translations: {
        en: { displayName: "Flat White", description: "Coffee" },
        ar: { displayName: "فلات وايت", description: "قهوة" },
      },
      defaultVariant: { amountMinor: 2000, currency: "AED" },
    });

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "basket-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Basket Menu" },
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

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quotes@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Storefront",
      slug: "quotes",
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

    return {
      quotes,
      product,
      menu,
      storefront,
    };
  }

  it("creates a basket and reloads it in the same session", async () => {
    const { quotes, product, storefront } = await seedPublishedStorefrontMenu();

    const created = await createAnonymousBasket(db, {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
      locale: "en",
    });

    expect(created.basket.lines).toEqual([]);
    expect(created.basket.version).toBe(1);

    const request = buildMutationRequest(created.sessionToken, created.csrfToken);
    const updated = await upsertAnonymousBasketLine(
      db,
      request,
      created.sessionToken,
      {
        productPublicId: product.publicId,
        quantity: 2,
        expectedVersion: created.basket.version,
        mutationId: "mut_add_1",
      },
    );

    expect(updated.lines).toHaveLength(1);
    expect(updated.lines[0]?.quantity).toBe(2);
    expect(updated.provisionalSubtotalMinor).toBe(4000);

    const reloaded = await getAnonymousBasket(db, created.sessionToken);
    expect(reloaded).toEqual(updated);
  });

  it("rejects access from another session token", async () => {
    const { quotes, storefront } = await seedPublishedStorefrontMenu();

    await createAnonymousBasket(db, {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    });

    await expect(getAnonymousBasket(db, "invalid-session-token")).rejects.toBeInstanceOf(
      AnonymousBasketAuthError,
    );
  });

  it("rejects unpublished products and stale versions", async () => {
    const { quotes, product, storefront } = await seedPublishedStorefrontMenu();

    const created = await createAnonymousBasket(db, {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    });

    const request = buildMutationRequest(created.sessionToken, created.csrfToken);

    await expect(
      upsertAnonymousBasketLine(db, request, created.sessionToken, {
        productPublicId: "prd_unknown",
        quantity: 1,
        expectedVersion: created.basket.version,
      }),
    ).rejects.toMatchObject({ statusCode: 400, field: "productPublicId" });

    await upsertAnonymousBasketLine(db, request, created.sessionToken, {
      productPublicId: product.publicId,
      quantity: 1,
      expectedVersion: created.basket.version,
    });

    await expect(
      upsertAnonymousBasketLine(db, request, created.sessionToken, {
        productPublicId: product.publicId,
        quantity: 2,
        expectedVersion: created.basket.version,
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("returns the same basket for duplicate mutation ids", async () => {
    const { quotes, product, storefront } = await seedPublishedStorefrontMenu();

    const created = await createAnonymousBasket(db, {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    });

    const request = buildMutationRequest(created.sessionToken, created.csrfToken);
    const first = await upsertAnonymousBasketLine(
      db,
      request,
      created.sessionToken,
      {
        productPublicId: product.publicId,
        quantity: 1,
        expectedVersion: created.basket.version,
        mutationId: "mut_retry_1",
      },
    );

    const second = await upsertAnonymousBasketLine(
      db,
      request,
      created.sessionToken,
      {
        productPublicId: product.publicId,
        quantity: 99,
        expectedVersion: created.basket.version,
        mutationId: "mut_retry_1",
      },
    );

    expect(second).toEqual(first);
  });

  it("rejects anonymous checkout quote requests", async () => {
    const { quotes, storefront } = await seedPublishedStorefrontMenu();

    const created = await createAnonymousBasket(db, {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    });

    await expect(
      rejectAnonymousCheckoutQuote(db, created.sessionToken),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("removes lines with version checks", async () => {
    const { quotes, product, storefront } = await seedPublishedStorefrontMenu();

    const created = await createAnonymousBasket(db, {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    });

    const request = buildMutationRequest(created.sessionToken, created.csrfToken);
    const withLine = await upsertAnonymousBasketLine(
      db,
      request,
      created.sessionToken,
      {
        productPublicId: product.publicId,
        quantity: 1,
        expectedVersion: created.basket.version,
      },
    );

    const linePublicId = withLine.lines[0]!.linePublicId;
    const removed = await removeAnonymousBasketLine(
      db,
      request,
      created.sessionToken,
      linePublicId,
      { expectedVersion: withLine.version },
    );

    expect(removed.lines).toEqual([]);
    expect(removed.version).toBe(withLine.version + 1);
  });
});
