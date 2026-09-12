import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  customerAuthUsers,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontCheckoutQuotes,
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
import { createAuthenticatedPaymentAttempt } from "@/lib/checkout/checkout-payment-attempt";
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
  return new Request("http://localhost/api/public/checkout/payment-attempts", {
    headers: { Cookie: cookie },
  });
}

let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

integrationDescribe("authenticated checkout payment attempt", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = integrationDatabaseUrl;
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-with-enough-length-for-validation";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    delete process.env.STRIPE_SECRET_KEY;

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
    await sqlClient`TRUNCATE TABLE qos.storefront_checkout_payment_operations, qos.storefront_checkout_payment_attempts, qos.storefront_checkout_quote_operations, qos.storefront_checkout_quotes, qos.storefront_basket_merge_operations, qos.storefront_customer_basket_mutations, qos.storefront_customer_basket_lines, qos.storefront_customer_baskets, qos.storefront_customer_associations, qos.customer_auth_verifications, qos.customer_auth_accounts, qos.customer_auth_sessions, qos.customer_auth_users, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedPublishedStorefrontMenu() {
    const quotes = await createQuotesTwoLocationTenant(db);

    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin.pay@test", email: "admin.pay@test" })
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
      internalName: "pay-latte",
      translations: {
        en: { displayName: "Pay Latte", description: "Coffee" },
        ar: { displayName: "لاتيه", description: "قهوة" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "pay-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Pay Menu" },
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
          products: [{ productPublicId: latte.publicId, sortOrder: 0 }],
        },
      ],
    });

    for (const locale of ["en", "ar"] as const) {
      await approveProductTranslation(
        db,
        quotes.tenant.id,
        "admin.pay@test",
        latte.publicId,
        locale,
        {
          expectedTranslationVersion: latte.translations[locale].translationVersion,
        },
      );
    }

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.pay@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Pay Storefront",
      slug: "pay-basket",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.locationA.publicId],
    });

    await registerStorefrontDomain(db, quotes.tenant.id, storefront.publicId, {
      hostname: "pay.dev.qosapp.com",
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
      "admin.pay@test",
    );

    return { quotes, latte, storefront };
  }

  async function seedQuote() {
    const seeded = await seedPublishedStorefrontMenu();
    const context = {
      storefrontPublicId: seeded.storefront.publicId,
      locationPublicId: seeded.quotes.locationA.publicId,
    };

    await registerCustomer("pay@example.com", "Password123!", "Pay User");
    const request = await signInCustomer("pay@example.com", "Password123!");
    const empty = await getCustomerAccountBasket(db, request, context);

    const basket = await upsertCustomerAccountBasketLine(db, request, {
      ...context,
      productPublicId: seeded.latte.publicId,
      quantity: 2,
      expectedVersion: empty.version,
    });

    const quote = await issueAuthenticatedCheckoutQuote(db, request, context, {
      expectedBasketVersion: basket.version,
      operationId: "quote_for_payment",
    });

    return { ...seeded, context, request, basket, quote };
  }

  it("creates a labelled fixture payment handoff from an authenticated quote", async () => {
    const { context, request, quote } = await seedQuote();

    const paymentAttempt = await createAuthenticatedPaymentAttempt(
      db,
      request,
      context,
      {
        operationId: "pay_attempt_1",
        quotePublicId: quote.quotePublicId,
        expectedQuoteVersion: quote.version,
        returnPath: "/checkout/return",
        cancelPath: "/checkout/cancel",
      },
    );

    expect(paymentAttempt.isTest).toBe(true);
    expect(paymentAttempt.provider).toBe("stripe");
    expect(paymentAttempt.providerMode).toBe("fixture");
    expect(paymentAttempt.status).toBe("provider_handoff");
    expect(paymentAttempt.totalMinor).toBe(quote.totalMinor);
    expect(paymentAttempt.handoff.isLabelledFixture).toBe(true);
    expect(paymentAttempt.handoff.kind).toBe("fixture");
    expect(paymentAttempt.handoff.url).toContain("label=fixture-only");
  });

  it("replays payment attempts idempotently and rejects conflicting operation ids", async () => {
    const { context, request, quote } = await seedQuote();

    const payload = {
      operationId: "pay_retry_1",
      quotePublicId: quote.quotePublicId,
      expectedQuoteVersion: quote.version,
      returnPath: "/checkout/return",
      cancelPath: "/checkout/cancel",
    };

    const first = await createAuthenticatedPaymentAttempt(
      db,
      request,
      context,
      payload,
    );
    const second = await createAuthenticatedPaymentAttempt(
      db,
      request,
      context,
      payload,
    );

    expect(second).toEqual(first);

    await expect(
      createAuthenticatedPaymentAttempt(db, request, context, {
        ...payload,
        returnPath: "/checkout/other-return",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      field: "operationId",
    });
  });

  it("rejects forged client amounts and expired quotes", async () => {
    const { context, request, quote } = await seedQuote();

    await expect(
      createAuthenticatedPaymentAttempt(db, request, context, {
        operationId: "pay_forged_amount",
        quotePublicId: quote.quotePublicId,
        expectedQuoteVersion: quote.version,
        returnPath: "/checkout/return",
        cancelPath: "/checkout/cancel",
        amountMinor: 1,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      field: "amountMinor",
    });

    await db
      .update(storefrontCheckoutQuotes)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(storefrontCheckoutQuotes.publicId, quote.quotePublicId));

    await expect(
      createAuthenticatedPaymentAttempt(db, request, context, {
        operationId: "pay_expired_quote",
        quotePublicId: quote.quotePublicId,
        expectedQuoteVersion: quote.version,
        returnPath: "/checkout/return",
        cancelPath: "/checkout/cancel",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      field: "quotePublicId",
    });
  });

  it("rejects stale quote versions and duplicate active attempts", async () => {
    const { context, request, quote } = await seedQuote();

    await expect(
      createAuthenticatedPaymentAttempt(db, request, context, {
        operationId: "pay_stale_version",
        quotePublicId: quote.quotePublicId,
        expectedQuoteVersion: quote.version - 1,
        returnPath: "/checkout/return",
        cancelPath: "/checkout/cancel",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      field: "expectedQuoteVersion",
    });

    await createAuthenticatedPaymentAttempt(db, request, context, {
      operationId: "pay_first_attempt",
      quotePublicId: quote.quotePublicId,
      expectedQuoteVersion: quote.version,
      returnPath: "/checkout/return",
      cancelPath: "/checkout/cancel",
    });

    await expect(
      createAuthenticatedPaymentAttempt(db, request, context, {
        operationId: "pay_second_attempt",
        quotePublicId: quote.quotePublicId,
        expectedQuoteVersion: quote.version,
        returnPath: "/checkout/return",
        cancelPath: "/checkout/cancel",
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      field: "quotePublicId",
    });
  });
});
