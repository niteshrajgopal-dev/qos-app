import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { storefrontReleases } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import {
  StorefrontManifestContractError,
  assertStorefrontManifestIsAllowlisted,
} from "@/lib/storefront/storefront-manifest-contract";
import {
  resolveStorefrontManifestByHostname,
  resolveStorefrontManifestByPublicId,
  StorefrontManifestResolverError,
} from "@/lib/storefront/storefront-manifest-resolver";
import {
  createStorefront,
  publishStorefrontRelease,
  registerStorefrontDomain,
  updateStorefrontDraft,
} from "@/lib/storefront/storefronts";
import type { CreateTenantHierarchyInput } from "@/lib/tenant/types";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import {
  flowerTenantFixture,
  quotesTenantFixture,
} from "@/lib/tenant/fixtures";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("storefront manifest resolver", () => {
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

  async function seedPublishedStorefront(options: {
    tenantFixture: CreateTenantHierarchyInput;
    slug: string;
    hostname: string;
    businessProfile: "hospitality" | "generic_retail";
  }) {
    const tenant = await createTenantHierarchy(db, options.tenantFixture);

    const storefront = await createStorefront(db, tenant.tenant.id, {
      brandPublicId: tenant.brand.publicId,
      internalName: `${tenant.brand.name} Website`,
      slug: options.slug,
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      draftConfig: defaultStorefrontDraftConfig(options.businessProfile),
      locationPublicIds: [tenant.location.publicId],
    });

    await registerStorefrontDomain(db, tenant.tenant.id, storefront.publicId, {
      hostname: options.hostname,
      domainType: "platform_subdomain",
      lifecycleStatus: "provisioning",
      isPrimary: true,
    });

    const release = await publishStorefrontRelease(
      db,
      tenant.tenant.id,
      storefront.publicId,
      "admin@test",
    );

    return { tenant, storefront, release };
  }

  it("returns profile-specific manifests for Quotes and flower tenants", async () => {
    const quotes = await seedPublishedStorefront({
      tenantFixture: quotesTenantFixture(),
      slug: "quotes",
      hostname: "quotes.dev.qosapp.com",
      businessProfile: "hospitality",
    });
    const flowers = await seedPublishedStorefront({
      tenantFixture: flowerTenantFixture(),
      slug: "flowers",
      hostname: "flowers.dev.qosapp.com",
      businessProfile: "generic_retail",
    });

    const quotesManifest = await resolveStorefrontManifestByHostname(
      db,
      "quotes.dev.qosapp.com",
      "1",
    );
    const flowerManifest = await resolveStorefrontManifestByHostname(
      db,
      "flowers.dev.qosapp.com",
      "1",
    );

    expect(quotesManifest.theme).toMatchObject({
      preset: "hospitality_baseline",
    });
    expect(flowerManifest.theme).toMatchObject({
      preset: "generic_retail_baseline",
    });
    expect(quotesManifest.tenantPublicId).not.toBe(flowerManifest.tenantPublicId);
    expect(() =>
      assertStorefrontManifestIsAllowlisted(quotesManifest),
    ).not.toThrow();
  });

  it("serves the latest release without mutating prior release snapshots", async () => {
    const quotes = await seedPublishedStorefront({
      tenantFixture: quotesTenantFixture(),
      slug: "quotes",
      hostname: "quotes.dev.qosapp.com",
      businessProfile: "hospitality",
    });

    const firstReleaseId = quotes.release.id;

    await updateStorefrontDraft(db, quotes.tenant.tenant.id, quotes.storefront.publicId, {
      expectedVersion: 1,
      draftConfig: {
        ...defaultStorefrontDraftConfig("hospitality"),
        theme: {
          preset: "hospitality_baseline",
          colors: { primary: "#222222" },
        },
      },
    });

    await publishStorefrontRelease(
      db,
      quotes.tenant.tenant.id,
      quotes.storefront.publicId,
      "admin@test",
    );

    const manifest = await resolveStorefrontManifestByPublicId(
      db,
      quotes.storefront.publicId,
      "1",
    );

    expect(manifest.releaseVersion).toBe(2);
    expect(manifest.theme).toMatchObject({
      colors: { primary: "#222222" },
    });

    const [originalRelease] = await db
      .select()
      .from(storefrontReleases)
      .where(eq(storefrontReleases.id, firstReleaseId));

    expect(originalRelease?.payload.theme).toMatchObject({
      preset: "hospitality_baseline",
    });
    expect(originalRelease?.payload.releaseVersion).toBe(1);
  });

  it("rejects unsupported contract versions and unpublished storefronts safely", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      locationPublicIds: [quotes.location.publicId],
    });

    await registerStorefrontDomain(db, quotes.tenant.id, storefront.publicId, {
      hostname: "draft-only.dev.qosapp.com",
      domainType: "platform_subdomain",
    });

    await expect(
      resolveStorefrontManifestByHostname(
        db,
        "draft-only.dev.qosapp.com",
        "1",
      ),
    ).rejects.toBeInstanceOf(StorefrontManifestResolverError);

    await expect(
      resolveStorefrontManifestByHostname(
        db,
        "missing.dev.qosapp.com",
        "1",
      ),
    ).rejects.toBeInstanceOf(StorefrontManifestResolverError);

    await expect(
      resolveStorefrontManifestByPublicId(db, storefront.publicId, "99"),
    ).rejects.toBeInstanceOf(StorefrontManifestContractError);
  });
});
