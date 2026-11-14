import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { assignProductToCategory, createCategory } from "@/lib/catalogue/categories";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { archiveDraftProduct, createDraftProduct } from "@/lib/catalogue/products";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { GET } from "./route";

const staffMocks = vi.hoisted(() => ({
  requireStaffIdentity: vi.fn(),
}));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return {
    ...actual,
    requireStaffIdentity: staffMocks.requireStaffIdentity,
  };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN_SUBJECT = "admin.products-list-route@test";
const OUTSIDER_SUBJECT = "admin.flowers-list-route@test";

type ListBody = {
  products: Array<Record<string, unknown>>;
  archivedProducts: Array<Record<string, unknown>>;
};

integrationDescribe("GET /catalogue/products (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  });

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_product_categories, qos.catalogue_category_translations, qos.catalogue_categories, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  async function seedAdmin(tenantId: string, subject: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role: "administrator" })
      .returning();
    return {
      membershipId: membership.id,
      role: "administrator" as const,
      staffIdentityId: identity.id,
    };
  }

  async function seedCatalogue() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const admin = await seedAdmin(quotes.tenant.id, ADMIN_SUBJECT);
    const flowerAdmin = await seedAdmin(flowers.tenant.id, OUTSIDER_SUBJECT);

    const hot = await createCategory(
      db,
      quotes.tenant.id,
      {
        internalName: "hot-drinks",
        publicId: "cat_hot_drinks",
        sortOrder: 1,
        translations: { en: { displayName: "Hot drinks" }, ar: { displayName: "مشروبات ساخنة" } },
      },
      ADMIN_SUBJECT,
      admin,
    );
    const signatures = await createCategory(
      db,
      quotes.tenant.id,
      {
        internalName: "signatures",
        publicId: "cat_signatures",
        sortOrder: 5,
        translations: { en: { displayName: "Signatures" }, ar: { displayName: "أطباق مميزة" } },
      },
      ADMIN_SUBJECT,
      admin,
    );

    const latte = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "latte",
      translations: {
        en: { displayName: "Latte", description: null },
        ar: { displayName: "لاتيه", description: null },
      },
      defaultVariant: { amountMinor: 1850, currency: "AED" },
    });
    const water = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "water",
      translations: {
        en: { displayName: "Water", description: null },
        ar: { displayName: "ماء", description: null },
      },
      defaultVariant: { amountMinor: 500, currency: "AED" },
    });
    const retired = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "retired-mocha",
      translations: {
        en: { displayName: "Retired Mocha", description: null },
        ar: { displayName: "موكا", description: null },
      },
      defaultVariant: { amountMinor: 2200, currency: "AED" },
    });

    // Assigned to the later category first, so ordering must come from category sort order.
    for (const category of [signatures, hot]) {
      await assignProductToCategory(
        db,
        quotes.tenant.id,
        category.publicId,
        { productPublicId: latte.publicId },
        ADMIN_SUBJECT,
        admin,
      );
    }
    await assignProductToCategory(
      db,
      quotes.tenant.id,
      signatures.publicId,
      { productPublicId: retired.publicId },
      ADMIN_SUBJECT,
      admin,
    );
    await archiveDraftProduct(db, quotes.tenant.id, retired.publicId, ADMIN_SUBJECT);

    const roses = await createDraftProduct(db, flowers.tenant.id, flowerAdmin, {
      internalName: "roses",
      translations: {
        en: { displayName: "Roses", description: null },
        ar: { displayName: "ورد", description: null },
      },
      defaultVariant: { amountMinor: 9900, currency: "AED" },
    });

    return {
      tenantId: quotes.tenant.id,
      admin,
      locationId: quotes.location.id,
      latte,
      water,
      retired,
      roses,
    };
  }

  async function list(tenantId: string, subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
    return GET(new Request("http://localhost/catalogue/products"), {
      params: Promise.resolve({ tenantId }),
    });
  }

  it("returns the default AED price and first category for each product", async () => {
    const { tenantId, latte, water, retired, roses } = await seedCatalogue();

    const response = await list(tenantId, ADMIN_SUBJECT);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody;

    expect(body.products).toEqual([
      {
        publicId: latte.publicId,
        internalName: "latte",
        displayName: "Latte",
        status: "draft",
        thumbnailPublicId: null,
        defaultPrice: { amountMinor: 1850, currency: "AED" },
        category: {
          publicId: "cat_hot_drinks",
          source: "category",
          displayName: { en: "Hot drinks", ar: "مشروبات ساخنة" },
        },
      },
      {
        publicId: water.publicId,
        internalName: "water",
        displayName: "Water",
        status: "draft",
        thumbnailPublicId: null,
        defaultPrice: { amountMinor: 500, currency: "AED" },
        category: null,
      },
    ].sort((a, b) => a.publicId.localeCompare(b.publicId)));

    expect(body.archivedProducts).toEqual([
      expect.objectContaining({
        publicId: retired.publicId,
        status: "archived",
        defaultPrice: { amountMinor: 2200, currency: "AED" },
        category: {
          publicId: "cat_signatures",
          source: "category",
          displayName: { en: "Signatures", ar: "أطباق مميزة" },
        },
      }),
    ]);

    const listed = [...body.products, ...body.archivedProducts].map((row) => row.publicId);
    expect(listed).not.toContain(roses.publicId);
  });

  it("falls back to the published menu section for products without a catalogue category", async () => {
    const { tenantId, admin, locationId, latte, water } = await seedCatalogue();

    async function menuWithSection(name: string, section: { en: string; ar: string }, products: string[]) {
      return createDraftMenu(db, tenantId, admin, {
        internalName: name,
        locationIds: [locationId],
        translations: { en: { displayName: name }, ar: { displayName: "قائمة" } },
        sections: [
          {
            internalName: section.en.toLowerCase(),
            sortOrder: 0,
            translations: { en: { displayName: section.en }, ar: { displayName: section.ar } },
            products: products.map((productPublicId, sortOrder) => ({ productPublicId, sortOrder })),
          },
        ],
      });
    }

    // The draft menu sorts first by public id, so only the published preference
    // can pick the live menu's section.
    await menuWithSection("aaa-draft", { en: "Draft picks", ar: "مسودة" }, [water.publicId]);
    const live = await menuWithSection(
      "zzz-live",
      { en: "Cold drinks", ar: "مشروبات باردة" },
      [water.publicId, latte.publicId],
    );
    await sqlClient`UPDATE qos.catalogue_menus SET status = 'active', published_version = 1 WHERE public_id = ${live.publicId}`;

    const response = await list(tenantId, ADMIN_SUBJECT);
    expect(response.status).toBe(200);
    const body = (await response.json()) as ListBody;
    const byId = new Map(body.products.map((row) => [row.publicId, row]));

    expect(byId.get(water.publicId)?.category).toEqual({
      publicId: live.sections[0]!.publicId,
      source: "menu_section",
      displayName: { en: "Cold drinks", ar: "مشروبات باردة" },
    });
    expect(byId.get(latte.publicId)?.category).toEqual(
      expect.objectContaining({ publicId: "cat_hot_drinks", source: "category" }),
    );
  });

  it("ignores archived menu sections when choosing the fallback", async () => {
    const { tenantId, admin, locationId, water } = await seedCatalogue();
    const menu = await createDraftMenu(db, tenantId, admin, {
      internalName: "retired-menu",
      locationIds: [locationId],
      translations: { en: { displayName: "Retired" }, ar: { displayName: "قديمة" } },
      sections: [
        {
          internalName: "old",
          sortOrder: 0,
          translations: { en: { displayName: "Old section" }, ar: { displayName: "قسم قديم" } },
          products: [{ productPublicId: water.publicId, sortOrder: 0 }],
        },
      ],
    });
    await sqlClient`UPDATE qos.catalogue_menu_sections SET archived = true WHERE public_id = ${menu.sections[0]!.publicId}`;

    const response = await list(tenantId, ADMIN_SUBJECT);
    const body = (await response.json()) as ListBody;
    expect(body.products.find((row) => row.publicId === water.publicId)?.category).toBeNull();
  });

  it("rejects staff without a membership in the tenant", async () => {
    const { tenantId } = await seedCatalogue();

    const response = await list(tenantId, OUTSIDER_SUBJECT);

    expect(response.status).toBe(403);
    const body = (await response.json()) as Partial<ListBody>;
    expect(body.products).toBeUndefined();
  });
});
