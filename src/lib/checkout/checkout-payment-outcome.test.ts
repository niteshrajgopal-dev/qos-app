import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  customerAuthUsers,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
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
import {
  getAuthenticatedPaymentOutcome,
  reconcileLabelledFixturePaymentOutcome,
} from "@/lib/checkout/checkout-payment-outcome";
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

async function signInCustomer(email: string, password: string, path: string) {
  const auth = getCustomerAuth();
  const response = await auth.api.signInEmail({
    body: { email, password, rememberMe: true },
    asResponse: true,
  });

  const cookie = extractSessionCookie(response.headers.get("set-cookie"));
  return new Request(`http://localhost${path}`, {
    headers: { Cookie: cookie },
  });
}

let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

integrationDescribe("checkout payment outcome reconciliation", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = integrationDatabaseUrl;
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-with-enough-length-for-validation";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;

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
    await sqlClient`TRUNCATE TABLE qos.storefront_checkout_provider_events, qos.storefront_checkout_payment_operations, qos.storefront_checkout_payment_attempts, qos.storefront_checkout_quote_operations, qos.storefront_checkout_quotes, qos.storefront_customer_basket_mutations, qos.storefront_customer_basket_lines, qos.storefront_customer_baskets, qos.storefront_customer_associations, qos.customer_auth_verifications, qos.customer_auth_accounts, qos.customer_auth_sessions, qos.customer_auth_users, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedPaymentAttempt() {
    const quotes = await createQuotesTwoLocationTenant(db);

    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin.outcome@test", email: "admin.outcome@test" })
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
      internalName: "outcome-latte",
      translations: {
        en: { displayName: "Outcome Latte", description: "Coffee" },
        ar: { displayName: "لاتيه", description: "قهوة" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "outcome-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Outcome Menu" },
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
        "admin.outcome@test",
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
      "admin.outcome@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Outcome Storefront",
      slug: "outcome-basket",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.locationA.publicId],
    });

    await registerStorefrontDomain(db, quotes.tenant.id, storefront.publicId, {
      hostname: "outcome.dev.qosapp.com",
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
      "admin.outcome@test",
    );

    const context = {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    };

    await registerCustomer("outcome@example.com", "Password123!", "Outcome User");
    const request = await signInCustomer(
      "outcome@example.com",
      "Password123!",
      "/api/public/checkout/payment-attempts",
    );

    const empty = await getCustomerAccountBasket(db, request, context);
    const basket = await upsertCustomerAccountBasketLine(db, request, {
      ...context,
      productPublicId: latte.publicId,
      quantity: 2,
      expectedVersion: empty.version,
    });

    const quote = await issueAuthenticatedCheckoutQuote(db, request, context, {
      expectedBasketVersion: basket.version,
      operationId: "quote_for_outcome",
    });

    const paymentAttempt = await createAuthenticatedPaymentAttempt(db, request, context, {
      operationId: "pay_for_outcome",
      quotePublicId: quote.quotePublicId,
      expectedQuoteVersion: quote.version,
      returnPath: "/checkout/return",
      cancelPath: "/checkout/cancel",
    });

    return {
      quotes,
      context,
      request,
      quote,
      paymentAttempt,
      tenantId: quotes.tenant.id,
    };
  }

  it("reconciles a labelled fixture payment to a durable succeeded outcome", async () => {
    const seeded = await seedPaymentAttempt();

    const outcome = await reconcileLabelledFixturePaymentOutcome(db, {
      tenantId: seeded.tenantId,
      paymentAttemptPublicId: seeded.paymentAttempt.paymentAttemptPublicId,
      outcome: "succeeded",
      fixtureEventId: "evt_fixture_success_1",
    });

    expect(outcome.status).toBe("succeeded");
    expect(outcome.isTest).toBe(true);
    expect(outcome.totalMinor).toBe(seeded.quote.totalMinor);
    expect(outcome.lines).toHaveLength(1);
    expect(outcome.messaging.bodyEn).toContain("No real charge was made");
    expect(outcome.diagnostics?.isLabelledFixture).toBe(true);

    const statusRequest = await signInCustomer(
      "outcome@example.com",
      "Password123!",
      `/api/public/checkout/payment-attempts/${seeded.paymentAttempt.paymentAttemptPublicId}`,
    );

    const persisted = await getAuthenticatedPaymentOutcome(
      db,
      statusRequest,
      seeded.context,
      seeded.paymentAttempt.paymentAttemptPublicId,
    );

    expect(persisted).toEqual(outcome);
  });

  it("replays fixture provider events idempotently without regressing terminal success", async () => {
    const seeded = await seedPaymentAttempt();
    const fixtureEventId = "evt_fixture_success_2";

    const first = await reconcileLabelledFixturePaymentOutcome(db, {
      tenantId: seeded.tenantId,
      paymentAttemptPublicId: seeded.paymentAttempt.paymentAttemptPublicId,
      outcome: "succeeded",
      fixtureEventId,
    });

    const replay = await reconcileLabelledFixturePaymentOutcome(db, {
      tenantId: seeded.tenantId,
      paymentAttemptPublicId: seeded.paymentAttempt.paymentAttemptPublicId,
      outcome: "succeeded",
      fixtureEventId,
    });

    expect(replay).toEqual(first);

    const failedAttempt = await reconcileLabelledFixturePaymentOutcome(db, {
      tenantId: seeded.tenantId,
      paymentAttemptPublicId: seeded.paymentAttempt.paymentAttemptPublicId,
      outcome: "failed",
      fixtureEventId: "evt_fixture_failed_late",
    });

    expect(failedAttempt.status).toBe("succeeded");
  });

  it("denies cross-customer payment outcome access within the same tenant", async () => {
    const seeded = await seedPaymentAttempt();

    await reconcileLabelledFixturePaymentOutcome(db, {
      tenantId: seeded.tenantId,
      paymentAttemptPublicId: seeded.paymentAttempt.paymentAttemptPublicId,
      outcome: "succeeded",
      fixtureEventId: "evt_fixture_success_3",
    });

    await registerCustomer("other@example.com", "Password123!", "Other User");
    const otherRequest = await signInCustomer(
      "other@example.com",
      "Password123!",
      `/api/public/checkout/payment-attempts/${seeded.paymentAttempt.paymentAttemptPublicId}`,
    );

    await expect(
      getAuthenticatedPaymentOutcome(
        db,
        otherRequest,
        seeded.context,
        seeded.paymentAttempt.paymentAttemptPublicId,
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
