import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  customerAuthUsers,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontCustomerBasketLines,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  integrationDatabaseUrl,
  resetAndMigrate,
} from "@/db/test-utils";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import {
  getCustomerAccountBasket,
  upsertCustomerAccountBasketLine,
} from "@/lib/basket/customer-basket";
import { issueAuthenticatedCheckoutQuote } from "@/lib/checkout/checkout-quote";
import { CheckoutPricingError } from "@/lib/checkout/pricing-arithmetic";
import { getCustomerAuth } from "@/lib/customer/auth-server";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import {
  assignPublishedCollection,
  createStorefront,
  publishStorefrontRelease,
  registerStorefrontDomain,
} from "@/lib/storefront/storefronts";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

function extractSessionCookie(setCookieHeader: string | null) {
  if (!setCookieHeader) {
    return "";
  }

  const match = setCookieHeader.match(/better-auth\.session_token=([^;]+)/);
  return match ? `better-auth.session_token=${match[1]}` : "";
}

async function registerCustomer(email: string, password: string, name: string) {
  const auth = getCustomerAuth();
  await auth.api.signUpEmail({
    body: { email, password, name },
  });

  await db
    .update(customerAuthUsers)
    .set({ emailVerified: true })
    .where(eq(customerAuthUsers.email, email));
}

async function signInCustomer(email: string, password: string) {
  const auth = getCustomerAuth();
  const response = await auth.api.signInEmail({
    body: { email, password, rememberMe: true },
    asResponse: true,
  });

  const cookie = extractSessionCookie(response.headers.get("set-cookie"));
  return new Request("http://localhost/api/public/baskets/account/current/checkout-quote", {
    headers: { Cookie: cookie },
  });
}

let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

integrationDescribe("authenticated checkout quote", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = integrationDatabaseUrl;
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-with-enough-length-for-validation";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";

    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  });

  afterAll(async () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.storefront_checkout_quote_operations, qos.storefront_checkout_quotes, qos.storefront_basket_merge_operations, qos.storefront_customer_basket_mutations, qos.storefront_customer_basket_lines, qos.storefront_customer_baskets, qos.storefront_customer_associations, qos.customer_auth_verifications, qos.customer_auth_accounts, qos.customer_auth_sessions, qos.customer_auth_users, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedPublishedStorefrontMenu() {
    const quotes = await createQuotesTwoLocationTenant(db);

    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin.quote@test", email: "admin.quote@test" })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId: quotes.tenant.id,
        staffIdentityId: identity.id,
        role: "administrator",
      })
      .returning();

    await db.insert(staffLocationScopes).values({
      tenantId: quotes.tenant.id,
      staffMembershipId: membership.id,
      locationId: quotes.locationA.id,
    });

    const admin = {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };

    const latte = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "quote-latte",
      translations: {
        en: { displayName: "Quote Latte", description: "Coffee" },
        ar: { displayName: "لاتيه", description: "قهوة" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    const croissant = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "quote-croissant",
      translations: {
        en: { displayName: "Quote Croissant", description: "Pastry" },
        ar: { displayName: "كرواسون", description: "معجنات" },
      },
      defaultVariant: { amountMinor: 2000, currency: "AED" },
    });

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "quote-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Quote Menu" },
        ar: { displayName: "قائمة" },
      },
      sections: [
        {
          internalName: "items",
          sortOrder: 0,
          translations: {
            en: { displayName: "Items" },
            ar: { displayName: "عناصر" },
          },
          products: [
            { productPublicId: latte.publicId, sortOrder: 0 },
            { productPublicId: croissant.publicId, sortOrder: 1 },
          ],
        },
      ],
    });

    for (const product of [latte, croissant]) {
      for (const locale of ["en", "ar"] as const) {
        await approveProductTranslation(
          db,
          quotes.tenant.id,
          "admin.quote@test",
          product.publicId,
          locale,
          {
            expectedTranslationVersion:
              product.translations[locale].translationVersion,
          },
        );
      }
    }

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.quote@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quote Storefront",
      slug: "quote-basket",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.locationA.publicId],
    });

    await registerStorefrontDomain(db, quotes.tenant.id, storefront.publicId, {
      hostname: "quote.dev.qosapp.com",
      domainType: "platform_subdomain",
      lifecycleStatus: "active",
      isPrimary: true,
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
      "admin.quote@test",
    );

    return { quotes, latte, croissant, storefront };
  }

  async function seedCustomerBasket() {
    const seeded = await seedPublishedStorefrontMenu();
    const context = {
      storefrontPublicId: seeded.storefront.publicId,
      locationPublicId: seeded.quotes.locationA.publicId,
    };

    await registerCustomer("quote@example.com", "Password123!", "Quote User");
    const request = await signInCustomer("quote@example.com", "Password123!");
    const empty = await getCustomerAccountBasket(db, request, context);

    await upsertCustomerAccountBasketLine(db, request, {
      ...context,
      productPublicId: seeded.latte.publicId,
      quantity: 2,
      expectedVersion: empty.version,
    });

    const withCroissant = await upsertCustomerAccountBasketLine(db, request, {
      ...context,
      productPublicId: seeded.croissant.publicId,
      quantity: 1,
      expectedVersion: empty.version + 1,
    });

    return {
      ...seeded,
      context,
      request,
      basket: withCroissant,
    };
  }

  it("issues a quote with policy v1 totals for a signed-in account basket", async () => {
    const { context, request, basket } = await seedCustomerBasket();

    const quote = await issueAuthenticatedCheckoutQuote(db, request, context, {
      expectedBasketVersion: basket.version,
    });

    expect(quote.isTest).toBe(true);
    expect(quote.totalMinor).toBe(6090);
    expect(quote.merchandiseSubtotalMinor).toBe(5600);
    expect(quote.discountMinor).toBe(0);
    expect(quote.vatMinor).toBe(290);
    expect(quote.lines).toHaveLength(2);
    expect(quote.expiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("applies an eligible coupon using the synthetic fixture policy", async () => {
    const { context, request, basket } = await seedCustomerBasket();

    const quote = await issueAuthenticatedCheckoutQuote(db, request, context, {
      expectedBasketVersion: basket.version,
      couponCode: "SAVE10",
    });

    expect(quote.totalMinor).toBe(5502);
    expect(quote.couponCode).toBe("SAVE10");
    expect(quote.discountMinor).toBe(560);
  });

  it("returns the same monetary totals regardless of locale", async () => {
    const { context, request, basket } = await seedCustomerBasket();

    const english = await issueAuthenticatedCheckoutQuote(
      db,
      request,
      { ...context, locale: "en" },
      { expectedBasketVersion: basket.version, operationId: "quote_locale_en" },
    );

    const arabic = await issueAuthenticatedCheckoutQuote(
      db,
      request,
      { ...context, locale: "ar" },
      { expectedBasketVersion: basket.version, operationId: "quote_locale_ar" },
    );

    expect(arabic.totalMinor).toBe(english.totalMinor);
    expect(arabic.lines[0]?.displayNameAr).toBe("لاتيه");
    expect(english.lines[0]?.displayNameEn).toBe("Quote Latte");
  });

  it("rejects stale basket versions and expired coupons", async () => {
    const { context, request, basket } = await seedCustomerBasket();

    await expect(
      issueAuthenticatedCheckoutQuote(db, request, context, {
        expectedBasketVersion: basket.version - 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      field: "expectedBasketVersion",
    });

    await expect(
      issueAuthenticatedCheckoutQuote(db, request, context, {
        expectedBasketVersion: basket.version,
        couponCode: "EXPIRED10",
      }),
    ).rejects.toBeInstanceOf(CheckoutPricingError);
  });

  it("requires price correction when basket lines drift from the published menu", async () => {
    const { context, request, basket } = await seedCustomerBasket();

    await db
      .update(storefrontCustomerBasketLines)
      .set({ unitAmountMinor: 999 })
      .where(eq(storefrontCustomerBasketLines.publicId, basket.lines[0]!.linePublicId));

    await expect(
      issueAuthenticatedCheckoutQuote(db, request, context, {
        expectedBasketVersion: basket.version,
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      field: "priceCorrections",
    });
  });

  it("replays quote requests idempotently and rejects conflicting operation ids", async () => {
    const { context, request, basket } = await seedCustomerBasket();

    const payload = {
      expectedBasketVersion: basket.version,
      couponCode: "SAVE10",
      operationId: "quote_retry_1",
    };

    const first = await issueAuthenticatedCheckoutQuote(db, request, context, payload);
    const second = await issueAuthenticatedCheckoutQuote(db, request, context, payload);

    expect(second).toEqual(first);

    await expect(
      issueAuthenticatedCheckoutQuote(db, request, context, {
        expectedBasketVersion: basket.version,
        operationId: "quote_retry_1",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      field: "operationId",
    });
  });
});
