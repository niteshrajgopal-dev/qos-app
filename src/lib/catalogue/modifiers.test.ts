import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import {
  attachModifierGroupToProduct,
  createModifierGroup,
  createModifierOption,
  getModifierGroup,
  listProductModifierGroups,
  updateModifierGroup,
} from "@/lib/catalogue/modifiers";
import { validateModifierGroupSelections } from "@/lib/catalogue/modifier-selection";
import { createDraftProduct } from "@/lib/catalogue/products";
import { seedFlowerDevTenant } from "@/lib/seed/dev-tenants";
import { flowerRoseBouquetFixture } from "@/lib/seed/fixtures/flower-catalogue";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { StaffAuthorizationError } from "@/lib/staff/auth";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue modifier groups", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_product_modifier_groups, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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

  it("creates reusable modifier groups with EN/AR labels and options", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const group = await createModifierGroup(
      db,
      quotes.tenant.id,
      {
        internalName: "milk-type",
        publicId: "modgrp_milk_type",
        minSelections: 1,
        maxSelections: 1,
        translations: {
          en: { displayName: "Milk Type" },
          ar: { displayName: "نوع الحليب" },
        },
      },
      "admin.quotes@test",
      admin,
    );

    const withOption = await createModifierOption(
      db,
      quotes.tenant.id,
      group.publicId,
      {
        expectedGroupVersion: group.version,
        publicId: "modopt_oat_milk",
        translations: {
          en: { displayName: "Oat" },
          ar: { displayName: "شوفان" },
        },
        priceMinor: 300,
        isDefault: true,
      },
      "admin.quotes@test",
      admin,
    );

    expect(withOption.options).toHaveLength(1);
    expect(withOption.options[0]?.priceMinor).toBe(300);

    const rules = {
      publicId: withOption.publicId,
      minSelections: withOption.minSelections,
      maxSelections: withOption.maxSelections,
      options: withOption.options.map((option) => ({
        publicId: option.publicId,
        status: option.status,
        isDefault: option.isDefault,
        allowsQuantity: option.allowsQuantity,
        maxQuantity: option.maxQuantity,
        priceMinor: option.priceMinor,
      })),
    };

    expect(() => validateModifierGroupSelections(rules, [])).toThrow();
    expect(
      validateModifierGroupSelections(rules, [], { applyDefaults: true })
        .totalPriceMinor,
    ).toBe(300);
  });

  it("attaches modifier groups to products and exposes affected product counts on update", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.quotes@test",
      "admin.quotes@test",
    );

    const product = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "flat-white",
      translations: {
        en: { displayName: "Flat White", description: "Coffee." },
        ar: { displayName: "فلات وايت", description: "قهوة." },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });

    const group = await createModifierGroup(
      db,
      quotes.tenant.id,
      {
        internalName: "extra-shot",
        publicId: "modgrp_extra_shot",
        minSelections: 0,
        maxSelections: 1,
        translations: {
          en: { displayName: "Extra Shot" },
          ar: { displayName: "شوت إضافي" },
        },
      },
      "admin.quotes@test",
      admin,
    );

    const attached = await attachModifierGroupToProduct(
      db,
      quotes.tenant.id,
      product.publicId,
      {
        expectedProductVersion: product.version,
        modifierGroupPublicId: group.publicId,
      },
      "admin.quotes@test",
      admin,
    );

    expect(attached.modifierGroups).toHaveLength(1);

    const updated = await updateModifierGroup(
      db,
      quotes.tenant.id,
      group.publicId,
      {
        expectedVersion: group.version,
        maxSelections: 2,
      },
      "admin.quotes@test",
      admin,
    );

    expect(updated.affectedProductCount).toBe(1);
  });

  it("loads flower fixture modifier groups through product assignment APIs", async () => {
    const { tenantId } = await seedFlowerDevTenant(db);
    await seedStaffMember(
      tenantId,
      "administrator",
      "admin.flowers@test",
      "admin.flowers@test",
    );

    const view = await listProductModifierGroups(
      db,
      tenantId,
      flowerRoseBouquetFixture.productPublicId,
    );

    expect(view.modifierGroups).toHaveLength(1);
    expect(view.modifierGroups[0]?.options).toHaveLength(2);

    const group = await getModifierGroup(
      db,
      tenantId,
      flowerRoseBouquetFixture.modifierGroup.publicId,
    );

    expect(group.translations.en.displayName).toBe("Gift Wrapping");
  });

  it("requires administrator membership to set modifier option prices", async () => {
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

    const group = await createModifierGroup(
      db,
      quotes.tenant.id,
      {
        internalName: "syrup",
        translations: {
          en: { displayName: "Syrup" },
          ar: { displayName: "شراب" },
        },
      },
      "admin.quotes@test",
      admin,
    );

    await expect(
      createModifierOption(
        db,
        quotes.tenant.id,
        group.publicId,
        {
          expectedGroupVersion: group.version,
          translations: {
            en: { displayName: "Vanilla" },
            ar: { displayName: "فانيلا" },
          },
          priceMinor: 200,
        },
        "user.quotes@test",
        user,
      ),
    ).rejects.toBeInstanceOf(StaffAuthorizationError);
  });
});
