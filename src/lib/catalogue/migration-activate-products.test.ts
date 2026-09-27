import { beforeAll, afterAll, beforeEach, describe, expect, test } from "vitest";
import { eq, and } from "drizzle-orm";

import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { seedQuotesDevTenant } from "@/lib/seed/dev-tenants";
import { importQuotesHbzFineDineMenu } from "@/lib/catalogue/finedine-hbz-import";
import {
  catalogueProducts,
  catalogueMenus,
  catalogueMenuSections,
  catalogueMenuSectionProducts,
  catalogueMenuLiveRevisions,
} from "@/db/schema";

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
    tenantId = seed.tenant.id;

    await importQuotesHbzFineDineMenu(testDb, {
      tenantId,
      staffSubject: "test@quotes.com",
      useLiveSource: false,
    });
  });

  test("identifies draft products in published menus", async () => {
    const productsInPublishedMenus = await testSqlClient<
      Array<{ id: string; public_id: string; status: string }>
    >`
      SELECT DISTINCT cp.id, cp.public_id, cp.status
      FROM qos.catalogue_products cp
      INNER JOIN qos.catalogue_menu_section_products cmsp
        ON cmsp.tenant_id = cp.tenant_id
        AND cmsp.product_id = cp.id
      INNER JOIN qos.catalogue_menu_sections cms
        ON cms.tenant_id = cmsp.tenant_id
        AND cms.id = cmsp.section_id
      INNER JOIN qos.catalogue_menu_live_revisions cmlr
        ON cmlr.tenant_id = cms.tenant_id
        AND cmlr.menu_id = cms.menu_id
      WHERE cp.tenant_id = ${tenantId}
        AND cp.status = 'draft'
    `;

    expect(productsInPublishedMenus.length).toBeGreaterThan(0);
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

    await testSqlClient`
      UPDATE qos.catalogue_products
      SET 
        status = 'active',
        updated_at = NOW()
      WHERE
        status = 'draft'
        AND tenant_id = ${tenantId}
        AND id IN (
          SELECT DISTINCT cp.id
          FROM qos.catalogue_products cp
          INNER JOIN qos.catalogue_menu_section_products cmsp
            ON cmsp.tenant_id = cp.tenant_id
            AND cmsp.product_id = cp.id
          INNER JOIN qos.catalogue_menu_sections cms
            ON cms.tenant_id = cmsp.tenant_id
            AND cms.id = cmsp.section_id
          INNER JOIN qos.catalogue_menu_live_revisions cmlr
            ON cmlr.tenant_id = cms.tenant_id
            AND cmlr.menu_id = cms.menu_id
          WHERE cp.status = 'draft'
        )
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

    const stillDraft = await testSqlClient<
      Array<{ id: string; public_id: string }>
    >`
      SELECT DISTINCT cp.id, cp.public_id
      FROM qos.catalogue_products cp
      INNER JOIN qos.catalogue_menu_section_products cmsp
        ON cmsp.tenant_id = cp.tenant_id
        AND cmsp.product_id = cp.id
      INNER JOIN qos.catalogue_menu_sections cms
        ON cms.tenant_id = cmsp.tenant_id
        AND cms.id = cmsp.section_id
      INNER JOIN qos.catalogue_menu_live_revisions cmlr
        ON cmlr.tenant_id = cms.tenant_id
        AND cmlr.menu_id = cms.menu_id
      WHERE cp.tenant_id = ${tenantId}
        AND cp.status = 'draft'
    `;

    expect(stillDraft.length).toBe(0);
  });

  test("migration is idempotent", async () => {
    const migrationSql = `
      UPDATE qos.catalogue_products
      SET 
        status = 'active',
        updated_at = NOW()
      WHERE
        status = 'draft'
        AND tenant_id IS NOT NULL
        AND id IN (
          SELECT DISTINCT cp.id
          FROM qos.catalogue_products cp
          INNER JOIN qos.catalogue_menu_section_products cmsp
            ON cmsp.tenant_id = cp.tenant_id
            AND cmsp.product_id = cp.id
          INNER JOIN qos.catalogue_menu_sections cms
            ON cms.tenant_id = cmsp.tenant_id
            AND cms.id = cmsp.section_id
          INNER JOIN qos.catalogue_menu_live_revisions cmlr
            ON cmlr.tenant_id = cms.tenant_id
            AND cmlr.menu_id = cms.menu_id
          WHERE cp.status = 'draft'
        )
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
