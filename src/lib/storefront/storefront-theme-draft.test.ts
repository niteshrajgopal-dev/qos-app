import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  catalogueMediaAssets,
  catalogueMediaDerivatives,
  catalogueProducts,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  storefrontReleases,
  storefronts,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import {
  getStorefrontThemeDraftForStaff,
  saveStorefrontThemeDraftAsAdministrator,
} from "@/lib/storefront/storefront-theme-draft";
import { StorefrontThemeValidationError } from "@/lib/storefront/storefront-theme-schema";
import { createDraftProduct } from "@/lib/catalogue/products";
import {
  createStorefront,
  publishStorefrontRelease,
  StorefrontConflictError,
} from "@/lib/storefront/storefronts";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import {
  flowerTenantFixture,
  quotesTenantFixture,
} from "@/lib/tenant/fixtures";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("storefront theme draft", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
  }, 120_000);

  afterAll(async () => {
    if (sqlClient) {
      await sqlClient.end({ timeout: 5 });
    }
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(
    tenantId: string,
    locationId: string,
    subject = "admin.quotes@test",
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({
        providerSubject: subject,
        email: subject,
      })
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

    return {
      subject,
      membership: {
        membershipId: membership.id,
        role: membership.role,
        staffIdentityId: identity.id,
      },
    };
  }

  async function seedUser(tenantId: string, locationId: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({
        providerSubject: "user.quotes@test",
        email: "user.quotes@test",
      })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId,
        staffIdentityId: identity.id,
        role: "user",
      })
      .returning();

    await db.insert(staffLocationScopes).values({
      tenantId,
      staffMembershipId: membership.id,
      locationId,
    });
  }

  async function seedStorefront() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const { subject: adminSubject } = await seedAdministrator(
      quotes.tenant.id,
      quotes.location.id,
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.location.publicId],
    });

    return { quotes, storefront, adminSubject };
  }

  it("keeps theme draft edits off the active release until publish", async () => {
    const { quotes, storefront, adminSubject } = await seedStorefront();

    const publish = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      adminSubject,
    );

    await saveStorefrontThemeDraftAsAdministrator(
      db,
      quotes.tenant.id,
      adminSubject,
      storefront.publicId,
      {
        expectedVersion: 1,
        theme: {
          schemaVersion: 1,
          preset: "hospitality_baseline",
          colors: {
            primary: "#111111",
            accent: "#CBB792",
            background: "#F5F1E9",
            text: "#111111",
          },
          typography: {
            body: "inter",
            display: "young-serif",
          },
        },
      },
    );

    const [activeRelease] = await db
      .select()
      .from(storefrontReleases)
      .where(eq(storefrontReleases.publicId, publish.publicId));

    expect(activeRelease?.payload.theme).not.toEqual(
      expect.objectContaining({
        colors: expect.objectContaining({ primary: "#111111" }),
      }),
    );

    const draft = await getStorefrontThemeDraftForStaff(
      db,
      quotes.tenant.id,
      adminSubject,
      storefront.publicId,
    );

    expect(draft.theme.colors.primary).toBe("#111111");
    expect(draft.activeReleaseTheme).not.toEqual(
      expect.objectContaining({
        colors: expect.objectContaining({ primary: "#111111" }),
      }),
    );
  });

  it("rejects non-administrator saves and stale expected versions", async () => {
    const { quotes, storefront, adminSubject } = await seedStorefront();
    await seedUser(quotes.tenant.id, quotes.location.id);

    await expect(
      saveStorefrontThemeDraftAsAdministrator(
        db,
        quotes.tenant.id,
        "user.quotes@test",
        storefront.publicId,
        {
          expectedVersion: 1,
          resetToDefault: true,
        },
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    await saveStorefrontThemeDraftAsAdministrator(
      db,
      quotes.tenant.id,
      adminSubject,
      storefront.publicId,
      {
        expectedVersion: 1,
        resetToDefault: true,
      },
    );

    await expect(
      saveStorefrontThemeDraftAsAdministrator(
        db,
        quotes.tenant.id,
        adminSubject,
        storefront.publicId,
        {
          expectedVersion: 1,
          resetToDefault: true,
        },
      ),
    ).rejects.toBeInstanceOf(StorefrontConflictError);
  });

  it("rejects foreign logo media derivatives", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const { subject: adminSubject } = await seedAdministrator(
      quotes.tenant.id,
      quotes.location.id,
    );
    const { membership: flowersMembership } = await seedAdministrator(
      flowers.tenant.id,
      flowers.location.id,
      "admin.flowers@test",
    );

    const storefront = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Quotes Website",
      slug: "quotes",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: defaultStorefrontDraftConfig("hospitality"),
      locationPublicIds: [quotes.location.publicId],
    });

    const foreignProduct = await createDraftProduct(
      db,
      flowers.tenant.id,
      flowersMembership,
      {
        internalName: "bouquet",
        translations: {
          en: { displayName: "Bouquet", description: "Flowers" },
          ar: { displayName: "باقة", description: "زهور" },
        },
        defaultVariant: { amountMinor: 12000, currency: "AED" },
      },
    );

    const [foreignProductRow] = await db
      .select({ id: catalogueProducts.id })
      .from(catalogueProducts)
      .where(
        and(
          eq(catalogueProducts.tenantId, flowers.tenant.id),
          eq(catalogueProducts.publicId, foreignProduct.publicId),
        ),
      )
      .limit(1);

    const [foreignAsset] = await db
      .insert(catalogueMediaAssets)
      .values({
        tenantId: flowers.tenant.id,
        publicId: "med_foreign_logo",
        productId: foreignProductRow!.id,
        status: "approved",
        contentType: "image/png",
      })
      .returning();

    await db.insert(catalogueMediaDerivatives).values({
      tenantId: flowers.tenant.id,
      assetId: foreignAsset.id,
      derivativeKind: "thumbnail",
      publicDerivativeId: "mda_foreign_logo_thumb",
      storagePath: `${flowers.tenant.id}/public/mda_foreign_logo_thumb.jpg`,
      contentType: "image/jpeg",
      width: 100,
      height: 100,
      byteSize: 512,
    });

    await expect(
      saveStorefrontThemeDraftAsAdministrator(
        db,
        quotes.tenant.id,
        adminSubject,
        storefront.publicId,
        {
          expectedVersion: 1,
          theme: {
            schemaVersion: 1,
            preset: "hospitality_baseline",
            colors: {
              primary: "#2F2322",
              accent: "#CBB792",
              background: "#F5F1E9",
              text: "#2F2322",
            },
            typography: {
              body: "inter",
              display: "young-serif",
            },
            logo: {
              publicDerivativeId: "mda_foreign_logo_thumb",
            },
          },
        },
      ),
    ).rejects.toBeInstanceOf(StorefrontThemeValidationError);

    const [unchanged] = await db
      .select({ draftConfig: storefronts.draftConfig })
      .from(storefronts)
      .where(eq(storefronts.publicId, storefront.publicId));

    expect(unchanged?.draftConfig.theme).not.toEqual(
      expect.objectContaining({
        logo: expect.objectContaining({
          publicDerivativeId: "mda_foreign_logo_thumb",
        }),
      }),
    );
  });
});
