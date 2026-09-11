import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { locations } from "@/db/schema";
import {
  hasIntegrationDatabase,
  resetAndMigrate,
  tableCount,
} from "@/db/test-utils";
import {
  getCatalogueProductView,
  listCatalogueProductPublicIds,
} from "@/lib/catalogue/repository";
import {
  listQuotesExternalMenuMappings,
  resetSyntheticCatalogueForTenant,
  seedDevTenants,
  seedFlowerDevTenant,
  seedQuotesDevTenant,
} from "@/lib/seed/dev-tenants";
import { quotesLocationFixtures } from "@/lib/seed/fixtures/quotes-locations";
import { flowerRoseBouquetFixture } from "@/lib/seed/fixtures/flower-catalogue";
import { findTenantByPublicId } from "@/lib/tenant/repository";
import {
  FLOWER_TENANT_PUBLIC_ID,
  QUOTES_TENANT_PUBLIC_ID,
  SYNTHETIC_PROVENANCE_NOTE,
} from "@/lib/seed/constants";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("dev tenant seed", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.location_external_menu_sources, qos.staff_access_request_locations, qos.staff_access_requests, qos.business_provisioning_operations, qos.staff_invitations, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  it("seeds exactly three Quotes locations with confirmed external menu mappings", async () => {
    const result = await seedQuotesDevTenant(db);

    expect(result.locationIds).toHaveLength(3);
    expect(await tableCount(sqlClient, "locations")).toBe(3);

    const mappings = await listQuotesExternalMenuMappings(db, result.tenantId);
    expect(mappings).toHaveLength(3);
    expect(mappings.map((row) => row.locationPublicId).sort()).toEqual(
      quotesLocationFixtures.map((location) => location.publicId).sort(),
    );
    expect(mappings.every((row) => row.provenanceNote === SYNTHETIC_PROVENANCE_NOTE)).toBe(
      true,
    );
  });

  it("is idempotent when seeding Quotes and flower tenants repeatedly", async () => {
    await seedDevTenants(db);
    await seedDevTenants(db);

    const quotesTenant = await findTenantByPublicId(db, QUOTES_TENANT_PUBLIC_ID);
    const flowerTenant = await findTenantByPublicId(db, FLOWER_TENANT_PUBLIC_ID);

    expect(quotesTenant).toBeTruthy();
    expect(flowerTenant).toBeTruthy();
    expect(await tableCount(sqlClient, "tenants")).toBe(2);
    expect(await tableCount(sqlClient, "locations")).toBe(4);
    expect(await tableCount(sqlClient, "catalogue_products")).toBe(1);
    expect(await tableCount(sqlClient, "location_external_menu_sources")).toBe(3);
  });

  it("serves flower products through the shared catalogue interfaces without food-only fields", async () => {
    const { tenantId } = await seedFlowerDevTenant(db);
    const product = await getCatalogueProductView(
      db,
      tenantId,
      flowerRoseBouquetFixture.productPublicId,
      "en",
    );

    expect(product).toBeTruthy();
    expect(product?.provenance).toBe("synthetic_fixture");
    expect(product?.variants).toHaveLength(3);
    expect(product?.modifierGroups).toHaveLength(1);
    expect(product?.modifierGroups[0]?.options).toHaveLength(2);
    expect(product?.description).toContain("Synthetic");
  });

  it("prevents cross-tenant catalogue reads between Quotes and flower tenants", async () => {
    const seeded = await seedDevTenants(db);
    const quotesProducts = await listCatalogueProductPublicIds(
      db,
      seeded.quotesTenantId,
    );
    const flowerProducts = await listCatalogueProductPublicIds(
      db,
      seeded.flowerTenantId,
    );

    expect(quotesProducts).toEqual([]);
    expect(flowerProducts).toEqual([flowerRoseBouquetFixture.productPublicId]);

    await expect(
      getCatalogueProductView(
        db,
        seeded.quotesTenantId,
        flowerRoseBouquetFixture.productPublicId,
      ),
    ).resolves.toBeNull();
  });

  it("resets synthetic flower catalogue data without altering Quotes locations", async () => {
    const seeded = await seedDevTenants(db);

    await resetSyntheticCatalogueForTenant(db, seeded.flowerTenantId);

    expect(await tableCount(sqlClient, "catalogue_products")).toBe(0);
    expect(await tableCount(sqlClient, "locations")).toBe(4);

    const quotesLocations = await db
      .select()
      .from(locations)
      .where(eq(locations.tenantId, seeded.quotesTenantId));

    expect(quotesLocations).toHaveLength(3);
    expect(
      await listQuotesExternalMenuMappings(db, seeded.quotesTenantId),
    ).toHaveLength(3);
  });
});
