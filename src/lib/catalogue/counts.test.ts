import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { db, sqlClient } from "@/db";
import { integrationDescribe } from "@/lib/test/postgres-container";
import { seedQuotesDevTenant } from "@/lib/seed/dev-tenants";
import { getCatalogueCounts } from "@/lib/catalogue/counts";
import {
  catalogueProducts,
  catalogueMenus,
  catalogueModifierGroups,
  catalogueCategories,
} from "@/db/schema";
import { eq } from "drizzle-orm";

integrationDescribe("getCatalogueCounts", () => {
  let tenantId: string;

  beforeEach(async () => {
    const seed = await seedQuotesDevTenant(db);
    tenantId = seed.tenant.id;
  });

  afterEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.catalogue_categories, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.catalogue_menu_translations, qos.catalogue_menus, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  test("returns zero counts for empty catalogue", async () => {
    await db.delete(catalogueProducts).where(eq(catalogueProducts.tenantId, tenantId));

    const counts = await getCatalogueCounts(db, tenantId);

    expect(counts).toEqual({
      products: 0,
      menus: 0,
      modifierGroups: 0,
      categories: 0,
    });
  });

  test("counts active products only", async () => {
    const counts = await getCatalogueCounts(db, tenantId);

    expect(counts.products).toBe(0);

    await db
      .update(catalogueProducts)
      .set({ status: "active" })
      .where(eq(catalogueProducts.tenantId, tenantId));

    const countsAfter = await getCatalogueCounts(db, tenantId);

    expect(countsAfter.products).toBeGreaterThan(0);
  });

  test("counts all menus regardless of status", async () => {
    const counts = await getCatalogueCounts(db, tenantId);

    expect(counts.menus).toBeGreaterThanOrEqual(0);
  });

  test("counts active modifier groups only", async () => {
    const counts = await getCatalogueCounts(db, tenantId);

    const [group] = await db
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

    const countsAfter = await getCatalogueCounts(db, tenantId);

    expect(countsAfter.modifierGroups).toBe(counts.modifierGroups + 1);

    await db
      .update(catalogueModifierGroups)
      .set({ status: "archived" })
      .where(eq(catalogueModifierGroups.id, group!.id));

    const countsArchived = await getCatalogueCounts(db, tenantId);

    expect(countsArchived.modifierGroups).toBe(counts.modifierGroups);
  });

  test("counts all categories", async () => {
    const counts = await getCatalogueCounts(db, tenantId);

    const [category] = await db
      .insert(catalogueCategories)
      .values({
        tenantId,
        publicId: "test-category",
        internalName: "Test Category",
        provenance: "operator_entered",
      })
      .returning();

    const countsAfter = await getCatalogueCounts(db, tenantId);

    expect(countsAfter.categories).toBe(counts.categories + 1);
  });
});
