import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { eq } from "drizzle-orm";
import { verifyPassword } from "better-auth/crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  customerAuthAccounts,
  customerAuthUsers,
  staffAuthUsers,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontCheckoutPaymentAttempts,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  integrationDatabaseUrl,
  resetAndMigrate,
} from "@/db/test-utils";
import {
  getCustomerAccountBasket,
  upsertCustomerAccountBasketLine,
} from "@/lib/basket/customer-basket";
import {
  getCustomerMenuPayload,
  publishDraftMenuToLocations,
} from "@/lib/catalogue/menu-publish";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { createAuthenticatedPaymentAttempt } from "@/lib/checkout/checkout-payment-attempt";
import { issueAuthenticatedCheckoutQuote } from "@/lib/checkout/checkout-quote";
import {
  getAuthenticatedPaymentOutcome,
  reconcileLabelledFixturePaymentOutcome,
} from "@/lib/checkout/checkout-payment-outcome";
import { getCustomerAuth } from "@/lib/customer/auth-server";
import {
  ensureQuotesCheckoutTester,
  QUOTES_CHECKOUT_TESTER,
} from "@/lib/seed/quotes-checkout-tester";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import {
  assignPublishedCollection,
  createStorefront,
  publishStorefrontRelease,
  registerStorefrontDomain,
} from "@/lib/storefront/storefronts";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";

const CREDENTIAL_FILES = new Set([
  path.normalize("src/lib/seed/quotes-checkout-tester.ts"),
]);

function sourceFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") {
        continue;
      }
      files.push(...sourceFiles(fullPath));
      continue;
    }

    if (/\.(ts|tsx|js|mjs)$/.test(entry) && !entry.endsWith(".test.ts")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("Quotes checkout tester credentials", () => {
  it("keeps the tester email and password out of application routes", () => {
    const roots = ["src/app", "src/components", "src/lib"].map((dir) =>
      path.join(process.cwd(), dir),
    );
    const offenders: string[] = [];

    for (const root of roots) {
      for (const file of sourceFiles(root)) {
        const relative = path.normalize(path.relative(process.cwd(), file));
        if (CREDENTIAL_FILES.has(relative)) {
          continue;
        }

        const source = readFileSync(file, "utf8");
        if (
          source.includes(QUOTES_CHECKOUT_TESTER.password) ||
          source.includes(QUOTES_CHECKOUT_TESTER.email)
        ) {
          offenders.push(relative);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

function extractSessionCookie(setCookieHeader: string | null) {
  if (!setCookieHeader) {
    return "";
  }

  const match = setCookieHeader.match(/better-auth\.session_token=([^;]+)/);
  return match ? `better-auth.session_token=${match[1]}` : "";
}

async function signInTester(requestPath: string) {
  const auth = getCustomerAuth();
  const response = await auth.api.signInEmail({
    body: {
      email: QUOTES_CHECKOUT_TESTER.email,
      password: QUOTES_CHECKOUT_TESTER.password,
      rememberMe: true,
    },
    asResponse: true,
  });

  if (!response.ok) {
    throw new Error(`Checkout tester sign-in failed with status ${response.status}.`);
  }

  const cookie = extractSessionCookie(response.headers.get("set-cookie"));
  if (!cookie) {
    throw new Error("Checkout tester sign-in did not create a session.");
  }

  return new Request(`http://localhost${requestPath}`, {
    headers: { Cookie: cookie },
  });
}

let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

integrationDescribe("Quotes DEV checkout tester", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = integrationDatabaseUrl;
    process.env.QOS_ENVIRONMENT = "dev";
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-with-enough-length-for-validation";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.CHECKOUT_PAYMENT_RETURN_BASE_URL = "https://quotes.dev.qosapp.com";
    process.env.CHECKOUT_PAYMENT_ALLOWED_RETURN_ORIGINS =
      "https://quotes.dev.qosapp.com,http://localhost:3000";
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_CHECKOUT_SUCCESS_URL;
    delete process.env.STRIPE_CHECKOUT_CANCEL_URL;
    delete process.env.QOS_STOREFRONT_PUBLIC_ID;

    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  });

  afterAll(async () => {
    delete process.env.QOS_ENVIRONMENT;
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.CHECKOUT_PAYMENT_RETURN_BASE_URL;
    delete process.env.CHECKOUT_PAYMENT_ALLOWED_RETURN_ORIGINS;
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.storefront_checkout_provider_events, qos.storefront_checkout_payment_operations, qos.storefront_checkout_payment_attempts, qos.storefront_checkout_quote_operations, qos.storefront_checkout_quotes, qos.storefront_basket_merge_operations, qos.storefront_customer_basket_mutations, qos.storefront_customer_basket_lines, qos.storefront_customer_baskets, qos.storefront_customer_associations, qos.customer_auth_verifications, qos.customer_auth_accounts, qos.customer_auth_sessions, qos.customer_auth_users, qos.staff_auth_verifications, qos.staff_auth_accounts, qos.staff_auth_sessions, qos.staff_auth_users, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedPublishedQuotesMenu() {
    const quotes = await createQuotesTwoLocationTenant(db);

    const [identity] = await db
      .insert(staffIdentities)
      .values({
        providerSubject: "admin.checkout-tester@test",
        email: "admin.checkout-tester@test",
      })
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
      internalName: "checkout-tester-latte",
      translations: {
        en: { displayName: "Checkout Latte", description: "Checkout test item" },
        ar: { displayName: "لاتيه الدفع", description: "عنصر اختبار" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    for (const locale of ["en", "ar"] as const) {
      await approveProductTranslation(
        db,
        quotes.tenant.id,
        "admin.checkout-tester@test",
        latte.publicId,
        locale,
        {
          expectedTranslationVersion: latte.translations[locale].translationVersion,
        },
      );
    }

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "checkout-tester-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Checkout Menu" },
        ar: { displayName: "قائمة الدفع" },
      },
      sections: [
        {
          internalName: "drinks",
          sortOrder: 0,
          translations: {
            en: { displayName: "Drinks" },
            ar: { displayName: "مشروبات" },
          },
          products: [{ productPublicId: latte.publicId, sortOrder: 0 }],
        },
      ],
    });

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.checkout-tester@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Checkout Tester",
      slug: "quotes-checkout-tester",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.locationA.publicId],
    });

    await registerStorefrontDomain(db, quotes.tenant.id, storefront.publicId, {
      hostname: "quotes.dev.qosapp.com",
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
      "admin.checkout-tester@test",
    );

    return { quotes, latte, menu, storefront };
  }

  it("reuses one verified customer and stores a password hash", async () => {
    const seededMenu = await seedPublishedQuotesMenu();
    const env = {
      QOS_ENVIRONMENT: "dev",
      DATABASE_URL: integrationDatabaseUrl,
    };

    const first = await ensureQuotesCheckoutTester(db, {
      env,
      storefrontPublicId: seededMenu.storefront.publicId,
    });
    const second = await ensureQuotesCheckoutTester(db, {
      env,
      storefrontPublicId: seededMenu.storefront.publicId,
    });

    expect(second.userId).toBe(first.userId);
    expect(second.created).toBe(false);
    expect(second).toMatchObject({
      email: QUOTES_CHECKOUT_TESTER.email,
      displayName: QUOTES_CHECKOUT_TESTER.displayName,
      role: "CUSTOMER",
      status: "ACTIVE",
      emailVerified: true,
      associationStatus: "active",
      storefrontPublicId: seededMenu.storefront.publicId,
    });

    const users = await db
      .select()
      .from(customerAuthUsers)
      .where(eq(customerAuthUsers.email, QUOTES_CHECKOUT_TESTER.email));
    const staff = await db
      .select()
      .from(staffAuthUsers)
      .where(eq(staffAuthUsers.email, QUOTES_CHECKOUT_TESTER.email));
    const [credential] = await db
      .select()
      .from(customerAuthAccounts)
      .where(eq(customerAuthAccounts.userId, first.userId));

    expect(users).toHaveLength(1);
    expect(staff).toHaveLength(0);
    expect(credential.providerId).toBe("credential");
    expect(credential.password).not.toBe(QUOTES_CHECKOUT_TESTER.password);
    expect(credential.password?.includes(QUOTES_CHECKOUT_TESTER.password)).toBe(false);
    await expect(
      verifyPassword({
        hash: credential.password ?? "",
        password: QUOTES_CHECKOUT_TESTER.password,
      }),
    ).resolves.toBe(true);

    const request = await signInTester("/api/public/customers/me");
    const session = await getCustomerAuth().api.getSession({
      headers: request.headers,
    });

    expect(session?.user.email).toBe(QUOTES_CHECKOUT_TESTER.email);
    expect(session?.user.emailVerified).toBe(true);
    expect(session?.user.name).toBe(QUOTES_CHECKOUT_TESTER.displayName);
  }, 30_000);

  it("carries the tester through menu, basket, Stripe handoff, and confirmation", async () => {
    const seededMenu = await seedPublishedQuotesMenu();
    await ensureQuotesCheckoutTester(db, {
      env: {
        QOS_ENVIRONMENT: "dev",
        DATABASE_URL: integrationDatabaseUrl,
      },
      storefrontPublicId: seededMenu.storefront.publicId,
    });

    const menuPayload = await getCustomerMenuPayload(
      db,
      seededMenu.quotes.tenant.id,
      seededMenu.menu.publicId,
      seededMenu.quotes.locationA.publicId,
    );

    expect(JSON.stringify(menuPayload)).toContain("Checkout Latte");

    const context = {
      storefrontPublicId: seededMenu.storefront.publicId,
      locationPublicId: seededMenu.quotes.locationA.publicId,
    };
    const firstRequest = await signInTester("/api/baskets/account/current");
    const empty = await getCustomerAccountBasket(db, firstRequest, context);
    const basket = await upsertCustomerAccountBasketLine(db, firstRequest, {
      ...context,
      productPublicId: seededMenu.latte.publicId,
      quantity: 1,
      expectedVersion: empty.version,
    });

    const resumedRequest = await signInTester("/api/baskets/account/current");
    const resumed = await getCustomerAccountBasket(db, resumedRequest, context);
    expect(resumed.lines).toHaveLength(1);
    expect(resumed.lines[0]?.productPublicId).toBe(seededMenu.latte.publicId);

    const quote = await issueAuthenticatedCheckoutQuote(db, resumedRequest, context, {
      expectedBasketVersion: basket.version,
      operationId: "checkout_tester_quote",
    });
    const paymentAttempt = await createAuthenticatedPaymentAttempt(
      db,
      resumedRequest,
      context,
      {
        operationId: "checkout_tester_payment",
        quotePublicId: quote.quotePublicId,
        expectedQuoteVersion: quote.version,
        returnPath: "/checkout/success",
        cancelPath: "/checkout/cancelled",
      },
    );

    expect(paymentAttempt.provider).toBe("stripe");
    expect(paymentAttempt.status).toBe("provider_handoff");
    expect(paymentAttempt.handoff.url).toContain("/checkout/success");

    const [storedAttempt] = await db
      .select()
      .from(storefrontCheckoutPaymentAttempts)
      .where(
        eq(
          storefrontCheckoutPaymentAttempts.publicId,
          paymentAttempt.paymentAttemptPublicId,
        ),
      );

    expect(storedAttempt.returnUrl).toBe(
      "https://quotes.dev.qosapp.com/checkout/success",
    );
    expect(storedAttempt.cancelUrl).toBe(
      "https://quotes.dev.qosapp.com/checkout/cancelled",
    );

    const succeeded = await reconcileLabelledFixturePaymentOutcome(db, {
      tenantId: seededMenu.quotes.tenant.id,
      paymentAttemptPublicId: paymentAttempt.paymentAttemptPublicId,
      outcome: "succeeded",
      fixtureEventId: "evt_checkout_tester_success",
    });
    const confirmation = await getAuthenticatedPaymentOutcome(
      db,
      resumedRequest,
      context,
      paymentAttempt.paymentAttemptPublicId,
    );

    expect(confirmation).toEqual(succeeded);
    expect(confirmation.status).toBe("succeeded");
    expect(confirmation.totalMinor).toBe(quote.totalMinor);
    expect(confirmation.lines).toHaveLength(1);

    const basketAfterSuccess = await getCustomerAccountBasket(
      db,
      resumedRequest,
      context,
    );
    const cancelledQuote = await issueAuthenticatedCheckoutQuote(
      db,
      resumedRequest,
      context,
      {
        expectedBasketVersion: basketAfterSuccess.version,
        operationId: "checkout_tester_cancel_quote",
      },
    );
    const cancelledAttempt = await createAuthenticatedPaymentAttempt(
      db,
      resumedRequest,
      context,
      {
        operationId: "checkout_tester_cancel_payment",
        quotePublicId: cancelledQuote.quotePublicId,
        expectedQuoteVersion: cancelledQuote.version,
        returnPath: "/checkout/success",
        cancelPath: "/checkout/cancelled",
      },
    );
    const cancelled = await reconcileLabelledFixturePaymentOutcome(db, {
      tenantId: seededMenu.quotes.tenant.id,
      paymentAttemptPublicId: cancelledAttempt.paymentAttemptPublicId,
      outcome: "cancelled",
      fixtureEventId: "evt_checkout_tester_cancel",
    });
    const cancelledConfirmation = await getAuthenticatedPaymentOutcome(
      db,
      resumedRequest,
      context,
      cancelledAttempt.paymentAttemptPublicId,
    );

    expect(cancelledConfirmation).toEqual(cancelled);
    expect(cancelledConfirmation.status).toBe("cancelled");
  }, 30_000);
});
