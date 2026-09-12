import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  storefrontDomains,
  storefrontReleases,
  storefronts,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import {
  createStorefront,
  publishStorefrontRelease,
  registerStorefrontDomain,
  StorefrontConflictError,
  updateStorefrontDraft,
} from "@/lib/storefront/storefronts";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import {
  flowerTenantFixture,
  quotesTenantFixture,
} from "@/lib/tenant/fixtures";
import { withTenantContext } from "@/lib/tenant/context";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("storefront entities", () => {
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
    await sqlClient`TRUNCATE TABLE qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  it("creates Quotes and flower storefronts through the same schema", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    const quotesStorefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      locationPublicIds: [quotes.location.publicId],
    });

    const flowerStorefront = await createStorefront(db, flowers.tenant.id, {
      brandPublicId: flowers.brand.publicId,
      internalName: "Flower Shop",
      slug: "flowers",
      defaultLocale: "en",
      supportedLocales: ["en"],
      locationPublicIds: [flowers.location.publicId],
    });

    expect(quotesStorefront.publicId.startsWith("stf_")).toBe(true);
    expect(flowerStorefront.publicId.startsWith("stf_")).toBe(true);
    expect(quotesStorefront.tenantId).not.toBe(flowerStorefront.tenantId);
  });

  it("supports multiple storefronts for the same brand", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());

    const primary = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Primary",
      slug: "quotes-primary",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
    });

    const secondary = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Events",
      slug: "quotes-events",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
    });

    expect(primary.brandId).toBe(secondary.brandId);
    expect(primary.publicId).not.toBe(secondary.publicId);
  });

  it("rejects foreign-tenant location assignment at the database boundary", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
    });

    await expect(
      withTenantContext(db, quotes.tenant.id, async (tx) =>
        tx.insert(storefronts).values({
          tenantId: quotes.tenant.id,
          brandId: flowers.brand.id,
          publicId: "stf_cross_tenant",
          internalName: "Invalid",
          slug: "invalid",
          defaultLocale: "en",
          supportedLocales: ["en"],
        }),
      ),
    ).rejects.toThrow();
  });

  it("keeps published releases immutable when the draft changes", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      draftConfig: {
        theme: { primaryColor: "#111111" },
      },
      locationPublicIds: [quotes.location.publicId],
    });

    const firstRelease = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      "admin@test",
    );

    await updateStorefrontDraft(db, quotes.tenant.id, storefront.publicId, {
      expectedVersion: 1,
      draftConfig: {
        theme: { primaryColor: "#222222" },
      },
    });

    const secondRelease = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      "admin@test",
    );

    const [originalRelease] = await db
      .select()
      .from(storefrontReleases)
      .where(eq(storefrontReleases.id, firstRelease.id));

    expect(originalRelease?.payload.theme).toEqual({ primaryColor: "#111111" });
    expect(secondRelease.releaseVersion).toBe(2);
    expect(secondRelease.payload.theme).toEqual({ primaryColor: "#222222" });
  });

  it("rejects duplicate hostnames and stale draft versions", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());

    const quotesStorefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
    });

    const flowerStorefront = await createStorefront(db, flowers.tenant.id, {
      brandPublicId: flowers.brand.publicId,
      internalName: "Flower Shop",
      slug: "flowers",
      defaultLocale: "en",
      supportedLocales: ["en"],
    });

    await registerStorefrontDomain(
      db,
      quotes.tenant.id,
      quotesStorefront.publicId,
      {
        hostname: "quotes.dev.qosapp.com",
        domainType: "platform_subdomain",
      },
    );

    await expect(
      registerStorefrontDomain(db, flowers.tenant.id, flowerStorefront.publicId, {
        hostname: "quotes.dev.qosapp.com",
        domainType: "platform_subdomain",
      }),
    ).rejects.toBeInstanceOf(StorefrontConflictError);

    await expect(
      updateStorefrontDraft(db, quotes.tenant.id, quotesStorefront.publicId, {
        expectedVersion: 99,
        internalName: "Stale",
      }),
    ).rejects.toBeInstanceOf(StorefrontConflictError);

    const domains = await db.select().from(storefrontDomains);
    expect(domains).toHaveLength(1);
  });
});
