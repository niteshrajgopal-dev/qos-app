import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import {
  CatalogueProductConflictError,
  CatalogueProductError,
  createDraftProduct,
  getDraftProduct,
  updateDraftProduct,
} from "@/lib/catalogue/products";
import { seedFlowerDevTenant } from "@/lib/seed/dev-tenants";
import { flowerRoseBouquetFixture } from "@/lib/seed/fixtures/flower-catalogue";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { StaffAuthorizationError } from "@/lib/staff/auth";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue draft products", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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
      en: {
        displayName: "Flat White",
        description: "Double shot with steamed milk.",
      },
      ar: {
        displayName: "فلات وايت",
        description: "شوت مزدوج مع حليب مبخر.",
      },
    },
    defaultVariant: {
      amountMinor: 1800,
      currency: "AED",
    },
  } as const;

  it("creates a bilingual draft product with a sellable default variant", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
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

    expect(product.status).toBe("draft");
    expect(product.version).toBe(1);
    expect(product.translations.en.displayName).toBe("Flat White");
    expect(product.translations.ar.displayName).toBe("فلات وايت");
    expect(product.defaultVariant.amountMinor).toBe(1800);
    expect(product.defaultVariant.currency).toBe("AED");
    expect(product.provenance).toBe("operator_entered");
  });

  it("preserves independent translation versions while price stays canonical", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const created = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    const updated = await updateDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      created.publicId,
      {
        expectedVersion: created.version,
        translations: {
          en: {
            displayName: "Flat White (Updated)",
            expectedTranslationVersion:
              created.translations.en.translationVersion,
          },
        },
        defaultVariant: {
          amountMinor: 2000,
        },
      },
    );

    expect(updated.translations.en.translationVersion).toBe(2);
    expect(updated.translations.ar.translationVersion).toBe(1);
    expect(updated.defaultVariant.amountMinor).toBe(2000);
  });

  it("rejects stale product version, invalid price, and cross-tenant access", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const created = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await expect(
      updateDraftProduct(db, quotes.tenant.id, admin, created.publicId, {
        expectedVersion: created.version + 1,
        internalName: "stale-edit",
      }),
    ).rejects.toBeInstanceOf(CatalogueProductConflictError);

    await expect(
      createDraftProduct(db, quotes.tenant.id, admin, {
        ...baseProductInput,
        internalName: "invalid-price",
        defaultVariant: { amountMinor: -100, currency: "AED" },
      }),
    ).rejects.toBeInstanceOf(CatalogueProductError);

    await expect(
      getDraftProduct(db, flowers.tenant.id, admin, created.publicId),
    ).rejects.toBeInstanceOf(CatalogueProductError);
  });

  it("allows flower catalogue items without nutrition fields", async () => {
    const flowerSeed = await seedFlowerDevTenant(db);
    const admin = await seedStaffMember(
      flowerSeed.tenantId,
      "administrator",
      "admin.flowers@test",
      "admin.flowers@test",
    );

    const product = await getDraftProduct(
      db,
      flowerSeed.tenantId,
      admin,
      flowerRoseBouquetFixture.productPublicId,
    );

    expect(product.businessProfile).toBe("generic_retail");
    expect(product.nutritionCalories).toBeNull();
    expect(product.defaultVariant.amountMinor).toBeGreaterThan(0);
  });

  it("blocks user role from changing prices but allows translation edits", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
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

    const created = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await expect(
      updateDraftProduct(db, quotes.tenant.id, user, created.publicId, {
        expectedVersion: created.version,
        defaultVariant: { amountMinor: 2500 },
      }),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);

    const updated = await updateDraftProduct(
      db,
      quotes.tenant.id,
      user,
      created.publicId,
      {
        expectedVersion: created.version,
        translations: {
          ar: {
            displayName: "فلات وايت محدث",
            expectedTranslationVersion:
              created.translations.ar.translationVersion,
          },
        },
      },
    );

    expect(updated.translations.ar.displayName).toBe("فلات وايت محدث");
    expect(updated.translations.ar.translationVersion).toBe(2);
    expect(updated.defaultVariant.amountMinor).toBe(1800);
    expect(updated.translations.en.translationVersion).toBe(1);
  });

  it("rejects nutrition fields for generic retail tenants", async () => {
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const admin = await seedStaffMember(
      flowers.tenant.id,
      "administrator",
      "admin.flowers@test",
      "admin.flowers@test",
    );

    await expect(
      createDraftProduct(db, flowers.tenant.id, admin, {
        ...baseProductInput,
        internalName: "wrapped-bouquet",
        nutritionCalories: 120,
      }),
    ).rejects.toBeInstanceOf(CatalogueProductError);
  });
});
