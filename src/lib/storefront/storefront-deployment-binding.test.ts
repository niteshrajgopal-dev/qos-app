import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { storefrontDeployments } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import {
  assertCallerStorefrontMatchesDeploymentBinding,
  resolveBoundStorefrontDeployment,
  resolveStorefrontHostContextWithDeploymentAgreement,
  StorefrontDeploymentBindingError,
} from "@/lib/storefront/storefront-deployment-binding";
import {
  readStorefrontDeploymentRuntimeConfig,
} from "@/lib/storefront/storefront-deployment-config";
import { clearHostResolutionCache } from "@/lib/storefront/host-resolution";
import { upsertStorefrontDeployment } from "@/lib/storefront/storefront-deployments";
import {
  createStorefront,
  publishStorefrontRelease,
  registerStorefrontDomain,
  rollbackStorefrontRelease,
  updateStorefrontDraft,
} from "@/lib/storefront/storefronts";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import {
  flowerTenantFixture,
  quotesTenantFixture,
} from "@/lib/tenant/fixtures";
import { withTenantContext } from "@/lib/tenant/context";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

function withBoundStorefront(publicId: string | null) {
  const previous = process.env.QOS_STOREFRONT_PUBLIC_ID;
  if (publicId) {
    process.env.QOS_STOREFRONT_PUBLIC_ID = publicId;
  } else {
    delete process.env.QOS_STOREFRONT_PUBLIC_ID;
  }

  return () => {
    if (previous === undefined) {
      delete process.env.QOS_STOREFRONT_PUBLIC_ID;
    } else {
      process.env.QOS_STOREFRONT_PUBLIC_ID = previous;
    }
  };
}

describe("storefront deployment runtime config", () => {
  it("reads QOS_STOREFRONT_PUBLIC_ID as the trusted server binding", () => {
    const restore = withBoundStorefront("stf_quotes_e748d7fc");
    try {
      expect(readStorefrontDeploymentRuntimeConfig().boundStorefrontPublicId).toBe(
        "stf_quotes_e748d7fc",
      );
    } finally {
      restore();
    }
  });
});

integrationDescribe("storefront deployment binding", () => {
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
    delete process.env.QOS_STOREFRONT_PUBLIC_ID;
    await sqlClient`TRUNCATE TABLE qos.storefront_deployments, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  afterEach(() => {
    delete process.env.QOS_STOREFRONT_PUBLIC_ID;
  });

  async function seedQuotesStorefront(options?: {
    isolatedHostname?: string;
    deploymentVersion?: string;
  }) {
    const tenant = await createTenantHierarchy(db, quotesTenantFixture());
    const storefront = await createStorefront(db, tenant.tenant.id, {
      brandPublicId: tenant.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [tenant.location.publicId],
    });

    await registerStorefrontDomain(db, tenant.tenant.id, storefront.publicId, {
      hostname: "quotes.dev.qosapp.com",
      domainType: "platform_subdomain",
      lifecycleStatus: "active",
      isPrimary: true,
    });

    if (options?.isolatedHostname) {
      await registerStorefrontDomain(db, tenant.tenant.id, storefront.publicId, {
        hostname: options.isolatedHostname,
        domainType: "platform_subdomain",
        lifecycleStatus: "active",
        isPrimary: false,
      });
    }

    await publishStorefrontRelease(db, tenant.tenant.id, storefront.publicId, "admin@test");

    await upsertStorefrontDeployment(db, tenant.tenant.id, {
      storefrontPublicId: storefront.publicId,
      environment: "dev",
      region: "uaenorth",
      containerAppName: "ca-qos-dev-storefront-quotes",
      lifecycleStatus: "active",
      applicationVersion: options?.deploymentVersion ?? "0.12.0",
      publicId: "sfd_quotes_dev_uaenorth",
    });

    return { tenant, storefront };
  }

  async function seedFlowerStorefront() {
    const tenant = await createTenantHierarchy(db, flowerTenantFixture());
    const storefront = await createStorefront(db, tenant.tenant.id, {
      brandPublicId: tenant.brand.publicId,
      internalName: "Floréa Website",
      slug: "flowers",
      defaultLocale: "en",
      supportedLocales: ["en", "ar"],
      draftConfig: defaultStorefrontDraftConfig("generic_retail"),
      locationPublicIds: [tenant.location.publicId],
    });

    await registerStorefrontDomain(db, tenant.tenant.id, storefront.publicId, {
      hostname: "flowers.dev.qosapp.com",
      domainType: "platform_subdomain",
      lifecycleStatus: "active",
      isPrimary: true,
    });

    await publishStorefrontRelease(db, tenant.tenant.id, storefront.publicId, "admin@test");

    return { tenant, storefront };
  }

  it("allows Quotes hostname + Quotes deployment binding", async () => {
    const quotes = await seedQuotesStorefront();
    const restore = withBoundStorefront(quotes.storefront.publicId);

    try {
      const result = await resolveStorefrontHostContextWithDeploymentAgreement(
        db,
        "quotes.dev.qosapp.com",
      );

      expect(result.host.storefrontPublicId).toBe(quotes.storefront.publicId);
      expect(result.deployment?.containerAppName).toBe(
        "ca-qos-dev-storefront-quotes",
      );
    } finally {
      restore();
    }
  });

  it("allows isolated Quotes hostname + Quotes deployment binding", async () => {
    const quotes = await seedQuotesStorefront({
      isolatedHostname: "quotes-isolated.dev.qosapp.com",
    });
    const restore = withBoundStorefront(quotes.storefront.publicId);

    try {
      const result = await resolveStorefrontHostContextWithDeploymentAgreement(
        db,
        "quotes-isolated.dev.qosapp.com",
      );

      expect(result.host.hostname).toBe("quotes-isolated.dev.qosapp.com");
      expect(result.host.storefrontPublicId).toBe(quotes.storefront.publicId);
    } finally {
      restore();
    }
  });

  it("rejects Floréa hostname + Quotes deployment binding", async () => {
    const quotes = await seedQuotesStorefront();
    await seedFlowerStorefront();
    const restore = withBoundStorefront(quotes.storefront.publicId);

    try {
      await expect(
        resolveStorefrontHostContextWithDeploymentAgreement(
          db,
          "flowers.dev.qosapp.com",
        ),
      ).rejects.toBeInstanceOf(StorefrontDeploymentBindingError);
    } finally {
      restore();
    }
  });

  it("rejects unknown host when deployment is bound", async () => {
    const quotes = await seedQuotesStorefront();
    const restore = withBoundStorefront(quotes.storefront.publicId);

    try {
      await expect(
        resolveStorefrontHostContextWithDeploymentAgreement(
          db,
          "missing.dev.qosapp.com",
        ),
      ).rejects.toThrow();
    } finally {
      restore();
    }
  });

  it("rejects caller storefront override against deployment binding", async () => {
    const quotes = await seedQuotesStorefront();
    const flowers = await seedFlowerStorefront();
    const restore = withBoundStorefront(quotes.storefront.publicId);

    try {
      const deployment = await resolveBoundStorefrontDeployment(db);
      expect(deployment).not.toBeNull();

      expect(() =>
        assertCallerStorefrontMatchesDeploymentBinding(
          flowers.storefront.publicId,
          deployment!,
        ),
      ).toThrow(StorefrontDeploymentBindingError);
    } finally {
      restore();
    }
  });

  it("rejects bound deployment when no active deployment record exists", async () => {
    const quotes = await seedQuotesStorefront();
    const restore = withBoundStorefront(quotes.storefront.publicId);

    try {
      await withTenantContext(db, quotes.tenant.tenant.id, async (tx) => {
        await tx
          .update(storefrontDeployments)
          .set({ lifecycleStatus: "inactive", updatedAt: new Date() })
          .where(eq(storefrontDeployments.publicId, "sfd_quotes_dev_uaenorth"));
      });

      await expect(resolveBoundStorefrontDeployment(db)).rejects.toBeInstanceOf(
        StorefrontDeploymentBindingError,
      );
    } finally {
      restore();
    }
  });

  it("allows two storefront deployments for one tenant without schema changes", async () => {
    const tenant = await createTenantHierarchy(db, quotesTenantFixture());

    const quotesStorefront = await createStorefront(db, tenant.tenant.id, {
      brandPublicId: tenant.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [tenant.location.publicId],
    });

    const flowerStorefront = await createStorefront(db, tenant.tenant.id, {
      brandPublicId: tenant.brand.publicId,
      internalName: "Floréa Website",
      slug: "florea",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("generic_retail"),
      locationPublicIds: [tenant.location.publicId],
    });

    const quotesDeployment = await upsertStorefrontDeployment(db, tenant.tenant.id, {
      storefrontPublicId: quotesStorefront.publicId,
      environment: "dev",
      region: "uaenorth",
      containerAppName: "ca-qos-dev-storefront-quotes",
      lifecycleStatus: "active",
      applicationVersion: "0.12.0",
      publicId: "sfd_quotes_dev_uaenorth",
    });

    const floreaDeployment = await upsertStorefrontDeployment(db, tenant.tenant.id, {
      storefrontPublicId: flowerStorefront.publicId,
      environment: "dev",
      region: "uaenorth",
      containerAppName: "ca-qos-dev-storefront-florea",
      lifecycleStatus: "active",
      applicationVersion: "0.11.0",
      publicId: "sfd_florea_dev_uaenorth",
    });

    expect(quotesDeployment.storefrontId).not.toBe(flowerStorefront.id);
    expect(floreaDeployment.containerAppName).toBe("ca-qos-dev-storefront-florea");
  });
});

integrationDescribe("storefront release isolation from deployment", () => {
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
    await sqlClient`TRUNCATE TABLE qos.storefront_deployments, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  it("does not mutate StorefrontDeployment on publish or rollback", async () => {
    const tenant = await createTenantHierarchy(db, quotesTenantFixture());
    const storefront = await createStorefront(db, tenant.tenant.id, {
      brandPublicId: tenant.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [tenant.location.publicId],
    });

    await registerStorefrontDomain(db, tenant.tenant.id, storefront.publicId, {
      hostname: "quotes.dev.qosapp.com",
      domainType: "platform_subdomain",
      lifecycleStatus: "active",
      isPrimary: true,
    });

    const deployment = await upsertStorefrontDeployment(db, tenant.tenant.id, {
      storefrontPublicId: storefront.publicId,
      environment: "dev",
      region: "uaenorth",
      containerAppName: "ca-qos-dev-storefront-quotes",
      lifecycleStatus: "active",
      applicationVersion: "0.12.0",
      publicId: "sfd_quotes_dev_uaenorth",
    });

    const published = await publishStorefrontRelease(
      db,
      tenant.tenant.id,
      storefront.publicId,
      "admin@test",
    );

    expect(published.releaseVersion).toBe(1);

    const afterPublish = await withTenantContext(db, tenant.tenant.id, async (tx) => {
      const [row] = await tx
        .select()
        .from(storefrontDeployments)
        .where(eq(storefrontDeployments.id, deployment.id))
        .limit(1);
      return row;
    });

    expect(afterPublish?.applicationVersion).toBe("0.12.0");
    expect(afterPublish?.containerAppName).toBe("ca-qos-dev-storefront-quotes");
    expect(afterPublish?.lifecycleStatus).toBe("active");

    await updateStorefrontDraft(db, tenant.tenant.id, storefront.publicId, {
      expectedVersion: 1,
      draftConfig: {
        ...defaultStorefrontDraftConfig("hospitality"),
        theme: {
          preset: "hospitality_baseline",
          colors: {
            primary: "#112233",
            accent: "#CBB792",
            background: "#ffffff",
            text: "#1f2937",
          },
        },
      },
    });

    const secondPublish = await publishStorefrontRelease(
      db,
      tenant.tenant.id,
      storefront.publicId,
      "admin@test",
    );

    expect(secondPublish.releaseVersion).toBe(2);

    const rollbackResult = await rollbackStorefrontRelease(
      db,
      tenant.tenant.id,
      storefront.publicId,
      published.publicId,
      "admin@test",
    );

    expect(rollbackResult.releaseVersion).toBe(1);

    const afterRollback = await withTenantContext(db, tenant.tenant.id, async (tx) => {
      const [row] = await tx
        .select()
        .from(storefrontDeployments)
        .where(eq(storefrontDeployments.id, deployment.id))
        .limit(1);
      return row;
    });

    expect(afterRollback?.applicationVersion).toBe("0.12.0");
    expect(afterRollback?.containerAppName).toBe("ca-qos-dev-storefront-quotes");
  });
});
