import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
} from "@/db/test-utils";
import {
  attachModifierGroupToProduct,
  CatalogueModifierConflictError,
  CatalogueModifierError,
  createModifierGroup,
  createModifierOption,
  deleteModifierGroup,
  detachModifierGroupFromProduct,
  getModifierGroup,
  listModifierGroups,
  listProductModifierGroups,
  MODIFIER_GROUP_ASSIGNED_CODE,
  updateModifierGroup,
} from "@/lib/catalogue/modifiers";
import { validateModifierGroupSelections } from "@/lib/catalogue/modifier-selection";
import { createDraftProduct } from "@/lib/catalogue/products";
import { seedFlowerDevTenant } from "@/lib/seed/dev-tenants";
import { flowerRoseBouquetFixture } from "@/lib/seed/fixtures/flower-catalogue";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import {
  flowerTenantFixture,
  quotesTenantFixture,
} from "@/lib/tenant/fixtures";
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
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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

  describe("deleteModifierGroup", () => {
    type StaffMember = Awaited<ReturnType<typeof seedStaffMember>>;

    async function modifierRowCounts(tenantId: string) {
      const [row] = await sqlClient<
        {
          groups: number;
          groupTranslations: number;
          options: number;
          optionTranslations: number;
          assignments: number;
        }[]
      >`
        SELECT
          (SELECT count(*)::int FROM qos.catalogue_modifier_groups WHERE tenant_id = ${tenantId}) AS "groups",
          (SELECT count(*)::int FROM qos.catalogue_modifier_group_translations WHERE tenant_id = ${tenantId}) AS "groupTranslations",
          (SELECT count(*)::int FROM qos.catalogue_modifier_options WHERE tenant_id = ${tenantId}) AS "options",
          (SELECT count(*)::int FROM qos.catalogue_modifier_option_translations WHERE tenant_id = ${tenantId}) AS "optionTranslations",
          (SELECT count(*)::int FROM qos.catalogue_product_modifier_groups WHERE tenant_id = ${tenantId}) AS "assignments"
      `;
      return row;
    }

    async function deleteAuditEvents(tenantId: string) {
      return sqlClient<
        {
          entityPublicId: string;
          entityVersion: number | null;
          actorSubject: string;
          changeSummary: Record<string, unknown>;
        }[]
      >`
        SELECT entity_public_id AS "entityPublicId", entity_version AS "entityVersion",
               actor_subject AS "actorSubject", change_summary AS "changeSummary"
        FROM qos.tenant_audit_events
        WHERE tenant_id = ${tenantId} AND action = 'catalogue.modifier_group.delete'
      `;
    }

    async function seedGroupWithTwoOptions(
      tenantId: string,
      member: StaffMember,
      subject: string,
      publicId = "modgrp_milk_type",
    ) {
      const group = await createModifierGroup(
        db,
        tenantId,
        {
          internalName: "milk-type",
          publicId,
          minSelections: 0,
          maxSelections: 1,
          translations: {
            en: { displayName: "Milk Type" },
            ar: { displayName: "نوع الحليب" },
          },
        },
        subject,
        member,
      );
      const withOat = await createModifierOption(
        db,
        tenantId,
        group.publicId,
        {
          expectedGroupVersion: group.version,
          publicId: "modopt_oat_milk",
          translations: {
            en: { displayName: "Oat" },
            ar: { displayName: "شوفان" },
          },
          priceMinor: 300,
        },
        subject,
        member,
      );
      return createModifierOption(
        db,
        tenantId,
        group.publicId,
        {
          expectedGroupVersion: withOat.version,
          publicId: "modopt_almond_milk",
          translations: {
            en: { displayName: "Almond" },
            ar: { displayName: "لوز" },
          },
          priceMinor: 350,
        },
        subject,
        member,
      );
    }

    it("removes the group, its options and translations, and audits it in the same transaction", async () => {
      const quotes = await createTenantHierarchy(db, quotesTenantFixture());
      const user = await seedStaffMember(
        quotes.tenant.id,
        "user",
        "user.quotes@test",
        "user.quotes@test",
      );
      const admin = await seedStaffMember(
        quotes.tenant.id,
        "administrator",
        "admin.quotes@test",
        "admin.quotes@test",
      );
      const group = await seedGroupWithTwoOptions(
        quotes.tenant.id,
        admin,
        "admin.quotes@test",
      );

      expect(group.affectedProductCount).toBe(0);
      expect(await modifierRowCounts(quotes.tenant.id)).toEqual({
        groups: 1,
        groupTranslations: 2,
        options: 2,
        optionTranslations: 4,
        assignments: 0,
      });

      // Any active staff member may delete, matching archive.
      const deleted = await deleteModifierGroup(
        db,
        quotes.tenant.id,
        group.publicId,
        { expectedVersion: group.version },
        "user.quotes@test",
        user,
      );

      expect(deleted).toEqual({
        publicId: "modgrp_milk_type",
        version: group.version,
        optionPublicIds: ["modopt_oat_milk", "modopt_almond_milk"],
      });
      await expect(
        getModifierGroup(db, quotes.tenant.id, group.publicId),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(await modifierRowCounts(quotes.tenant.id)).toEqual({
        groups: 0,
        groupTranslations: 0,
        options: 0,
        optionTranslations: 0,
        assignments: 0,
      });
      expect(await listModifierGroups(db, quotes.tenant.id)).toEqual([]);

      const audits = await deleteAuditEvents(quotes.tenant.id);
      expect(audits).toHaveLength(1);
      expect(audits[0]).toMatchObject({
        entityPublicId: "modgrp_milk_type",
        entityVersion: group.version,
        actorSubject: "user.quotes@test",
        changeSummary: {
          internalName: "milk-type",
          status: "active",
          optionPublicIds: ["modopt_oat_milk", "modopt_almond_milk"],
          optionCount: 2,
          affectedProductCount: 0,
        },
      });
    });

    it("refuses while a product uses the group, then succeeds once it is detached", async () => {
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
      const group = await seedGroupWithTwoOptions(
        quotes.tenant.id,
        admin,
        "admin.quotes@test",
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
      const before = await modifierRowCounts(quotes.tenant.id);
      expect(before.assignments).toBe(1);

      const refusal = await deleteModifierGroup(
        db,
        quotes.tenant.id,
        group.publicId,
        { expectedVersion: group.version },
        "admin.quotes@test",
        admin,
      ).catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(CatalogueModifierConflictError);
      expect(refusal).toMatchObject({
        statusCode: 409,
        field: "affectedProductCount",
        code: MODIFIER_GROUP_ASSIGNED_CODE,
      });
      expect(await modifierRowCounts(quotes.tenant.id)).toEqual(before);
      expect(await deleteAuditEvents(quotes.tenant.id)).toHaveLength(0);

      await detachModifierGroupFromProduct(
        db,
        quotes.tenant.id,
        product.publicId,
        group.publicId,
        attached.productVersion,
        "admin.quotes@test",
        admin,
      );

      const deleted = await deleteModifierGroup(
        db,
        quotes.tenant.id,
        group.publicId,
        { expectedVersion: group.version },
        "admin.quotes@test",
        admin,
      );
      expect(deleted.publicId).toBe(group.publicId);
      expect((await modifierRowCounts(quotes.tenant.id)).groups).toBe(0);
      expect(await deleteAuditEvents(quotes.tenant.id)).toHaveLength(1);
    });

    it("rejects a stale or invalid expectedVersion without removing anything", async () => {
      const quotes = await createTenantHierarchy(db, quotesTenantFixture());
      const admin = await seedStaffMember(
        quotes.tenant.id,
        "administrator",
        "admin.quotes@test",
        "admin.quotes@test",
      );
      const group = await seedGroupWithTwoOptions(
        quotes.tenant.id,
        admin,
        "admin.quotes@test",
      );
      const before = await modifierRowCounts(quotes.tenant.id);

      const stale = await deleteModifierGroup(
        db,
        quotes.tenant.id,
        group.publicId,
        { expectedVersion: group.version + 1 },
        "admin.quotes@test",
        admin,
      ).catch((error: unknown) => error);
      expect(stale).toBeInstanceOf(CatalogueModifierConflictError);
      expect(stale).toMatchObject({ statusCode: 409, field: "expectedVersion" });

      for (const expectedVersion of [0, 1.5, "1"]) {
        const invalid = await deleteModifierGroup(
          db,
          quotes.tenant.id,
          group.publicId,
          { expectedVersion } as unknown as { expectedVersion: number },
          "admin.quotes@test",
          admin,
        ).catch((error: unknown) => error);
        expect(invalid).toBeInstanceOf(CatalogueModifierError);
        expect(invalid).not.toBeInstanceOf(CatalogueModifierConflictError);
        expect(invalid).toMatchObject({ statusCode: 400, field: "expectedVersion" });
      }

      expect(await modifierRowCounts(quotes.tenant.id)).toEqual(before);
      expect(await deleteAuditEvents(quotes.tenant.id)).toHaveLength(0);
    });

    it("only touches the calling tenant's rows", async () => {
      const quotes = await createTenantHierarchy(db, quotesTenantFixture());
      const flower = await createTenantHierarchy(db, flowerTenantFixture());
      const quotesAdmin = await seedStaffMember(
        quotes.tenant.id,
        "administrator",
        "admin.quotes@test",
        "admin.quotes@test",
      );
      const flowerAdmin = await seedStaffMember(
        flower.tenant.id,
        "administrator",
        "admin.flowers@test",
        "admin.flowers@test",
      );
      const quotesGroup = await seedGroupWithTwoOptions(
        quotes.tenant.id,
        quotesAdmin,
        "admin.quotes@test",
        "modgrp_isolation",
      );
      const flowerGroup = await seedGroupWithTwoOptions(
        flower.tenant.id,
        flowerAdmin,
        "admin.flowers@test",
        "modgrp_isolation",
      );
      const flowerBefore = await modifierRowCounts(flower.tenant.id);

      await deleteModifierGroup(
        db,
        quotes.tenant.id,
        "modgrp_isolation",
        { expectedVersion: quotesGroup.version },
        "admin.quotes@test",
        quotesAdmin,
      );

      await expect(
        getModifierGroup(db, quotes.tenant.id, "modgrp_isolation"),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(await modifierRowCounts(flower.tenant.id)).toEqual(flowerBefore);
      const flowerGroups = await listModifierGroups(db, flower.tenant.id);
      expect(flowerGroups.map((entry) => entry.publicId)).toEqual([
        "modgrp_isolation",
      ]);
      const flowerView = await getModifierGroup(
        db,
        flower.tenant.id,
        "modgrp_isolation",
      );
      expect(flowerView.version).toBe(flowerGroup.version);
      expect(flowerView.options.map((option) => option.publicId)).toEqual([
        "modopt_oat_milk",
        "modopt_almond_milk",
      ]);
      expect(await deleteAuditEvents(flower.tenant.id)).toHaveLength(0);
    });

    it("returns 404 for an unknown group and records nothing", async () => {
      const quotes = await createTenantHierarchy(db, quotesTenantFixture());
      const admin = await seedStaffMember(
        quotes.tenant.id,
        "administrator",
        "admin.quotes@test",
        "admin.quotes@test",
      );

      const missing = await deleteModifierGroup(
        db,
        quotes.tenant.id,
        "modgrp_missing",
        { expectedVersion: 1 },
        "admin.quotes@test",
        admin,
      ).catch((error: unknown) => error);

      expect(missing).toBeInstanceOf(CatalogueModifierError);
      expect(missing).toMatchObject({ statusCode: 404 });
      expect(await deleteAuditEvents(quotes.tenant.id)).toHaveLength(0);
    });
  });
});
