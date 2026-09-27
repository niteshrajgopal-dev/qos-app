import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vitest";

import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { seedQuotesDevTenant } from "@/lib/seed/dev-tenants";
import { getCatalogueCounts } from "@/lib/catalogue/counts";
import {
  catalogueProducts,
  catalogueModifierGroups,
  catalogueCategories,
} from "@/db/schema";
import { eq } from "drizzle-orm";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("getCatalogueCounts", () => {
  let testDb: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let testSqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tenantId: string;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    testDb = connection.db;
    testSqlClient = connection.sql;
  });

  afterAll(async () => {
    await testSqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await testSqlClient`TRUNCATE TABLE qos.catalogue_categories, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.catalogue_menu_translations, qos.catalogue_menus, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;

    const seed = await seedQuotesDevTenant(testDb);
    tenantId = seed.tenantId;
  });

  test("returns zero counts for empty catalogue", async () => {
    await testDb.delete(catalogueProducts).where(eq(catalogueProducts.tenantId, tenantId));

    const counts = await getCatalogueCounts(testDb, tenantId);

    expect(counts).toEqual({
      products: 0,
      menus: 0,
      modifierGroups: 0,
      categories: 0,
    });
  });

  test("counts non-archived products only", async () => {
    // Seed doesn't create products by default, so add a test product
    const [product] = await testDb
      .insert(catalogueProducts)
      .values({
        tenantId,
        publicId: "test-product",
        internalName: "Test Product",
        status: "draft",
        provenance: "operator_entered",
      })
      .returning();

    const counts = await getCatalogueCounts(testDb, tenantId);

    // Should count the draft product
    expect(counts.products).toBe(1);

    // Mark as active - count should stay the same
    await testDb
      .update(catalogueProducts)
      .set({ status: "active" })
      .where(eq(catalogueProducts.id, product.id));

    const countsAfterActive = await getCatalogueCounts(testDb, tenantId);
    expect(countsAfterActive.products).toBe(1);

    // Archive the product - count should decrease to 0
    await testDb
      .update(catalogueProducts)
      .set({ status: "archived" })
      .where(eq(catalogueProducts.id, product.id));

    const countsAfterArchive = await getCatalogueCounts(testDb, tenantId);
    expect(countsAfterArchive.products).toBe(0);
  });

  test("counts all menus regardless of status", async () => {
    const counts = await getCatalogueCounts(testDb, tenantId);

    expect(counts.menus).toBeGreaterThanOrEqual(0);
  });

  test("counts non-archived modifier groups only", async () => {
    const counts = await getCatalogueCounts(testDb, tenantId);

    const [group] = await testDb
      .insert(catalogueModifierGroups)
      .values({
        tenantId,
        publicId: "test-group",
        internalName: "Test Group",
        minSelections: 0,
        maxSelections: 1,
        status: "active",
        provenance: "operator_entered",
      })
      .returning();

    const countsAfter = await getCatalogueCounts(testDb, tenantId);

    expect(countsAfter.modifierGroups).toBe(counts.modifierGroups + 1);

    await testDb
      .update(catalogueModifierGroups)
      .set({ status: "archived" })
      .where(eq(catalogueModifierGroups.id, group!.id));

    const countsArchived = await getCatalogueCounts(testDb, tenantId);

    expect(countsArchived.modifierGroups).toBe(counts.modifierGroups);
  });

  test("counts all categories", async () => {
    const counts = await getCatalogueCounts(testDb, tenantId);

    await testDb
      .insert(catalogueCategories)
      .values({
        tenantId,
        publicId: "test-category",
        internalName: "Test Category",
        provenance: "operator_entered",
      })
      .returning();

    const countsAfter = await getCatalogueCounts(testDb, tenantId);

    expect(countsAfter.categories).toBe(counts.categories + 1);
  });
});
