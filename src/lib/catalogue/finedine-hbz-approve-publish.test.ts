import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";

import { catalogueMenus, locations } from "@/db/schema";
import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { approveAndPublishQuotesHbzFineDineMenu } from "@/lib/catalogue/finedine-hbz-approve-publish";
import { QUOTES_HBZ_FINEDINE_IMPORT } from "@/lib/catalogue/finedine-hbz-constants";
import {
  ensureImportStaffAdmin,
  importQuotesHbzFineDineMenu,
} from "@/lib/catalogue/finedine-hbz-import";
import { MenuError } from "@/lib/catalogue/menus";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("quotes hbz finedine approve and publish", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_menu_public_links, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_import_source_links, qos.catalogue_import_operations, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  it("blocks publish until translations are approved, then publishes to HBZ only", async () => {
    const imported = await importQuotesHbzFineDineMenu(db, {
      idempotencyKey: "hbz-approve-publish-001",
    });

    const [menuRow] = await db
      .select()
      .from(catalogueMenus)
      .where(eq(catalogueMenus.publicId, imported.menuPublicId))
      .limit(1);

    const tenantId = menuRow!.tenantId;
    const staffSubject = "ops.quotes-hbz-finedine@test";

    await ensureImportStaffAdmin(db, tenantId, staffSubject);

    const [hbzLocation] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.publicId, QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId))
      .limit(1);

    expect(hbzLocation?.id).toBeTruthy();

    await expect(
      publishDraftMenuToLocations(
        db,
        tenantId,
        staffSubject,
        imported.menuPublicId,
        { locationIds: [hbzLocation!.id] },
      ),
    ).rejects.toBeInstanceOf(MenuError);

    const firstRun = await approveAndPublishQuotesHbzFineDineMenu(db, {
      tenantId,
      staffSubject,
      menuPublicId: imported.menuPublicId,
    });

    expect(firstRun.productCount).toBe(imported.productCount);
    expect(firstRun.translationApprovals.approved).toBe(imported.productCount * 2);
    expect(firstRun.translationApprovals.skipped).toBe(0);
    expect(firstRun.publish.status).toBe("completed");
    expect(firstRun.publish.results).toHaveLength(1);
    expect(firstRun.publish.results[0]?.locationPublicId).toBe(
      QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId,
    );

    const replay = await approveAndPublishQuotesHbzFineDineMenu(db, {
      tenantId,
      staffSubject,
      menuPublicId: imported.menuPublicId,
    });

    expect(replay.translationApprovals.approved).toBe(0);
    expect(replay.translationApprovals.skipped).toBe(imported.productCount * 2);
    expect(replay.publish.status).toBe("completed");
  });

  it("refuses to publish to non-HBZ locations", async () => {
    const imported = await importQuotesHbzFineDineMenu(db, {
      idempotencyKey: "hbz-approve-publish-guard-001",
    });

    const [menuRow] = await db
      .select()
      .from(catalogueMenus)
      .where(eq(catalogueMenus.publicId, imported.menuPublicId))
      .limit(1);

    const [hbzLocation] = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.publicId, QUOTES_HBZ_FINEDINE_IMPORT.locationPublicId))
      .limit(1);

    const otherLocations = await db
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.tenantId, menuRow!.tenantId));

    const foreignLocationId = otherLocations.find(
      (location) => location.id !== hbzLocation?.id,
    )?.id;

    expect(foreignLocationId).toBeTruthy();

    await expect(
      approveAndPublishQuotesHbzFineDineMenu(db, {
        tenantId: menuRow!.tenantId,
        menuPublicId: imported.menuPublicId,
        locationIds: [foreignLocationId!],
      }),
    ).rejects.toThrow(/only loc_quotes_hbz/i);
  });
});
