import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import { hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import {
  assignProductToCategory,
  createCategory,
  listCategories,
  reorderCategories,
  unassignProductFromCategory,
  updateCategory,
} from "@/lib/catalogue/categories";
import { createDraftProduct } from "@/lib/catalogue/products";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("catalogue categories", () => {
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
    await sqlClient`TRUNCATE TABLE qos.catalogue_product_categories, qos.catalogue_category_translations, qos.catalogue_categories, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
  });

  async function seedAdmin(tenantId: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({
        providerSubject: "admin.quotes@test",
        email: "admin.quotes@test",
      })
      .returning();

    const [membership] = await db
      .insert(staffMemberships)
      .values({
        tenantId,
        staffIdentityId: identity.id,
        role: "administrator",
      })
      .returning();

    return {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };
  }

  it("creates, updates, assigns, and reorders bilingual categories", async () => {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedAdmin(quotes.tenant.id);

    const bouquets = await createCategory(
      db,
      quotes.tenant.id,
      {
        internalName: "bouquets",
        publicId: "cat_bouquets",
        translations: {
          en: { displayName: "Bouquets" },
          ar: { displayName: "باقات" },
        },
      },
      "admin.quotes@test",
      admin,
    );

    expect(bouquets.translations.en.displayName).toBe("Bouquets");
    expect(bouquets.translations.ar.displayName).toBe("باقات");
    expect(bouquets.productCount).toBe(0);

    const stems = await createCategory(
      db,
      quotes.tenant.id,
      {
        internalName: "stems",
        publicId: "cat_stems",
        translations: {
          en: { displayName: "Stems" },
          ar: { displayName: "سيقان" },
        },
      },
      "admin.quotes@test",
      admin,
    );

    const product = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "rose-dozen",
      translations: {
        en: { displayName: "Dozen Roses", description: "Demo" },
        ar: { displayName: "ورد", description: "تجريبي" },
      },
      defaultVariant: { amountMinor: 15000, currency: "AED" },
    });

    const assigned = await assignProductToCategory(
      db,
      quotes.tenant.id,
      bouquets.publicId,
      { productPublicId: product.publicId },
      "admin.quotes@test",
      admin,
    );

    expect(assigned.products.map((row) => row.productPublicId)).toEqual([
      product.publicId,
    ]);

    const reordered = await reorderCategories(
      db,
      quotes.tenant.id,
      { orderedPublicIds: [stems.publicId, bouquets.publicId] },
      "admin.quotes@test",
      admin,
    );

    expect(reordered.map((row) => row.publicId)).toEqual([
      "cat_stems",
      "cat_bouquets",
    ]);

    await updateCategory(
      db,
      quotes.tenant.id,
      bouquets.publicId,
      {
        expectedVersion: assigned.version,
        translations: { en: { displayName: "Seasonal bouquets" } },
      },
      "admin.quotes@test",
      admin,
    );

    await unassignProductFromCategory(
      db,
      quotes.tenant.id,
      bouquets.publicId,
      product.publicId,
      "admin.quotes@test",
      admin,
    );

    const listed = await listCategories(db, quotes.tenant.id);
    expect(listed.find((row) => row.publicId === "cat_bouquets")?.productCount).toBe(
      0,
    );
  });
});
