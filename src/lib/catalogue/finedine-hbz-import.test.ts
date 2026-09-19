import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

import {
  catalogueImportSourceLinks,
  catalogueMediaAssets,
  catalogueMenuSections,
  catalogueMenus,
  catalogueProducts,
  locations,
} from "@/db/schema";
import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";
import { importQuotesHbzFineDineMenu } from "@/lib/catalogue/finedine-hbz-import";

vi.mock("@/lib/media/product-images", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/media/product-images")>();
  const { catalogueMediaAssets, catalogueProducts } = await import(
    "@/db/schema"
  );
  const { and: andOp, eq: eqOp } = await import("drizzle-orm");

  return {
    ...actual,
    ingestProductImageFromRemoteUrl: vi.fn(
      async (
        db: Parameters<typeof actual.ingestProductImageFromRemoteUrl>[0],
        tenantId: string,
        _membership: Parameters<
          typeof actual.ingestProductImageFromRemoteUrl
        >[2],
        productPublicId: string,
      ) => {
        const [product] = await db
          .select({
            id: catalogueProducts.id,
            primaryMediaAssetId: catalogueProducts.primaryMediaAssetId,
          })
          .from(catalogueProducts)
          .where(
            andOp(
              eqOp(catalogueProducts.tenantId, tenantId),
              eqOp(catalogueProducts.publicId, productPublicId),
            ),
          )
          .limit(1);

        if (product?.primaryMediaAssetId) {
          return {
            assetPublicId: `mas_${productPublicId.slice(-12)}`,
            status: "approved" as const,
            derivatives: [
              {
                kind: "thumbnail" as const,
                publicDerivativeId: `mda_${productPublicId.slice(-12)}`,
              },
            ],
          };
        }

        const [asset] = await db
          .insert(catalogueMediaAssets)
          .values({
            tenantId,
            productId: product!.id,
            publicId: `mas_${productPublicId.replace(/[^a-z0-9]/gi, "").slice(-16)}`,
            status: "approved",
            sourceProvenance: "imported",
          })
          .returning();

        await db
          .update(catalogueProducts)
          .set({ primaryMediaAssetId: asset.id })
          .where(
            andOp(
              eqOp(catalogueProducts.tenantId, tenantId),
              eqOp(catalogueProducts.publicId, productPublicId),
            ),
          );

        return {
          assetPublicId: asset.publicId,
          status: "approved" as const,
          derivatives: [
            {
              kind: "thumbnail" as const,
              publicDerivativeId: `mda_${productPublicId.slice(-12)}`,
            },
          ],
        };
      },
    ),
  };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("quotes hbz finedine import", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_import_source_links, qos.catalogue_import_operations, qos.catalogue_media_derivatives, qos.catalogue_media_upload_grants, qos.catalogue_media_assets, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  it("imports draft products and an HBZ draft menu without duplicates on replay", async () => {
    const first = await importQuotesHbzFineDineMenu(db, {
      idempotencyKey: "hbz-import-001",
    });

    expect(first.productCount).toBe(147);
    expect(first.sectionCount).toBeGreaterThan(0);
    expect(first.createdMenu).toBe(true);
    expect(first.importReport.createCount).toBe(147);
    expect(first.importReport.errorCount).toBe(0);
    expect(first.replayedImport).toBe(false);

    const [location] = await db
      .select()
      .from(locations)
      .where(eq(locations.publicId, QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId))
      .limit(1);

    expect(location?.slug).toBe("hbz-stadium");

    const productCount = await db
      .select({ id: catalogueProducts.id })
      .from(catalogueProducts);
    expect(productCount).toHaveLength(147);

    const sourceLinks = await db
      .select()
      .from(catalogueImportSourceLinks)
      .where(
        eq(
          catalogueImportSourceLinks.connectionKey,
          QUOTES_HBZ_FINEDINE_IMPORT.connectionKey,
        ),
      );
    expect(sourceLinks).toHaveLength(147);
    const mediaAfterFirstRun = await db.select().from(catalogueMediaAssets);
    expect(mediaAfterFirstRun.length).toBeGreaterThan(0);

    const [menu] = await db
      .select()
      .from(catalogueMenus)
      .where(eq(catalogueMenus.publicId, first.menuPublicId))
      .limit(1);

    expect(menu?.status).toBe("draft");
    expect(menu?.internalName).toBe(
      QUOTES_HBZ_FINEDINE_IMPORT.menuInternalName,
    );

    const sections = await db
      .select()
      .from(catalogueMenuSections)
      .where(eq(catalogueMenuSections.menuId, menu!.id));

    expect(sections.length).toBe(first.sectionCount);

    const replay = await importQuotesHbzFineDineMenu(db, {
      idempotencyKey: "hbz-import-001",
    });

    expect(replay.replayedImport).toBe(true);
    expect(replay.createdMenu).toBe(false);
    expect(replay.menuPublicId).toBe(first.menuPublicId);
    expect(replay.importReport.createCount).toBe(147);

    const secondRun = await importQuotesHbzFineDineMenu(db, {
      idempotencyKey: "hbz-import-002",
    });

    expect(secondRun.importReport.createCount).toBe(0);
    expect(secondRun.importReport.unchangedCount).toBe(147);
    expect(secondRun.menuPublicId).toBe(first.menuPublicId);

    const productsAfterSecondRun = await db
      .select({ id: catalogueProducts.id })
      .from(catalogueProducts);
    expect(productsAfterSecondRun).toHaveLength(147);

    expect(await db.select().from(catalogueMediaAssets)).toHaveLength(
      mediaAfterFirstRun.length,
    );
    expect(
      await db
        .select()
        .from(catalogueImportSourceLinks)
        .where(
          eq(
            catalogueImportSourceLinks.connectionKey,
            QUOTES_HBZ_FINEDINE_IMPORT.connectionKey,
          ),
        ),
    ).toHaveLength(147);
  }, 30_000);
});
