import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  customerAuthUsers,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontCustomerAssociations,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  integrationDatabaseUrl,
  resetAndMigrate,
} from "@/db/test-utils";
import { rejectAnonymousCheckoutQuote } from "@/lib/basket/anonymous-basket";
import { createAnonymousBasket } from "@/lib/basket/anonymous-basket";
import { getCustomerAuth } from "@/lib/customer/auth-server";
import { getCurrentStorefrontCustomer } from "@/lib/customer/association";
import {
  assertTrustedCustomerReturnUrl,
  CustomerReturnUrlError,
} from "@/lib/customer/return-url";
import {
  getCustomerSessionFromRequest,
  requireVerifiedCustomerSession,
} from "@/lib/customer/session";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import {
  assignPublishedCollection,
  createStorefront,
  publishStorefrontRelease,
  registerStorefrontDomain,
} from "@/lib/storefront/storefronts";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

function extractSessionCookie(setCookieHeader: string | null) {
  if (!setCookieHeader) {
    return "";
  }

  const match = setCookieHeader.match(/better-auth\.session_token=([^;]+)/);
  return match ? `better-auth.session_token=${match[1]}` : "";
}

async function registerCustomer(input: {
  email: string;
  password: string;
  name: string;
  verify?: boolean;
}) {
  const auth = getCustomerAuth();
  await auth.api.signUpEmail({
    body: {
      email: input.email,
      password: input.password,
      name: input.name,
    },
  });

  if (input.verify !== false) {
    await db
      .update(customerAuthUsers)
      .set({ emailVerified: true })
      .where(eq(customerAuthUsers.email, input.email));
  }
}

async function signInCustomer(email: string, password: string) {
  const auth = getCustomerAuth();
  const response = await auth.api.signInEmail({
    body: {
      email,
      password,
      rememberMe: true,
    },
    asResponse: true,
  });

  const cookie = extractSessionCookie(response.headers.get("set-cookie"));
  return new Request("http://localhost/api/public/customers/me", {
    headers: { Cookie: cookie },
  });
}

let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

integrationDescribe("storefront customer authentication", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = integrationDatabaseUrl;
    process.env.BETTER_AUTH_SECRET =
      "test-better-auth-secret-with-enough-length-for-validation";
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.CUSTOMER_AUTH_TRUSTED_RETURN_ORIGINS =
      "http://localhost:3000,https://quotes.dev.qosapp.com";

    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  });

  afterAll(async () => {
    delete process.env.BETTER_AUTH_SECRET;
    delete process.env.BETTER_AUTH_URL;
    delete process.env.CUSTOMER_AUTH_TRUSTED_RETURN_ORIGINS;
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.storefront_customer_associations, qos.customer_auth_verifications, qos.customer_auth_accounts, qos.customer_auth_sessions, qos.customer_auth_users, qos.storefront_anonymous_basket_mutations, qos.storefront_anonymous_basket_lines, qos.storefront_anonymous_baskets, qos.storefront_anonymous_sessions, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedStorefrontHost(options: {
    hostname: string;
    slug: string;
    fixture?: "quotes" | "flowers";
  }) {
    const tenant =
      options.fixture === "flowers"
        ? await createTenantHierarchy(db, flowerTenantFixture())
        : await createQuotesTwoLocationTenant(db);

    const primaryLocationPublicId =
      "locationA" in tenant
        ? (tenant as Awaited<ReturnType<typeof createQuotesTwoLocationTenant>>)
            .locationA.publicId
        : tenant.location.publicId;

    const storefront = await createStorefront(db, tenant.tenant.id, {
      brandPublicId: tenant.brand.publicId,
      internalName: `${tenant.brand.name} Website`,
      slug: options.slug,
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [primaryLocationPublicId],
    });

    await registerStorefrontDomain(db, tenant.tenant.id, storefront.publicId, {
      hostname: options.hostname,
      domainType: "platform_subdomain",
      lifecycleStatus: "active",
      isPrimary: true,
    });

    await publishStorefrontRelease(
      db,
      tenant.tenant.id,
      storefront.publicId,
      "admin@test",
    );

    return { tenant, storefront, primaryLocationPublicId };
  }

  async function seedPublishedMenuForStorefront(
    seeded: Awaited<ReturnType<typeof seedStorefrontHost>>,
  ) {
    const tenantId = seeded.tenant.tenant.id;
    const locationId =
      "locationA" in seeded.tenant
        ? (seeded.tenant as Awaited<ReturnType<typeof createQuotesTwoLocationTenant>>)
            .locationA.id
        : seeded.tenant.location.id;

    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin.customer-auth@test", email: "admin.customer-auth@test" })
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

    const admin = {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };

    const product = await createDraftProduct(db, tenantId, admin, {
      internalName: "checkout-latte",
      translations: {
        en: { displayName: "Latte", description: "Coffee" },
        ar: { displayName: "لاتيه", description: "قهوة" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    const menu = await createDraftMenu(db, tenantId, admin, {
      internalName: "checkout-menu",
      locationIds: [locationId],
      translations: {
        en: { displayName: "Checkout Menu" },
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
      tenantId,
      "admin.customer-auth@test",
      product.publicId,
      "en",
      { expectedTranslationVersion: product.translations.en.translationVersion },
    );
    await approveProductTranslation(
      db,
      tenantId,
      "admin.customer-auth@test",
      product.publicId,
      "ar",
      { expectedTranslationVersion: product.translations.ar.translationVersion },
    );

    await publishDraftMenuToLocations(db, tenantId, "admin.customer-auth@test", menu.publicId, {
      locationIds: [locationId],
    });

    await assignPublishedCollection(
      db,
      tenantId,
      seeded.storefront.publicId,
      seeded.primaryLocationPublicId,
      menu.publicId,
    );
  }

  it("registers a customer without creating staff membership", async () => {
    await seedStorefrontHost({
      hostname: "quotes.dev.qosapp.com",
      slug: "quotes",
    });

    await registerCustomer({
      email: "guest@example.com",
      password: "Password123!",
      name: "Guest User",
    });

    const staffCount = await db.select().from(staffIdentities);
    const membershipCount = await db.select().from(staffMemberships);

    expect(staffCount).toHaveLength(0);
    expect(membershipCount).toHaveLength(0);
  });

  it("requires verified email before checkout and storefront profile lookup", async () => {
    const seeded = await seedStorefrontHost({
      hostname: "quotes.dev.qosapp.com",
      slug: "quotes",
    });
    await seedPublishedMenuForStorefront(seeded);

    await registerCustomer({
      email: "unverified@example.com",
      password: "Password123!",
      name: "Unverified User",
    });

    const unverifiedRequest = await signInCustomer(
      "unverified@example.com",
      "Password123!",
    );

    await db
      .update(customerAuthUsers)
      .set({ emailVerified: false })
      .where(eq(customerAuthUsers.email, "unverified@example.com"));

    await expect(requireVerifiedCustomerSession(unverifiedRequest)).rejects.toMatchObject({
      statusCode: 401,
      field: "emailVerified",
    });

    const basket = await createAnonymousBasket(db, {
      storefrontPublicId: seeded.storefront.publicId,
      locationPublicId: seeded.primaryLocationPublicId,
    });

    await expect(
      rejectAnonymousCheckoutQuote(db, basket.sessionToken, unverifiedRequest),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it("binds a verified customer to the storefront host and allows checkout auth gate", async () => {
    const seeded = await seedStorefrontHost({
      hostname: "quotes.dev.qosapp.com",
      slug: "quotes",
    });
    await seedPublishedMenuForStorefront(seeded);

    await registerCustomer({
      email: "verified@example.com",
      password: "Password123!",
      name: "Verified User",
    });

    const request = await signInCustomer("verified@example.com", "Password123!");
    const session = await requireVerifiedCustomerSession(request);
    expect(session.user.emailVerified).toBe(true);

    const profile = await getCurrentStorefrontCustomer(db, {
      hostname: "quotes.dev.qosapp.com",
      customerUserId: session.user.id,
      email: session.user.email,
      name: session.user.name,
      emailVerified: session.user.emailVerified,
    });

    expect(profile.storefrontPublicId).toBe(seeded.storefront.publicId);
    expect(profile.tenantPublicId).toBe(seeded.tenant.tenant.publicId);

    const associations = await db.select().from(storefrontCustomerAssociations);
    expect(associations).toHaveLength(1);

    const basket = await createAnonymousBasket(db, {
      storefrontPublicId: seeded.storefront.publicId,
      locationPublicId: seeded.primaryLocationPublicId,
    });

    await expect(
      rejectAnonymousCheckoutQuote(db, basket.sessionToken, request),
    ).resolves.toBeUndefined();
  });

  it("does not expose another customer's session on a different storefront host", async () => {
    await seedStorefrontHost({
      hostname: "quotes.dev.qosapp.com",
      slug: "quotes",
    });
    await seedStorefrontHost({
      hostname: "flowers.dev.qosapp.com",
      slug: "flowers",
      fixture: "flowers",
    });

    await registerCustomer({
      email: "customer-a@example.com",
      password: "Password123!",
      name: "Customer A",
    });

    const request = await signInCustomer("customer-a@example.com", "Password123!");
    const session = await getCustomerSessionFromRequest(request);
    expect(session?.user.email).toBe("customer-a@example.com");

    const quotesProfile = await getCurrentStorefrontCustomer(db, {
      hostname: "quotes.dev.qosapp.com",
      customerUserId: session!.user.id,
      email: session!.user.email,
      name: session!.user.name,
      emailVerified: session!.user.emailVerified,
    });

    const flowersProfile = await getCurrentStorefrontCustomer(db, {
      hostname: "flowers.dev.qosapp.com",
      customerUserId: session!.user.id,
      email: session!.user.email,
      name: session!.user.name,
      emailVerified: session!.user.emailVerified,
    });

    expect(quotesProfile.tenantPublicId).not.toBe(flowersProfile.tenantPublicId);
  });

  it("rejects hostile return URLs outside the trusted origin list", () => {
    expect(() =>
      assertTrustedCustomerReturnUrl("https://evil.example/return"),
    ).toThrow(CustomerReturnUrlError);

    expect(
      assertTrustedCustomerReturnUrl("https://quotes.dev.qosapp.com/checkout"),
    ).toBe("https://quotes.dev.qosapp.com/checkout");
  });
});
