import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
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
  publishStorefrontReleaseAsAdministrator,
  rollbackStorefrontReleaseAsAdministrator,
  StorefrontPublishError,
} from "@/lib/storefront/storefront-publish";
import {
  createStorefront,
  publishStorefrontRelease,
  updateStorefrontDraft,
} from "@/lib/storefront/storefronts";
import { StaffAuthorizationError } from "@/lib/staff/auth";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("storefront publish and rollback", () => {
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
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdministrator(tenantId: string, locationId: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({
        providerSubject: "admin.quotes@test",
        email: "admin.quotes@test",
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

    return "admin.quotes@test";
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
    const adminSubject = await seedAdministrator(
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

  it("keeps draft edits off the live release until publish", async () => {
    const { quotes, storefront, adminSubject } = await seedStorefront();

    const firstPublish = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      adminSubject,
    );

    const draft = defaultStorefrontDraftConfig("hospitality");
    await updateStorefrontDraft(db, quotes.tenant.id, storefront.publicId, {
      expectedVersion: 1,
      draftConfig: {
        ...draft,
        theme: {
          preset: "hospitality_baseline",
          colors: {
            primary: "#ff0000",
            accent: "#b45309",
            background: "#ffffff",
            text: "#1f2937",
          },
        },
      },
    });

    const [activeRelease] = await db
      .select()
      .from(storefrontReleases)
      .where(eq(storefrontReleases.publicId, firstPublish.publicId));

    expect(activeRelease?.payload.theme).not.toEqual(
      expect.objectContaining({
        colors: expect.objectContaining({ primary: "#ff0000" }),
      }),
    );
  });

  it("creates one new release on publish and replays idempotently", async () => {
    const { quotes, storefront, adminSubject } = await seedStorefront();

    const first = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      adminSubject,
    );
    const second = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      adminSubject,
    );

    expect(first.idempotentReplay).toBe(false);
    expect(second.idempotentReplay).toBe(true);
    expect(second.publicId).toBe(first.publicId);

    const releases = await db.select().from(storefrontReleases);
    expect(releases).toHaveLength(1);
  });

  it("rolls back to a prior immutable release without mutating it", async () => {
    const { quotes, storefront, adminSubject } = await seedStorefront();

    const first = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      adminSubject,
    );

    await updateStorefrontDraft(db, quotes.tenant.id, storefront.publicId, {
      expectedVersion: 1,
      draftConfig: {
        ...defaultStorefrontDraftConfig("hospitality"),
        theme: {
          preset: "hospitality_baseline",
          colors: { primary: "#222222" },
        },
      },
    });

    const second = await publishStorefrontRelease(
      db,
      quotes.tenant.id,
      storefront.publicId,
      adminSubject,
    );

    expect(second.releaseVersion).toBe(2);

    const rollback = await rollbackStorefrontReleaseAsAdministrator(
      db,
      quotes.tenant.id,
      adminSubject,
      storefront.publicId,
      first.publicId,
    );

    expect(rollback.idempotentReplay).toBe(false);
    expect(rollback.releaseVersion).toBe(1);

    const [originalRelease, updatedStorefront] = await Promise.all([
      db
        .select()
        .from(storefrontReleases)
        .where(eq(storefrontReleases.publicId, first.publicId))
        .then((rows) => rows[0]),
      db
        .select()
        .from(storefronts)
        .where(eq(storefronts.publicId, storefront.publicId))
        .then((rows) => rows[0]),
    ]);

    expect(originalRelease?.payload.theme).toEqual(first.payload.theme);
    expect(updatedStorefront?.activeReleaseId).toBe(originalRelease?.id);
  });

  it("blocks publish for non-administrators and invalid drafts", async () => {
    const { quotes, storefront, adminSubject } = await seedStorefront();
    await seedUser(quotes.tenant.id, quotes.location.id);

    await expect(
      publishStorefrontReleaseAsAdministrator(
        db,
        quotes.tenant.id,
        "user.quotes@test",
        storefront.publicId,
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    const broken = await createStorefront(db, quotes.tenant.id, {
      brandPublicId: quotes.brand.publicId,
      internalName: "Broken Website",
      slug: "broken",
      defaultLocale: "en",
      supportedLocales: ["en"],
      draftConfig: { theme: {} },
      locationPublicIds: [quotes.location.publicId],
    });

    await expect(
      publishStorefrontReleaseAsAdministrator(
        db,
        quotes.tenant.id,
        adminSubject,
        broken.publicId,
      ),
    ).rejects.toBeInstanceOf(StorefrontPublishError);
  });
});
