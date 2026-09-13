import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import {
  createDraftProduct,
  getDraftProduct,
} from "@/lib/catalogue/products";
import {
  CatalogueVariantConflictError,
  CatalogueVariantError,
  createProductVariant,
  listProductVariants,
  reorderProductVariants,
  updateProductVariant,
} from "@/lib/catalogue/variants";
import { seedFlowerDevTenant } from "@/lib/seed/dev-tenants";
import { flowerRoseBouquetFixture } from "@/lib/seed/fixtures/flower-catalogue";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { StaffAuthorizationError } from "@/lib/staff/auth";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue product variants", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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

  it("adds ordered variants with stable IDs and exact prices", async () => {
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

    const labeledDefault = await updateProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      product.defaultVariant.publicId,
      {
        expectedProductVersion: product.version,
        translations: {
          en: { displayName: "Regular" },
          ar: { displayName: "عادي" },
        },
      },
      "admin.quotes@test",
    );

    const large = await createProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedProductVersion: labeledDefault.productVersion,
        publicId: "var_flat_white_large",
        translations: {
          en: { displayName: "Large" },
          ar: { displayName: "كبير" },
        },
        amountMinor: 2200,
      },
      "admin.quotes@test",
    );

    expect(large.variants.filter((variant) => variant.status === "active")).toHaveLength(
      2,
    );

    const largeVariant = large.variants.find(
      (variant) => variant.publicId === "var_flat_white_large",
    );
    expect(largeVariant?.amountMinor).toBe(2200);
    expect(largeVariant?.translations.en.displayName).toBe("Large");
    expect(largeVariant?.translations.ar.displayName).toBe("كبير");

    const retried = await createProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedProductVersion: large.productVersion,
        publicId: "var_flat_white_large",
        translations: {
          en: { displayName: "Large" },
          ar: { displayName: "كبير" },
        },
        amountMinor: 2200,
      },
      "admin.quotes@test",
    );

    expect(
      retried.variants.filter((variant) => variant.publicId === "var_flat_white_large"),
    ).toHaveLength(1);
  });

  it("preserves reorder after reload and rejects stale product versions", async () => {
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

    const labeledDefault = await updateProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      product.defaultVariant.publicId,
      {
        expectedProductVersion: product.version,
        translations: {
          en: { displayName: "Regular" },
          ar: { displayName: "عادي" },
        },
      },
      "admin.quotes@test",
    );

    const withLarge = await createProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedProductVersion: labeledDefault.productVersion,
        publicId: "var_flat_white_large",
        translations: {
          en: { displayName: "Large" },
          ar: { displayName: "كبير" },
        },
        amountMinor: 2200,
      },
      "admin.quotes@test",
    );

    const defaultVariant = withLarge.variants.find((variant) => variant.isDefault);
    expect(defaultVariant).toBeTruthy();

    const reordered = await reorderProductVariants(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedProductVersion: withLarge.productVersion,
        orderedPublicIds: ["var_flat_white_large", defaultVariant!.publicId],
      },
      "admin.quotes@test",
    );

    const reloaded = await listProductVariants(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
    );

    expect(
      reloaded.variants
        .filter((variant) => variant.status === "active")
        .map((variant) => variant.publicId),
    ).toEqual(["var_flat_white_large", defaultVariant!.publicId]);

    await expect(
      updateProductVariant(
        db,
        quotes.tenant.id,
        admin,
        product.publicId,
        "var_flat_white_large",
        {
          expectedProductVersion: withLarge.productVersion,
          translations: {
            en: { displayName: "Grande" },
          },
        },
        "admin.quotes@test",
      ),
    ).rejects.toBeInstanceOf(CatalogueVariantConflictError);

    expect(reordered.productVersion).toBeGreaterThan(withLarge.productVersion);
  });

  it("archives non-default variants without deleting them", async () => {
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

    const labeledDefault = await updateProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      product.defaultVariant.publicId,
      {
        expectedProductVersion: product.version,
        translations: {
          en: { displayName: "Regular" },
          ar: { displayName: "عادي" },
        },
      },
      "admin.quotes@test",
    );

    const withLarge = await createProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedProductVersion: labeledDefault.productVersion,
        publicId: "var_flat_white_large",
        translations: {
          en: { displayName: "Large" },
          ar: { displayName: "كبير" },
        },
        amountMinor: 2200,
      },
      "admin.quotes@test",
    );

    const archived = await updateProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      "var_flat_white_large",
      {
        expectedProductVersion: withLarge.productVersion,
        status: "archived",
      },
      "admin.quotes@test",
    );

    expect(
      archived.variants.find((variant) => variant.publicId === "var_flat_white_large")
        ?.status,
    ).toBe("archived");
    expect(archived.variants).toHaveLength(2);
  });

  it("rejects duplicate sku identifiers within a tenant", async () => {
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

    const labeledDefault = await updateProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      product.defaultVariant.publicId,
      {
        expectedProductVersion: product.version,
        translations: {
          en: { displayName: "Regular" },
          ar: { displayName: "عادي" },
        },
      },
      "admin.quotes@test",
    );

    await createProductVariant(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
      {
        expectedProductVersion: labeledDefault.productVersion,
        publicId: "var_flat_white_large",
        sku: "FW-LARGE",
        translations: {
          en: { displayName: "Large" },
          ar: { displayName: "كبير" },
        },
        amountMinor: 2200,
      },
      "admin.quotes@test",
    );

    const created = await getDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      product.publicId,
    );

    await expect(
      createProductVariant(
        db,
        quotes.tenant.id,
        admin,
        product.publicId,
        {
          expectedProductVersion: created.version,
          publicId: "var_flat_white_small",
          sku: "FW-LARGE",
          translations: {
            en: { displayName: "Small" },
            ar: { displayName: "صغير" },
          },
          amountMinor: 1600,
        },
        "admin.quotes@test",
      ),
    ).rejects.toBeInstanceOf(CatalogueVariantError);
  });

  it("requires administrator membership to set prices", async () => {
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

    const product = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await expect(
      createProductVariant(
        db,
        quotes.tenant.id,
        user,
        product.publicId,
        {
          expectedProductVersion: product.version,
          publicId: "var_flat_white_large",
          translations: {
            en: { displayName: "Large" },
            ar: { displayName: "كبير" },
          },
          amountMinor: 2200,
        },
        "user.quotes@test",
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
  });

  it("loads flower fixture variants with localized labels", async () => {
    const { tenantId } = await seedFlowerDevTenant(db);
    const admin = await seedStaffMember(
      tenantId,
      "administrator",
      "admin.flowers@test",
      "admin.flowers@test",
    );

    const view = await listProductVariants(
      db,
      tenantId,
      admin,
      flowerRoseBouquetFixture.productPublicId,
    );

    expect(view.variants.filter((variant) => variant.status === "active")).toHaveLength(
      3,
    );
    expect(
      view.variants.find((variant) => variant.publicId === "var_flowers_rose_medium")
        ?.translations.en.displayName,
    ).toBe("Medium");
  });
});
