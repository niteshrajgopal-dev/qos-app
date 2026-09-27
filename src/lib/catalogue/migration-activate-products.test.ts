import { beforeEach, describe, expect, test } from "vitest";
import { eq, and } from "drizzle-orm";

import { db, sqlClient } from "@/db";
import { integrationDescribe } from "@/lib/test/postgres-container";
import { seedQuotesDevTenant } from "@/lib/seed/dev-tenants";
import { importQuotesHbzFineDineMenu } from "@/lib/catalogue/finedine-hbz-import";
import {
  catalogueProducts,
  catalogueMenus,
  catalogueMenuSections,
  catalogueMenuSectionProducts,
  catalogueMenuLiveRevisions,
} from "@/db/schema";

integrationDescribe("migration: activate published products", () => {
  let tenantId: string;

  beforeEach(async () => {
    const seed = await seedQuotesDevTenant(db);
    tenantId = seed.tenant.id;

    await importQuotesHbzFineDineMenu(db, {
      tenantId,
      staffSubject: "test@quotes.com",
      useLiveSource: false,
    });
  });

  test("identifies draft products in published menus", async () => {
    const productsInPublishedMenus = await sqlClient<
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
    const beforeCounts = await sqlClient<
      Array<{ status: string; count: string }>
    >`
      SELECT status, COUNT(*)::text as count
      FROM qos.catalogue_products
      WHERE tenant_id = ${tenantId}
      GROUP BY status
    `;

    const draftCountBefore =
      beforeCounts.find((row) => row.status === "draft")?.count ?? "0";

    await sqlClient`
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

    const afterCounts = await sqlClient<
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

    const stillDraft = await sqlClient<
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

    await sqlClient.unsafe(migrationSql);

    const countsAfterFirst = await sqlClient<
      Array<{ status: string; count: string }>
    >`
      SELECT status, COUNT(*)::text as count
      FROM qos.catalogue_products
      WHERE tenant_id = ${tenantId}
      GROUP BY status
    `;

    await sqlClient.unsafe(migrationSql);

    const countsAfterSecond = await sqlClient<
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
