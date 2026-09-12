import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { storefrontDomains } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import {
  clearHostResolutionCache,
  HostResolutionError,
  isStorefrontDomainResolvable,
  normalizeIncomingHost,
  resolveStorefrontHostContext,
  resolveTrustedHost,
} from "@/lib/storefront/host-resolution";
import {
  createStorefront,
  publishStorefrontRelease,
  registerStorefrontDomain,
} from "@/lib/storefront/storefronts";
import type { CreateTenantHierarchyInput } from "@/lib/tenant/types";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import {
  flowerTenantFixture,
  quotesTenantFixture,
} from "@/lib/tenant/fixtures";
import { withTenantContext } from "@/lib/tenant/context";

describe("host normalization and trust", () => {
  it("normalizes case, trailing dots and dev ports", () => {
    expect(normalizeIncomingHost("Quotes.Dev.Qosapp.Com.", true)).toBe(
      "quotes.dev.qosapp.com",
    );
    expect(normalizeIncomingHost("quotes.dev.qosapp.com:3000", true)).toBe(
      "quotes.dev.qosapp.com",
    );
  });

  it("rejects forwarded host without a trusted edge boundary", () => {
    expect(() =>
      resolveTrustedHost(
        {
          hostHeader: "quotes.dev.qosapp.com",
          forwardedHost: "evil.example.com",
          azureFrontDoorId: null,
        },
        {
          azureFrontDoorId: "fd-test-id",
          trustForwardedHost: false,
          allowDevHostPort: true,
        },
      ),
    ).toThrow(HostResolutionError);

    expect(
      resolveTrustedHost(
        {
          hostHeader: "origin.internal",
          forwardedHost: "quotes.dev.qosapp.com",
          azureFrontDoorId: "fd-test-id",
        },
        {
          azureFrontDoorId: "fd-test-id",
          trustForwardedHost: false,
          allowDevHostPort: true,
        },
      ),
    ).toBe("quotes.dev.qosapp.com");
  });

  it("evaluates resolvability rules for platform and custom domains", () => {
    expect(
      isStorefrontDomainResolvable({
        domainType: "platform_subdomain",
        verificationStatus: "pending",
        lifecycleStatus: "provisioning",
      }),
    ).toBe(true);

    expect(
      isStorefrontDomainResolvable({
        domainType: "custom_domain",
        verificationStatus: "pending",
        lifecycleStatus: "active",
      }),
    ).toBe(false);

    expect(
      isStorefrontDomainResolvable({
        domainType: "custom_domain",
        verificationStatus: "verified",
        lifecycleStatus: "active",
      }),
    ).toBe(true);
  });
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("storefront host resolution", () => {
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
    clearHostResolutionCache();
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

  it("resolves Quotes and flower hostnames to distinct storefront contexts", async () => {
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

    const quotesHost = await resolveStorefrontHostContext(
      db,
      "QUOTES.dev.qosapp.com.",
    );
    const flowerHost = await resolveStorefrontHostContext(
      db,
      "flowers.dev.qosapp.com",
    );

    expect(quotesHost.storefrontPublicId).toBe(quotes.storefront.publicId);
    expect(flowerHost.storefrontPublicId).toBe(flowers.storefront.publicId);
    expect(quotesHost.tenantPublicId).not.toBe(flowerHost.tenantPublicId);
    expect(quotesHost.releaseVersion).toBe(1);
  });

  it("rejects unknown and unverified custom domains without fallback", async () => {
    const quotes = await seedPublishedStorefront({
      tenantFixture: quotesTenantFixture(),
      slug: "quotes",
      hostname: "quotes.dev.qosapp.com",
      businessProfile: "hospitality",
    });

    await registerStorefrontDomain(db, quotes.tenant.tenant.id, quotes.storefront.publicId, {
      hostname: "shop.quotes.example",
      domainType: "custom_domain",
      verificationStatus: "pending",
      lifecycleStatus: "active",
      isPrimary: false,
    });

    await expect(
      resolveStorefrontHostContext(db, "missing.dev.qosapp.com"),
    ).rejects.toBeInstanceOf(HostResolutionError);

    await expect(
      resolveStorefrontHostContext(db, "shop.quotes.example"),
    ).rejects.toBeInstanceOf(HostResolutionError);
  });

  it("does not serve disabled domains from cache after lifecycle changes", async () => {
    const quotes = await seedPublishedStorefront({
      tenantFixture: quotesTenantFixture(),
      slug: "quotes",
      hostname: "quotes.dev.qosapp.com",
      businessProfile: "hospitality",
    });

    const first = await resolveStorefrontHostContext(db, "quotes.dev.qosapp.com");
    expect(first.storefrontPublicId).toBe(quotes.storefront.publicId);

    await withTenantContext(db, quotes.tenant.tenant.id, async (tx) => {
      await tx
        .update(storefrontDomains)
        .set({ lifecycleStatus: "inactive", updatedAt: new Date() })
        .where(eq(storefrontDomains.hostname, "quotes.dev.qosapp.com"));
    });

    await expect(
      resolveStorefrontHostContext(db, "quotes.dev.qosapp.com"),
    ).rejects.toBeInstanceOf(HostResolutionError);
  });

  it("emits structured resolution logs without secrets", async () => {
    const logSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    await seedPublishedStorefront({
      tenantFixture: quotesTenantFixture(),
      slug: "quotes",
      hostname: "quotes.dev.qosapp.com",
      businessProfile: "hospitality",
    });

    await resolveStorefrontHostContext(db, "quotes.dev.qosapp.com", {
      requestId: "req_test_123",
    });

    const payload = logSpy.mock.calls
      .map(([entry]) => entry)
      .find(
        (entry) =>
          typeof entry === "string" &&
          entry.includes('"type":"storefront_host_resolution"'),
      );

    expect(payload).toBeDefined();
    expect(payload).toContain("req_test_123");
    expect(payload).not.toContain("password");
    expect(payload).not.toContain("credential");

    logSpy.mockRestore();
  });
});
