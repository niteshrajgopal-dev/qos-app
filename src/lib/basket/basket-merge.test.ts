import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  customerAuthUsers,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontCustomerBaskets,
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
  createAnonymousBasket,
  getAnonymousBasket,
  upsertAnonymousBasketLine,
} from "@/lib/basket/anonymous-basket";
import {
  buildBasketMergePayloadHash,
  commitBasketMerge,
  previewBasketMerge,
} from "@/lib/basket/basket-merge";
import {
  getCustomerAccountBasket,
  upsertCustomerAccountBasketLine,
} from "@/lib/basket/customer-basket";
import { AnonymousBasketAuthError } from "@/lib/basket/session-cookies";
import { getCustomerAuth } from "@/lib/customer/auth-server";
import { CustomerAuthError } from "@/lib/customer/session";
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
  return new Request("http://localhost/api/public/baskets/merge/preview", {
    headers: { Cookie: cookie },
  });
}

function buildMergeRequest(
  customerRequest: Request,
  sessionToken: string,
  csrfToken: string,
) {
  const customerCookie = customerRequest.headers.get("cookie") ?? "";
  return new Request("http://localhost/api/public/baskets/merge/preview", {
    method: "POST",
    headers: {
      Cookie: `${customerCookie}; qos_anon_session=${encodeURIComponent(sessionToken)}; qos_anon_csrf=${encodeURIComponent(csrfToken)}`,
    },
  });
}

function buildMergeCommitRequest(
  customerRequest: Request,
  sessionToken: string,
  csrfToken: string,
  body: Record<string, unknown>,
) {
  const customerCookie = customerRequest.headers.get("cookie") ?? "";
  return new Request("http://localhost/api/public/baskets/merge/commit", {
    method: "POST",
    headers: {
      Cookie: `${customerCookie}; qos_anon_session=${encodeURIComponent(sessionToken)}; qos_anon_csrf=${encodeURIComponent(csrfToken)}`,
      "X-QOS-CSRF-Token": csrfToken,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

integrationDescribe("anonymous-to-account basket merge", () => {
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
    await sqlClient`TRUNCATE TABLE qos.storefront_basket_merge_operations, qos.storefront_anonymous_basket_mutations, qos.storefront_anonymous_basket_lines, qos.storefront_anonymous_baskets, qos.storefront_anonymous_sessions, qos.storefront_customer_basket_mutations, qos.storefront_customer_basket_lines, qos.storefront_customer_baskets, qos.storefront_customer_associations, qos.customer_auth_verifications, qos.customer_auth_accounts, qos.customer_auth_sessions, qos.customer_auth_users, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedPublishedStorefrontMenu() {
    const quotes = await createQuotesTwoLocationTenant(db);

    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "admin.merge@test", email: "admin.merge@test" })
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
      internalName: "merge-latte",
      translations: {
        en: { displayName: "Merge Latte", description: "Coffee" },
        ar: { displayName: "لاتيه", description: "قهوة" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    const menu = await createDraftMenu(db, quotes.tenant.id, admin, {
      internalName: "merge-menu",
      locationIds: [quotes.locationA.id],
      translations: {
        en: { displayName: "Merge Menu" },
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
      "admin.merge@test",
      product.publicId,
      "en",
      { expectedTranslationVersion: product.translations.en.translationVersion },
    );
    await approveProductTranslation(
      db,
      quotes.tenant.id,
      "admin.merge@test",
      product.publicId,
      "ar",
      { expectedTranslationVersion: product.translations.ar.translationVersion },
    );

    await publishDraftMenuToLocations(
      db,
      quotes.tenant.id,
      "admin.merge@test",
      menu.publicId,
      { locationIds: [quotes.locationA.id] },
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Merge Storefront",
      slug: "merge-basket",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.locationA.publicId],
    });

    await registerStorefrontDomain(db, quotes.tenant.id, storefront.publicId, {
      hostname: "merge.dev.qosapp.com",
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
      "admin.merge@test",
    );

    return { quotes, product, storefront };
  }

  async function seedSignedInMergeScenario() {
    const seeded = await seedPublishedStorefrontMenu();
    const context = {
      storefrontPublicId: seeded.storefront.publicId,
      locationPublicId: seeded.quotes.locationA.publicId,
    };

    const anon = await createAnonymousBasket(db, {
      ...context,
      locale: "en",
    });

    const anonRequest = new Request("http://localhost/api/public/baskets/current/lines", {
      method: "POST",
      headers: {
        Cookie: `qos_anon_session=${encodeURIComponent(anon.sessionToken)}; qos_anon_csrf=${encodeURIComponent(anon.csrfToken)}`,
        "X-QOS-CSRF-Token": anon.csrfToken,
      },
    });

    const anonymousBasket = await upsertAnonymousBasketLine(
      db,
      anonRequest,
      anon.sessionToken,
      {
        productPublicId: seeded.product.publicId,
        quantity: 2,
        expectedVersion: anon.basket.version,
      },
    );

    await registerCustomer("merge@example.com", "Password123!", "Merge User");
    const customerRequest = await signInCustomer("merge@example.com", "Password123!");

    const accountBasket = await getCustomerAccountBasket(db, customerRequest, context);
    const withAccountLine = await upsertCustomerAccountBasketLine(db, customerRequest, {
      ...context,
      productPublicId: seeded.product.publicId,
      quantity: 1,
      expectedVersion: accountBasket.version,
    });

    return {
      ...seeded,
      context,
      anon,
      anonymousBasket,
      customerRequest,
      accountBasket: withAccountLine,
    };
  }

  it("previews both owned baskets and proposed merge outcome", async () => {
    const {
      anon,
      anonymousBasket,
      accountBasket,
      customerRequest,
    } = await seedSignedInMergeScenario();

    const preview = await previewBasketMerge(
      db,
      buildMergeRequest(customerRequest, anon.sessionToken, anon.csrfToken),
      anon.sessionToken,
    );

    expect(preview.anonymousBasket.basketPublicId).toBe(anonymousBasket.basketPublicId);
    expect(preview.accountBasket.basketPublicId).toBe(accountBasket.basketPublicId);
    expect(preview.proposedOutcomes.merge.lines[0]?.quantity).toBe(3);
    expect(preview.decisionPayloadHashes.merge).toBe(
      buildBasketMergePayloadHash({
        decision: "merge",
        anonymousBasketPublicId: anonymousBasket.basketPublicId,
        accountBasketPublicId: accountBasket.basketPublicId,
        anonymousVersion: anonymousBasket.version,
        accountVersion: accountBasket.version,
      }),
    );
  });

  it("commits a merge decision and retires the anonymous basket", async () => {
    const {
      anon,
      anonymousBasket,
      accountBasket,
      customerRequest,
      context,
    } = await seedSignedInMergeScenario();

    const preview = await previewBasketMerge(
      db,
      buildMergeRequest(customerRequest, anon.sessionToken, anon.csrfToken),
      anon.sessionToken,
    );

    const commitRequest = buildMergeCommitRequest(
      customerRequest,
      anon.sessionToken,
      anon.csrfToken,
      {
        decision: "merge",
        operationId: "merge_op_1",
        payloadHash: preview.decisionPayloadHashes.merge,
        anonymousExpectedVersion: anonymousBasket.version,
        accountExpectedVersion: accountBasket.version,
      },
    );

    const committed = await commitBasketMerge(db, commitRequest, anon.sessionToken, {
      decision: "merge",
      operationId: "merge_op_1",
      payloadHash: preview.decisionPayloadHashes.merge,
      anonymousExpectedVersion: anonymousBasket.version,
      accountExpectedVersion: accountBasket.version,
    });

    expect(committed.anonymousBasketRetired).toBe(true);
    expect(committed.accountBasket.lines[0]?.quantity).toBe(3);
    expect(committed.accountBasket.version).toBe(accountBasket.version + 1);

    await expect(getAnonymousBasket(db, anon.sessionToken)).rejects.toMatchObject({
      statusCode: 410,
    });

    const reloadedAccount = await getCustomerAccountBasket(db, customerRequest, context);
    expect(reloadedAccount.lines[0]?.quantity).toBe(3);
  });

  it("keeps the account basket unchanged when keep_account is chosen", async () => {
    const {
      anon,
      anonymousBasket,
      accountBasket,
      customerRequest,
      context,
    } = await seedSignedInMergeScenario();

    const preview = await previewBasketMerge(
      db,
      buildMergeRequest(customerRequest, anon.sessionToken, anon.csrfToken),
      anon.sessionToken,
    );

    const commitRequest = buildMergeCommitRequest(
      customerRequest,
      anon.sessionToken,
      anon.csrfToken,
      {
        decision: "keep_account",
        operationId: "merge_keep_1",
        payloadHash: preview.decisionPayloadHashes.keep_account,
        anonymousExpectedVersion: anonymousBasket.version,
        accountExpectedVersion: accountBasket.version,
      },
    );

    const committed = await commitBasketMerge(db, commitRequest, anon.sessionToken, {
      decision: "keep_account",
      operationId: "merge_keep_1",
      payloadHash: preview.decisionPayloadHashes.keep_account,
      anonymousExpectedVersion: anonymousBasket.version,
      accountExpectedVersion: accountBasket.version,
    });

    expect(committed.accountBasket.lines[0]?.quantity).toBe(1);
    expect(committed.accountBasket.version).toBe(accountBasket.version);

    const reloadedAccount = await getCustomerAccountBasket(db, customerRequest, context);
    expect(reloadedAccount.lines[0]?.quantity).toBe(1);
  });

  it("returns version conflicts for stale merge commits", async () => {
    const {
      anon,
      anonymousBasket,
      accountBasket,
      customerRequest,
      context,
      product,
    } = await seedSignedInMergeScenario();

    const preview = await previewBasketMerge(
      db,
      buildMergeRequest(customerRequest, anon.sessionToken, anon.csrfToken),
      anon.sessionToken,
    );

    await upsertCustomerAccountBasketLine(db, customerRequest, {
      ...context,
      productPublicId: product.publicId,
      quantity: 4,
      expectedVersion: accountBasket.version,
    });

    const commitRequest = buildMergeCommitRequest(
      customerRequest,
      anon.sessionToken,
      anon.csrfToken,
      {
        decision: "merge",
        operationId: "merge_stale_1",
        payloadHash: preview.decisionPayloadHashes.merge,
        anonymousExpectedVersion: anonymousBasket.version,
        accountExpectedVersion: accountBasket.version,
      },
    );

    await expect(
      commitBasketMerge(db, commitRequest, anon.sessionToken, {
        decision: "merge",
        operationId: "merge_stale_1",
        payloadHash: preview.decisionPayloadHashes.merge,
        anonymousExpectedVersion: anonymousBasket.version,
        accountExpectedVersion: accountBasket.version,
      }),
    ).rejects.toMatchObject({ statusCode: 409, field: "accountExpectedVersion" });
  });

  it("replays the same merge operation idempotently", async () => {
    const {
      anon,
      anonymousBasket,
      accountBasket,
      customerRequest,
      context,
      storefront,
      quotes,
    } = await seedSignedInMergeScenario();

    const preview = await previewBasketMerge(
      db,
      buildMergeRequest(customerRequest, anon.sessionToken, anon.csrfToken),
      anon.sessionToken,
    );

    const payload = {
      decision: "merge",
      operationId: "merge_retry_1",
      payloadHash: preview.decisionPayloadHashes.merge,
      anonymousExpectedVersion: anonymousBasket.version,
      accountExpectedVersion: accountBasket.version,
    };

    const commitRequest = buildMergeCommitRequest(
      customerRequest,
      anon.sessionToken,
      anon.csrfToken,
      payload,
    );

    const first = await commitBasketMerge(db, commitRequest, anon.sessionToken, payload);

    const replayRequest = new Request(
      `http://localhost/api/public/baskets/merge/commit?storefrontPublicId=${encodeURIComponent(storefront.publicId)}&locationPublicId=${encodeURIComponent(quotes.locationA.publicId)}`,
      {
        method: "POST",
        headers: customerRequest.headers,
        body: JSON.stringify(payload),
      },
    );

    const second = await commitBasketMerge(
      db,
      replayRequest,
      anon.sessionToken,
      payload,
      context,
    );

    expect(second).toEqual(first);
  });

  it("requires both anonymous and verified customer sessions", async () => {
    const { anon, customerRequest } = await seedSignedInMergeScenario();

    await expect(
      previewBasketMerge(db, customerRequest, null),
    ).rejects.toBeInstanceOf(AnonymousBasketAuthError);

    await expect(
      previewBasketMerge(
        db,
        buildMergeRequest(
          new Request("http://localhost"),
          anon.sessionToken,
          anon.csrfToken,
        ),
        anon.sessionToken,
      ),
    ).rejects.toBeInstanceOf(CustomerAuthError);
  });

  it("rejects cross-currency merge contexts", async () => {
    const {
      anon,
      accountBasket,
      customerRequest,
    } = await seedSignedInMergeScenario();

    await db
      .update(storefrontCustomerBaskets)
      .set({ currency: "USD" })
      .where(eq(storefrontCustomerBaskets.publicId, accountBasket.basketPublicId));

    await expect(
      previewBasketMerge(
        db,
        buildMergeRequest(customerRequest, anon.sessionToken, anon.csrfToken),
        anon.sessionToken,
      ),
    ).rejects.toMatchObject({ statusCode: 409, field: "context" });
  });
});
