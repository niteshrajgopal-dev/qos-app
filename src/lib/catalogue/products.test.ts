import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  brands,
  catalogueMenuLiveRevisions,
  catalogueMenus,
  catalogueProducts,
  locations,
  staffIdentities,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { eq } from "drizzle-orm";
import {
  CATALOGUE_PRODUCT_ARCHIVE_CODES,
  CATALOGUE_PRODUCT_RESTORE_CODES,
  CatalogueProductConflictError,
  CatalogueProductError,
  archiveDraftProduct,
  createDraftProduct,
  getDraftProduct,
  restoreArchivedProduct,
  updateDraftProduct,
} from "@/lib/catalogue/products";
import { getCatalogueCounts } from "@/lib/catalogue/counts";
import {
  listArchivedCatalogueProductSummaries,
  listCatalogueProductSummaries,
} from "@/lib/catalogue/repository";
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
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_menu_live_revisions, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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
      "admin.quotes@test",
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
      }, "admin.quotes@test"),
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
      }, "user.quotes@test"),
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
      "user.quotes@test",
    );

    expect(updated.translations.ar.displayName).toBe("فلات وايت محدث");
    expect(updated.translations.ar.translationVersion).toBe(2);
    expect(updated.defaultVariant.amountMinor).toBe(1800);
    expect(updated.translations.en.translationVersion).toBe(1);
  });

  it("loads draft product detail under qos_app RLS when tenant context is set", async () => {
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

    await runAsRole(sqlClient, "qos_app", async () => {
      const product = await getDraftProduct(
        db,
        quotes.tenant.id,
        admin,
        created.publicId,
      );

      expect(product.publicId).toBe(created.publicId);
      expect(product.translations.en.displayName).toBe("Flat White");
    });
  });

  it("archives draft products, blocks active or published-menu drafts, and records audit events", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.archive@test",
      "admin.archive@test",
    );

    const draft = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    const archived = await archiveDraftProduct(
      db,
      quotes.tenant.id,
      draft.publicId,
      "admin.archive@test",
    );

    expect(archived).toEqual({
      publicId: draft.publicId,
      status: "archived",
      version: draft.version + 1,
    });

    const summaries = await listCatalogueProductSummaries(db, quotes.tenant.id);
    expect(summaries.some((row) => row.publicId === draft.publicId)).toBe(false);

    const counts = await getCatalogueCounts(db, quotes.tenant.id);
    expect(counts.products).toBe(0);

    const [audit] = await db
      .select()
      .from(tenantAuditEvents)
      .where(eq(tenantAuditEvents.action, "catalogue.product.archived"));

    expect(audit?.entityPublicId).toBe(draft.publicId);
    expect(audit?.actorSubject).toBe("admin.archive@test");

    await expect(
      archiveDraftProduct(
        db,
        quotes.tenant.id,
        draft.publicId,
        "admin.archive@test",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: CATALOGUE_PRODUCT_ARCHIVE_CODES.ALREADY_ARCHIVED,
    });

    const activeDraft = await createDraftProduct(db, quotes.tenant.id, admin, {
      ...baseProductInput,
      internalName: "active-product",
    });
    await db
      .update(catalogueProducts)
      .set({ status: "active" })
      .where(eq(catalogueProducts.publicId, activeDraft.publicId));

    await expect(
      archiveDraftProduct(
        db,
        quotes.tenant.id,
        activeDraft.publicId,
        "admin.archive@test",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: CATALOGUE_PRODUCT_ARCHIVE_CODES.NOT_DRAFT,
    });

    const publishedDraft = await createDraftProduct(db, quotes.tenant.id, admin, {
      ...baseProductInput,
      internalName: "published-menu-draft",
    });

    const [brand] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.tenantId, quotes.tenant.id))
      .limit(1);
    const [location] = await db
      .select({ id: locations.id, publicId: locations.publicId })
      .from(locations)
      .where(eq(locations.tenantId, quotes.tenant.id))
      .limit(1);

    if (!brand || !location) {
      throw new Error("Missing brand or location for published menu fixture.");
    }

    const [menu] = await db
      .insert(catalogueMenus)
      .values({
        tenantId: quotes.tenant.id,
        brandId: brand.id,
        publicId: "archive-test-menu",
        internalName: "Archive Test Menu",
        provenance: "operator_entered",
      })
      .returning();

    await db.insert(catalogueMenuLiveRevisions).values({
      tenantId: quotes.tenant.id,
      menuId: menu.id,
      locationId: location.id,
      sourceVersion: 1,
      publishedBySubject: "admin.archive@test",
      payload: {
        menuPublicId: menu.publicId,
        locationPublicId: location.publicId,
        version: 1,
        translations: {
          en: { displayName: "Menu", description: null },
          ar: { displayName: "قائمة", description: null },
        },
        sections: [
          {
            publicId: "section-1",
            sortOrder: 0,
            translations: {
              en: { displayName: "Section", description: null },
              ar: { displayName: "قسم", description: null },
            },
            products: [
              {
                productPublicId: publishedDraft.publicId,
                sortOrder: 0,
                translations: {
                  en: { displayName: "Published draft", description: null },
                  ar: { displayName: "مسودة", description: null },
                },
                price: {
                  amountMinor: 1000,
                  currency: "AED",
                  inheritanceMode: "inherited",
                },
                mediaAssetId: null,
              },
            ],
          },
        ],
      },
    });

    await expect(
      archiveDraftProduct(
        db,
        quotes.tenant.id,
        publishedDraft.publicId,
        "admin.archive@test",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: CATALOGUE_PRODUCT_ARCHIVE_CODES.IN_PUBLISHED_MENU,
    });

    await expect(
      archiveDraftProduct(
        db,
        flowers.tenant.id,
        draft.publicId,
        "admin.archive@test",
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it("restores archived products to draft with audit events and tenant isolation", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const admin = await seedStaffMember(
      quotes.tenant.id,
      "administrator",
      "admin.restore@test",
      "admin.restore@test",
    );
    const draft = await createDraftProduct(
      db,
      quotes.tenant.id,
      admin,
      baseProductInput,
    );

    await archiveDraftProduct(
      db,
      quotes.tenant.id,
      draft.publicId,
      "admin.restore@test",
    );

    const archivedSummaries = await listArchivedCatalogueProductSummaries(
      db,
      quotes.tenant.id,
    );
    expect(archivedSummaries.map((row) => row.publicId)).toContain(
      draft.publicId,
    );

    const restored = await restoreArchivedProduct(
      db,
      quotes.tenant.id,
      draft.publicId,
      "admin.restore@test",
    );

    expect(restored).toEqual({
      publicId: draft.publicId,
      status: "draft",
      version: draft.version + 2,
    });

    const summaries = await listCatalogueProductSummaries(db, quotes.tenant.id);
    expect(summaries.some((row) => row.publicId === draft.publicId)).toBe(true);

    const [audit] = await db
      .select()
      .from(tenantAuditEvents)
      .where(eq(tenantAuditEvents.action, "catalogue.product.restored"));

    expect(audit?.entityPublicId).toBe(draft.publicId);
    expect(audit?.actorSubject).toBe("admin.restore@test");

    await expect(
      restoreArchivedProduct(
        db,
        quotes.tenant.id,
        draft.publicId,
        "admin.restore@test",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: CATALOGUE_PRODUCT_RESTORE_CODES.NOT_ARCHIVED,
    });

    await expect(
      restoreArchivedProduct(
        db,
        flowers.tenant.id,
        draft.publicId,
        "admin.restore@test",
      ),
    ).rejects.toMatchObject({
      statusCode: 404,
    });

    const activeDraft = await createDraftProduct(db, quotes.tenant.id, admin, {
      ...baseProductInput,
      internalName: "restore-active-product",
    });
    await db
      .update(catalogueProducts)
      .set({ status: "active" })
      .where(eq(catalogueProducts.publicId, activeDraft.publicId));

    await expect(
      restoreArchivedProduct(
        db,
        quotes.tenant.id,
        activeDraft.publicId,
        "admin.restore@test",
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: CATALOGUE_PRODUCT_RESTORE_CODES.NOT_ARCHIVED,
    });

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
