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
import { getCustomerAuth } from "@/lib/customer/auth-server";
import {
  getCustomerAccountBasket,
  upsertCustomerAccountBasketLine,
} from "@/lib/basket/customer-basket";
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
  return new Request("http://localhost/api/public/baskets/account/current", {
    headers: { Cookie: cookie },
  });
}

let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

integrationDescribe("customer account basket", () => {
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
    await sqlClient`TRUNCATE TABLE qos.storefront_customer_basket_mutations, qos.storefront_customer_basket_lines, qos.storefront_customer_baskets, qos.storefront_customer_associations, qos.customer_auth_verifications, qos.customer_auth_accounts, qos.customer_auth_sessions, qos.customer_auth_users, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedPublishedStorefrontMenu() {
    const quotes = await createQuotesTwoLocationTenant(db);

    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin.basket@test", email: "admin.basket@test" })
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

    const product = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "account-latte",
      translations: {
        en: { displayName: "Account Latte", description: "Coffee" },
        ar: { displayName: "لاتيه", description: "قهوة" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "account-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Account Menu" },
        ar: { displayName: "قائمة" },
      },
      sections: [
        {
          internalName: "drinks",
          sortOrder: 0,
          translations: {
            en: { displayName: "Drinks" },
            ar: { displayName: "مشروبات" },
          },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    await approveProductTranslation(
      db,
      quotes.tenant.id,
      "admin.basket@test",
      product.publicId,
      "en",
      { expectedTranslationVersion: product.translations.en.translationVersion },
    );
    await approveProductTranslation(
      db,
      quotes.tenant.id,
      "admin.basket@test",
      product.publicId,
      "ar",
      { expectedTranslationVersion: product.translations.ar.translationVersion },
    );

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.basket@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Account Basket Storefront",
      slug: "account-basket",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.locationA.publicId],
    });

    await registerStorefrontDomain(db, quotes.tenant.id, storefront.publicId, {
      hostname: "account.dev.qosapp.com",
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
      "admin.basket@test",
    );

    return { quotes, product, storefront };
  }

  it("recovers the same account basket on another device after sign-in", async () => {
    const { quotes, product, storefront } = await seedPublishedStorefrontMenu();

    await registerCustomer("customer-a@example.com", "Password123!", "Customer A");

    const deviceOne = await signInCustomer("customer-a@example.com", "Password123!");
    const context = {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    };

    const empty = await getCustomerAccountBasket(db, deviceOne, context);
    expect(empty.ownership).toBe("account");
    expect(empty.lines).toEqual([]);

    const withLine = await upsertCustomerAccountBasketLine(db, deviceOne, {
      ...context,
      productPublicId: product.publicId,
      quantity: 2,
      expectedVersion: empty.version,
      mutationId: "acct_mut_1",
    });

    expect(withLine.lines).toHaveLength(1);
    expect(withLine.lines[0]?.quantity).toBe(2);

    const deviceTwo = await signInCustomer("customer-a@example.com", "Password123!");
    const recovered = await getCustomerAccountBasket(db, deviceTwo, context);

    expect(recovered.basketPublicId).toBe(withLine.basketPublicId);
    expect(recovered.version).toBe(withLine.version);
    expect(recovered.lines).toEqual(withLine.lines);
  });

  it("does not expose one customer's basket to another customer", async () => {
    const { quotes, product, storefront } = await seedPublishedStorefrontMenu();
    const context = {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    };

    await registerCustomer("owner@example.com", "Password123!", "Owner");
    await registerCustomer("intruder@example.com", "Password123!", "Intruder");

    const ownerRequest = await signInCustomer("owner@example.com", "Password123!");
    const created = await upsertCustomerAccountBasketLine(db, ownerRequest, {
      ...context,
      productPublicId: product.publicId,
      quantity: 1,
      expectedVersion: 1,
    });

    const intruderRequest = await signInCustomer(
      "intruder@example.com",
      "Password123!",
    );
    const intruderBasket = await getCustomerAccountBasket(
      db,
      intruderRequest,
      context,
    );

    expect(intruderBasket.basketPublicId).not.toBe(created.basketPublicId);
    expect(intruderBasket.lines).toEqual([]);
  });

  it("returns a version conflict for stale expectedVersion writes", async () => {
    const { quotes, product, storefront } = await seedPublishedStorefrontMenu();
    const context = {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    };

    await registerCustomer("version@example.com", "Password123!", "Version User");
    const request = await signInCustomer("version@example.com", "Password123!");

    const initial = await getCustomerAccountBasket(db, request, context);

    await upsertCustomerAccountBasketLine(db, request, {
      ...context,
      productPublicId: product.publicId,
      quantity: 1,
      expectedVersion: initial.version,
    });

    await expect(
      upsertCustomerAccountBasketLine(db, request, {
        ...context,
        productPublicId: product.publicId,
        quantity: 3,
        expectedVersion: initial.version,
      }),
    ).rejects.toMatchObject({ statusCode: 409, field: "expectedVersion" });
  });

  it("replays idempotent mutations without duplicating lines", async () => {
    const { quotes, product, storefront } = await seedPublishedStorefrontMenu();
    const context = {
      storefrontPublicId: storefront.publicId,
      locationPublicId: quotes.locationA.publicId,
    };

    await registerCustomer("retry@example.com", "Password123!", "Retry User");
    const request = await signInCustomer("retry@example.com", "Password123!");
    const initial = await getCustomerAccountBasket(db, request, context);

    const first = await upsertCustomerAccountBasketLine(db, request, {
      ...context,
      productPublicId: product.publicId,
      quantity: 2,
      expectedVersion: initial.version,
      mutationId: "acct_retry_1",
    });

    const second = await upsertCustomerAccountBasketLine(db, request, {
      ...context,
      productPublicId: product.publicId,
      quantity: 99,
      expectedVersion: initial.version,
      mutationId: "acct_retry_1",
    });

    expect(second).toEqual(first);
  });
});
