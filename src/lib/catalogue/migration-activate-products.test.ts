import { beforeAll, afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";

import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { seedQuotesDevTenant } from "@/lib/seed/dev-tenants";
import { brands, catalogueProducts, catalogueMenus, locations } from "@/db/schema";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("migration: activate published products", () => {
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
    await testSqlClient`TRUNCATE TABLE qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_variant_location_price_overrides, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;

    const seed = await seedQuotesDevTenant(testDb);
    tenantId = seed.tenantId;

    // Get brand and location
    const [brand] = await testDb
      .select({ id: brands.id })
      .from(brands)
      .where(eq(brands.tenantId, tenantId))
      .limit(1);

    const [location] = await testDb
      .select({ id: locations.id, publicId: locations.publicId })
      .from(locations)
      .where(eq(locations.tenantId, tenantId))
      .limit(1);

    if (!brand || !location) {
      throw new Error("No brand or location found for tenant");
    }

    // Create a menu
    const [menu] = await testDb
      .insert(catalogueMenus)
      .values({
        tenantId,
        brandId: brand.id,
        publicId: "test-menu",
        internalName: "Test Menu",
        provenance: "operator_entered",
      })
      .returning();

    // Create a minimal published menu payload
    const payload = {
      menuPublicId: menu.publicId,
      locationPublicId: location.publicId,
      version: 1,
      translations: {
        en: { displayName: "Test Menu", description: null },
        ar: { displayName: "قائمة", description: null },
      },
      sections: [
        {
          publicId: "test-section",
          sortOrder: 0,
          translations: {
            en: { displayName: "Test Section", description: null },
            ar: { displayName: "قسم", description: null },
          },
          products: [
            {
              productPublicId: "test-product-1",
              sortOrder: 0,
              translations: {
                en: { displayName: "Product 1", description: null },
                ar: { displayName: "منتج 1", description: null },
              },
              price: { amountMinor: 1000, currency: "AED", inheritanceMode: "inherited" as const },
              mediaAssetId: null,
            },
            {
              productPublicId: "test-product-2",
              sortOrder: 1,
              translations: {
                en: { displayName: "Product 2", description: null },
                ar: { displayName: "منتج 2", description: null },
              },
              price: { amountMinor: 2000, currency: "AED", inheritanceMode: "inherited" as const },
              mediaAssetId: null,
            },
          ],
        },
      ],
    };

    // Insert the live revision with payload
    await testSqlClient`
      INSERT INTO qos.catalogue_menu_live_revisions (tenant_id, menu_id, location_id, source_version, payload, published_by_subject)
      VALUES (${tenantId}, ${menu.id}, ${location.id}, 1, ${JSON.stringify(payload)}::jsonb, 'test@test.com')
    `;

    // Create the draft products that the migration should activate
    await testDb.insert(catalogueProducts).values([
      {
        tenantId,
        brandId: brand.id,
        publicId: "test-product-1",
        internalName: "Product 1",
        status: "draft",
        provenance: "operator_entered",
      },
      {
        tenantId,
        brandId: brand.id,
        publicId: "test-product-2",
        internalName: "Product 2",
        status: "draft",
        provenance: "operator_entered",
      },
    ]);
  });

  test("identifies draft products in published menus", async () => {
    const productsInPublishedMenus = await testSqlClient<
      Array<{ product_public_id: string }>
    >`
      SELECT DISTINCT
        jsonb_array_elements(
          jsonb_array_elements(payload->'sections')->'products'
        )->>'productPublicId' AS product_public_id
      FROM qos.catalogue_menu_live_revisions
      WHERE tenant_id = ${tenantId}
    `;

    expect(productsInPublishedMenus.length).toBeGreaterThan(0);

    const draftProducts = await testSqlClient<
      Array<{ public_id: string }>
    >`
      SELECT public_id
      FROM qos.catalogue_products
      WHERE tenant_id = ${tenantId}
        AND status = 'draft'
        AND public_id IN (
          SELECT DISTINCT
            jsonb_array_elements(
              jsonb_array_elements(payload->'sections')->'products'
            )->>'productPublicId'
          FROM qos.catalogue_menu_live_revisions
          WHERE tenant_id = ${tenantId}
        )
    `;

    expect(draftProducts.length).toBeGreaterThan(0);
  });

  test("migration updates only draft products in published menus", async () => {
    const beforeCounts = await testSqlClient<
      Array<{ status: string; count: string }>
    >`
      SELECT status, COUNT(*)::text as count
      FROM qos.catalogue_products
      WHERE tenant_id = ${tenantId}
      GROUP BY status
    `;

    const draftCountBefore =
      beforeCounts.find((row) => row.status === "draft")?.count ?? "0";

    // Run the migration
    await testSqlClient`
      WITH published_product_ids AS (
        SELECT DISTINCT
          jsonb_array_elements(
            jsonb_array_elements(payload->'sections')->'products'
          )->>'productPublicId' AS product_public_id
        FROM qos.catalogue_menu_live_revisions
      )
      UPDATE qos.catalogue_products
      SET 
        status = 'active',
        updated_at = NOW()
      WHERE
        status = 'draft'
        AND public_id IN (SELECT product_public_id FROM published_product_ids)
    `;

    const afterCounts = await testSqlClient<
      Array<{ status: string; count: string }>
    >`
      SELECT status, COUNT(*)::text as count
      FROM qos.catalogue_products
      WHERE tenant_id = ${tenantId}
      GROUP BY status
    `;

    const draftCountAfter =
      afterCounts.find((row) => row.status === "draft")?.count ?? "0";
    const activeCountAfter =
      afterCounts.find((row) => row.status === "active")?.count ?? "0";

    expect(parseInt(draftCountAfter)).toBeLessThan(parseInt(draftCountBefore));
    expect(parseInt(activeCountAfter)).toBeGreaterThan(0);

    // Verify no draft products remain in published menus
    const stillDraft = await testSqlClient<
      Array<{ public_id: string }>
    >`
      SELECT public_id
      FROM qos.catalogue_products
      WHERE tenant_id = ${tenantId}
        AND status = 'draft'
        AND public_id IN (
          SELECT DISTINCT
            jsonb_array_elements(
              jsonb_array_elements(payload->'sections')->'products'
            )->>'productPublicId'
          FROM qos.catalogue_menu_live_revisions
          WHERE tenant_id = ${tenantId}
        )
    `;

    expect(stillDraft.length).toBe(0);
  });

  test("migration is idempotent", async () => {
    const migrationSql = `
      WITH published_product_ids AS (
        SELECT DISTINCT
          jsonb_array_elements(
            jsonb_array_elements(payload->'sections')->'products'
          )->>'productPublicId' AS product_public_id
        FROM qos.catalogue_menu_live_revisions
      )
      UPDATE qos.catalogue_products
      SET 
        status = 'active',
        updated_at = NOW()
      WHERE
        status = 'draft'
        AND public_id IN (SELECT product_public_id FROM published_product_ids)
    `;

    await testSqlClient.unsafe(migrationSql);

    const countsAfterFirst = await testSqlClient<
      Array<{ status: string; count: string }>
    >`
      SELECT status, COUNT(*)::text as count
      FROM qos.catalogue_products
      WHERE tenant_id = ${tenantId}
      GROUP BY status
    `;

    await testSqlClient.unsafe(migrationSql);

    const countsAfterSecond = await testSqlClient<
      Array<{ status: string; count: string }>
    >`
      SELECT status, COUNT(*)::text as count
      FROM qos.catalogue_products
      WHERE tenant_id = ${tenantId}
      GROUP BY status
    `;

    expect(countsAfterSecond).toEqual(countsAfterFirst);
  });
});
