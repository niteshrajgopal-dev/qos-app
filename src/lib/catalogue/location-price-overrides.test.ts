import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  catalogueVariantLocationPriceResetAudits,
  staffIdentities,
  staffMemberships,
} from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import {
  LocationPriceOverrideError,
  getProductLocationPrices,
  resetProductLocationPriceOverride,
  setProductLocationPriceOverride,
} from "@/lib/catalogue/location-price-overrides";
import { createDraftProduct, updateDraftProduct } from "@/lib/catalogue/products";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { StaffAuthorizationError } from "@/lib/staff/auth";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue location price overrides", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedStaffMember(
    tenantId: string,
    role: "administrator" | "user",
    subject: string,
    email: string,
  ) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email })
      .returning();

    await db.insert(staffMemberships).values({
      tenantId,
      staffIdentityId: identity.id,
      role,
    });

    return {
      membershipId: identity.id,
      role,
      staffIdentityId: identity.id,
    };
  }

  const baseProductInput = {
    internalName: "flat-white",
    translations: {
      en: { displayName: "Flat White", description: "Coffee" },
      ar: { displayName: "فلات وايت", description: "قهوة" },
    },
    defaultVariant: { amountMinor: 2000, currency: "AED" },
  } as const;

  it("inherits central draft changes at branch A while branch B keeps its override", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await setProductLocationPriceOverride(
      db,
      quotes.tenant.id,
      admin,
      "admin.quotes@test",
      product.publicId,
      quotes.locationB.publicId,
      { amountMinor: 2400 },
    );

    const beforeCentralChange = await getProductLocationPrices(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
    );

    expect(
      beforeCentralChange.locations.find(
        (row) => row.locationPublicId === quotes.locationA.publicId,
      ),
    ).toMatchObject({
      amountMinor: 2000,
      inheritanceMode: "inherited",
    });
    expect(
      beforeCentralChange.locations.find(
        (row) => row.locationPublicId === quotes.locationB.publicId,
      ),
    ).toMatchObject({
      amountMinor: 2400,
      inheritanceMode: "override",
    });

    await updateDraftProduct(db, quotes.tenant.id, admin, product.publicId, {
      expectedVersion: product.version,
      defaultVariant: { amountMinor: 2200 },
    });

    const afterCentralChange = await getProductLocationPrices(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
    );

    expect(afterCentralChange.centralAmountMinor).toBe(2200);
    expect(
      afterCentralChange.locations.find(
        (row) => row.locationPublicId === quotes.locationA.publicId,
      ),
    ).toMatchObject({
      amountMinor: 2200,
      inheritanceMode: "inherited",
    });
    expect(
      afterCentralChange.locations.find(
        (row) => row.locationPublicId === quotes.locationB.publicId,
      ),
    ).toMatchObject({
      amountMinor: 2400,
      inheritanceMode: "override",
    });
  });

  it("resets an override to central explicitly and records audit metadata", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await setProductLocationPriceOverride(
      db,
      quotes.tenant.id,
      admin,
      "admin.quotes@test",
      product.publicId,
      quotes.locationB.publicId,
      { amountMinor: 2400 },
    );

    await updateDraftProduct(db, quotes.tenant.id, admin, product.publicId, {
      expectedVersion: product.version,
      defaultVariant: { amountMinor: 2200 },
    });

    const reset = await resetProductLocationPriceOverride(
      db,
      quotes.tenant.id,
      admin,
      "admin.quotes@test",
      product.publicId,
      quotes.locationB.publicId,
    );

    expect(
      reset.locations.find(
        (row) => row.locationPublicId === quotes.locationB.publicId,
      ),
    ).toMatchObject({
      amountMinor: 2200,
      inheritanceMode: "inherited",
      canResetToCentral: false,
    });

    const audits = await db.select().from(catalogueVariantLocationPriceResetAudits);
    expect(audits).toHaveLength(1);
    expect(audits[0]?.previousAmountMinor).toBe(2400);
    expect(audits[0]?.resetBySubject).toBe("admin.quotes@test");
  });

  it("blocks user role from creating location price overrides", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );
    const user = await seedStaffMember(
      quotes.tenant.id,
      "user",
      "user.quotes@test",
      "user.quotes@test",
    );

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await expect(
      setProductLocationPriceOverride(
        db,
        quotes.tenant.id,
        user,
        "user.quotes@test",
        product.publicId,
        quotes.locationB.publicId,
        { amountMinor: 2400 },
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
  });

  it("rejects foreign-tenant location associations", async () => {
    const quotes = await createQuotesTwoLocationTenant(db);
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await expect(
      setProductLocationPriceOverride(
        db,
        quotes.tenant.id,
        admin,
        "admin.quotes@test",
        product.publicId,
        flowers.location.publicId,
        { amountMinor: 2400 },
      ),
    ).rejects.toBeInstanceOf(LocationPriceOverrideError);
  });
});
