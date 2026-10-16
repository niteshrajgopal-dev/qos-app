import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffLocationScopes, staffMemberships } from "@/db/schema";
import {
  grantRoleMembership,
  hasIntegrationDatabase,
  resetAndMigrate,
  runAsRole,
} from "@/db/test-utils";
import { loadMenuFacts } from "@/lib/catalogue/menu-facts";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { withTenantContext } from "@/lib/tenant/context";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("loadMenuFacts as qos_ai_worker", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
    await grantRoleMembership(sqlClient, "qos", "qos_ai_worker");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  it("reads the live draft graph the Menu Manager health tool needs", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const subject = "admin.quotes@test";
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId: quotes.tenant.id, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({
      tenantId: quotes.tenant.id,
      staffMembershipId: membership!.id,
      locationId: quotes.location.id,
    });
    const actor = {
      membershipId: membership!.id,
      role: "administrator" as const,
      staffIdentityId: identity!.id,
    };
    const product = await createDraftProduct(db, quotes.tenant.id, actor, {
      internalName: "latte",
      translations: {
        en: { displayName: "Latte", description: "d" },
        ar: { displayName: "l", description: "w" },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const menu = await createDraftMenu(db, quotes.tenant.id, actor, {
      internalName: "breakfast",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Breakfast" }, ar: { displayName: "f" } },
      sections: [
        {
          internalName: "coffee",
          sortOrder: 0,
          translations: { en: { displayName: "Coffee" }, ar: { displayName: "q" } },
          products: [{ productPublicId: product.publicId, sortOrder: 0 }],
        },
      ],
    });

    const facts = await runAsRole(sqlClient, "qos_ai_worker", () =>
      withTenantContext(db, quotes.tenant.id, (tx) => loadMenuFacts(tx, quotes.tenant.id, menu.publicId)),
    );

    expect(facts).toMatchObject({
      menuPublicId: menu.publicId,
      displayName: "Breakfast",
      sectionCount: 1,
      products: [expect.objectContaining({ productPublicId: product.publicId, internalName: "latte" })],
    });
  });
});