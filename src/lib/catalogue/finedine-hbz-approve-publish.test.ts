import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { locations, storefronts } from "@/db/schema";
import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { approveAndPublishQuotesHbzFineDineMenu } from "@/lib/catalogue/finedine-hbz-approve-publish";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";
import { ensureImportStaffAdmin } from "@/lib/catalogue/finedine-hbz-import";
import { createDraftMenu, MenuError } from "@/lib/catalogue/menus";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { createDraftProduct } from "@/lib/catalogue/products";
import { seedQuotesDevTenant } from "@/lib/seed/dev-tenants";
import { defaultStorefrontDraftConfig } from "@/lib/storefront/default-theme";
import { resolveStorefrontManifestByPublicId } from "@/lib/storefront/storefront-manifest-resolver";
import {
  createStorefront,
  publishStorefrontRelease,
} from "@/lib/storefront/storefronts";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const baseProductInputs = [
  {
    internalName: "hbz-approve-latte",
    translations: {
      en: { displayName: "HBZ Latte", description: "Ops approve fixture" },
      ar: { displayName: "لاتيه HBZ", description: "اختبار الموافقة" },
    },
    defaultVariant: { amountMinor: 1800, currency: "AED" },
  },
  {
    internalName: "hbz-approve-croissant",
    translations: {
      en: { displayName: "HBZ Croissant", description: "Ops approve fixture" },
      ar: { displayName: "كرواسون HBZ", description: "اختبار الموافقة" },
    },
    defaultVariant: { amountMinor: 1200, currency: "AED" },
  },
] as const;

integrationDescribe(
  "quotes hbz finedine approve and publish",
  () => {
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
      await sqlClient`TRUNCATE TABLE qos.storefront_published_collections, qos.storefront_locations, qos.storefront_domains, qos.storefront_releases, qos.storefronts, qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_import_source_links, qos.catalogue_import_operations, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    });

    async function ensureQuotesStorefront(
      tenantId: string,
      locationPublicIds: string[],
      publisherSubject: string,
    ) {
      const storefront = await createStorefront(db, tenantId, {
        brandPublicId: QUOTES_HBZ_FINEDINE_IMPORT.brandPublicId,
        internalName: "Quotes Website",
        slug: "quotes",
        defaultLocale: "en",
        supportedLocales: ["en", "ar"],
        draftConfig: defaultStorefrontDraftConfig("hospitality"),
        locationPublicIds,
      });

      await db
        .update(storefronts)
        .set({ publicId: QUOTES_HBZ_FINEDINE_IMPORT.storefrontPublicId })
        .where(eq(storefronts.id, storefront.id));

      await publishStorefrontRelease(
        db,
        tenantId,
        QUOTES_HBZ_FINEDINE_IMPORT.storefrontPublicId,
        publisherSubject,
      );

      return {
        ...storefront,
        publicId: QUOTES_HBZ_FINEDINE_IMPORT.storefrontPublicId,
      };
    }

    async function seedMinimalHbzFineDineDraftMenu() {
      const { tenantId } = await seedQuotesDevTenant(db);
      const staffSubject = "ops.quotes-hbz-finedine@test";
      const membership = await ensureImportStaffAdmin(db, tenantId, staffSubject);

      const tenantLocations = await db
        .select({ id: locations.id, publicId: locations.publicId })
        .from(locations)
        .where(eq(locations.tenantId, tenantId));

      const hbzLocation = tenantLocations.find(
        (location) =>
          location.publicId === QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId,
      );

      expect(hbzLocation?.id).toBeTruthy();

      const products = [];

      for (const productInput of baseProductInputs) {
        products.push(
          await createDraftProduct(db, tenantId, membership, productInput),
        );
      }

      const menu = await createDraftMenu(db, tenantId, membership, {
        internalName: QUOTES_HBZ_FINEDINE_IMPORT.menuInternalName,
        locationIds: [hbzLocation!.id],
        translations: {
          en: { displayName: "HBZ Stadium Menu" },
          ar: { displayName: "قائمة ملعب HBZ" },
        },
        sections: [
          {
            internalName: "ops-fixture",
            sortOrder: 0,
            translations: {
              en: { displayName: "Fixture Section" },
              ar: { displayName: "قسم تجريبي" },
            },
            products: products.map((product, sortOrder) => ({
              productPublicId: product.publicId,
              sortOrder,
            })),
          },
        ],
      });

      const allLocationPublicIds = tenantLocations.map(
        (location) => location.publicId,
      );

      await ensureQuotesStorefront(
        tenantId,
        allLocationPublicIds,
        staffSubject,
      );

      return {
        tenantId,
        staffSubject,
        menu,
        products,
        hbzLocation: hbzLocation!,
        allLocationPublicIds,
      };
    }

    it("blocks publish until translations are approved, then publishes to HBZ only", async () => {
      const fixture = await seedMinimalHbzFineDineDraftMenu();

      await expect(
        publishDraftMenuToLocations(
          db,
          fixture.tenantId,
          fixture.staffSubject,
          fixture.menu.publicId,
          { locationIds: [fixture.hbzLocation.id] },
        ),
      ).rejects.toBeInstanceOf(MenuError);

      const firstRun = await approveAndPublishQuotesHbzFineDineMenu(db, {
        tenantId: fixture.tenantId,
        staffSubject: fixture.staffSubject,
        menuPublicId: fixture.menu.publicId,
      });

      expect(firstRun.productCount).toBe(fixture.products.length);
      expect(firstRun.translationApprovals.approved).toBe(
        fixture.products.length * 2,
      );
      expect(firstRun.translationApprovals.skipped).toBe(0);
      expect(firstRun.publish.status).toBe("completed");
      expect(firstRun.publish.results).toHaveLength(1);
      expect(firstRun.publish.results[0]?.locationPublicId).toBe(
        QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId,
      );
      expect(firstRun.storefront.menuPublicId).toBe(fixture.menu.publicId);
      expect(firstRun.storefront.locationPublicId).toBe(
        QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId,
      );

      const manifest = await resolveStorefrontManifestByPublicId(
        db,
        QUOTES_HBZ_FINEDINE_IMPORT.storefrontPublicId,
        "1",
      );
      const hbzCollection = manifest.publishedCollections.find(
        (collection) =>
          collection.locationPublicId ===
          QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId,
      );

      expect(hbzCollection?.menuPublicId).toBe(fixture.menu.publicId);

      const replay = await approveAndPublishQuotesHbzFineDineMenu(db, {
        tenantId: fixture.tenantId,
        staffSubject: fixture.staffSubject,
        menuPublicId: fixture.menu.publicId,
      });

      expect(replay.translationApprovals.approved).toBe(0);
      expect(replay.translationApprovals.skipped).toBe(fixture.products.length * 2);
      expect(replay.publish.status).toBe("completed");
    });

    it("refuses to publish to non-HBZ locations", async () => {
      const fixture = await seedMinimalHbzFineDineDraftMenu();

      const otherLocations = await db
        .select({ id: locations.id, publicId: locations.publicId })
        .from(locations)
        .where(eq(locations.tenantId, fixture.tenantId));

      const foreignLocationId = otherLocations.find(
        (location) =>
          location.publicId !== QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId,
      )?.id;

      expect(foreignLocationId).toBeTruthy();

      await expect(
        approveAndPublishQuotesHbzFineDineMenu(db, {
          tenantId: fixture.tenantId,
          staffSubject: fixture.staffSubject,
          menuPublicId: fixture.menu.publicId,
          locationIds: [foreignLocationId!],
        }),
      ).rejects.toThrow(/only loc_quotes_hbz/i);
    });
  },
  60_000,
);
