import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  catalogueMenus,
  catalogueMenuTranslations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { createDraftMenu, loadDraftMenuEditorView } from "@/lib/catalogue/menus";
import { createDraftProduct } from "@/lib/catalogue/products";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { withTenantContext } from "@/lib/tenant/context";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const REQUESTER = "admin.quotes@test";

integrationDescribe("Menu Manager worker catalogue grants", () => {
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

  it("lets qos_ai_worker read catalogue_menu_translations under tenant context", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const tenantId = quotes.tenant.id;
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: REQUESTER, email: REQUESTER }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "administrator" })
      .returning();
    await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership!.id, locationId: quotes.location.id });
    const actor = { membershipId: membership!.id, role: "administrator" as const, staffIdentityId: identity!.id };
    const product = await createDraftProduct(db, tenantId, actor, {
      internalName: "latte",
      translations: { en: { displayName: "Latte", description: "d" }, ar: { displayName: "l", description: "w" } },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const menu = await createDraftMenu(db, tenantId, actor, {
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

    const [menuRow] = await db
      .select()
      .from(catalogueMenus)
      .where(eq(catalogueMenus.publicId, menu.publicId))
      .limit(1);
    expect(menuRow).toBeDefined();

    await runAsRole(sqlClient, "qos_ai_worker", async () =>
      withTenantContext(db, tenantId, async (tx) => {
        const rows = await tx
          .select()
          .from(catalogueMenuTranslations)
          .where(eq(catalogueMenuTranslations.menuId, menuRow!.id));
        expect(rows.length).toBeGreaterThan(0);
        const view = await loadDraftMenuEditorView(tx, tenantId, menu.publicId);
        expect(view?.publicId).toBe(menu.publicId);
      }),
    );

    const [privilege] = await sqlClient`
      SELECT has_table_privilege('qos_ai_worker', 'qos.catalogue_menu_translations', 'SELECT') AS ok`;
    expect(privilege!.ok).toBe(true);
  });
});
