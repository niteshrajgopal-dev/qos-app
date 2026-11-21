import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { catalogueProducts, staffIdentities, staffMemberships, tenantAuditEvents } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { createModifierGroup } from "@/lib/catalogue/modifiers";
import { archiveDraftProduct } from "@/lib/catalogue/products";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { POST as optionsPOST } from "../../modifier-groups/[groupPublicId]/options/route";
import { PATCH as optionPATCH } from "../../modifier-groups/[groupPublicId]/options/[optionPublicId]/route";
import { POST as productsPOST } from "../route";
import { GET as productGET, PATCH as productPATCH } from "./route";
import { POST as variantsPOST } from "./variants/route";
import { PATCH as variantPATCH } from "./variants/[variantPublicId]/route";

/* QOS-214: selling attributes and supplied nutrition metadata through the
   existing product, variant and modifier-option routes, against Postgres. */

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

const ADMIN = "admin.selling-attributes@test";
const USER = "user.selling-attributes@test";
const FLOWERS_ADMIN = "admin.flowers.selling-attributes@test";

type ProductBody = {
  product: {
    publicId: string;
    version: number;
    barcode: string | null;
    nutritionCalories: number | null;
    preparationTimeMinutes: number | null;
    walkingTimeMinutes: number | null;
    highSalt: boolean | null;
    directStockIntent: boolean | null;
    translations: Record<"en" | "ar", { displayName: string; description: string | null }>;
    defaultVariant: { publicId: string };
    variants: VariantBody["variants"];
  };
  error?: string;
  field?: string;
};

type VariantBody = {
  productVersion: number;
  variants: Array<{
    publicId: string;
    barcode: string | null;
    sellingQuantityBasis: string | null;
    priceUnit: string | null;
    priceUnitQuantity: number | null;
    sellingBasisState: string;
  }>;
  error?: string;
  field?: string;
};

type OptionsBody = {
  group: {
    publicId: string;
    version: number;
    businessProfile: string;
    options: Array<{ publicId: string; nutritionCalories: number | null; translations: Record<"en" | "ar", { displayName: string }> }>;
  };
  error?: string;
  field?: string;
};

integrationDescribe("catalogue selling attributes routes (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  async function seedMember(tenantId: string, subject: string, role: "administrator" | "user") {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    const [membership] = await db.insert(staffMemberships).values({ tenantId, staffIdentityId: identity.id, role }).returning();
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const admin = await seedMember(quotes.tenant.id, ADMIN, "administrator");
    await seedMember(quotes.tenant.id, USER, "user");
    const flowersAdmin = await seedMember(flowers.tenant.id, FLOWERS_ADMIN, "administrator");
    return { tenantId: quotes.tenant.id, flowersTenantId: flowers.tenant.id, admin, flowersAdmin };
  }

  function as(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }

  function json(method: string, body: unknown) {
    return new Request("http://localhost/test", { method, body: JSON.stringify(body) });
  }

  async function createProduct(subject: string, tenantId: string, body: Record<string, unknown>) {
    as(subject);
    const response = await productsPOST(json("POST", body), { params: Promise.resolve({ tenantId }) });
    return { status: response.status, body: (await response.json()) as ProductBody };
  }

  async function patchProduct(subject: string, tenantId: string, productPublicId: string, body: Record<string, unknown>) {
    as(subject);
    const response = await productPATCH(json("PATCH", body), { params: Promise.resolve({ tenantId, productPublicId }) });
    return { status: response.status, body: (await response.json()) as ProductBody };
  }

  async function getProduct(subject: string, tenantId: string, productPublicId: string) {
    as(subject);
    const response = await productGET(new Request("http://localhost/test"), { params: Promise.resolve({ tenantId, productPublicId }) });
    return { status: response.status, body: (await response.json()) as ProductBody };
  }

  async function patchVariant(
    subject: string,
    tenantId: string,
    productPublicId: string,
    variantPublicId: string,
    body: Record<string, unknown>,
  ) {
    as(subject);
    const response = await variantPATCH(json("PATCH", body), {
      params: Promise.resolve({ tenantId, productPublicId, variantPublicId }),
    });
    return { status: response.status, body: (await response.json()) as VariantBody };
  }

  const latte = {
    internalName: "latte",
    barcode: "001234",
    translations: {
      en: { displayName: "Latte", description: "Espresso with steamed milk" },
      ar: { displayName: "لاتيه", description: "إسبريسو مع حليب مبخر" },
    },
    defaultVariant: { amountMinor: 1800, currency: "AED" },
  };

  it("saves and reloads EN/AR text, barcode 001234, minutes including 0 and a tri-state high-salt declaration", async () => {
    const { tenantId } = await seed();

    const created = await createProduct(ADMIN, tenantId, {
      ...latte,
      nutritionCalories: 190,
      preparationTimeMinutes: 0,
      walkingTimeMinutes: 25,
      highSalt: true,
      directStockIntent: false,
    });
    expect(created.status).toBe(201);
    const publicId = created.body.product.publicId;

    const reloaded = await getProduct(USER, tenantId, publicId);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.product).toMatchObject({
      barcode: "001234",
      nutritionCalories: 190,
      preparationTimeMinutes: 0,
      walkingTimeMinutes: 25,
      highSalt: true,
      directStockIntent: false,
      translations: {
        en: { displayName: "Latte", description: "Espresso with steamed milk" },
        ar: { displayName: "لاتيه", description: "إسبريسو مع حليب مبخر" },
      },
    });

    // Omitted fields stay unchanged; false is a declared value.
    const toFalse = await patchProduct(USER, tenantId, publicId, { expectedVersion: 1, highSalt: false });
    expect(toFalse.status).toBe(200);
    expect(toFalse.body.product).toMatchObject({ version: 2, highSalt: false, preparationTimeMinutes: 0, walkingTimeMinutes: 25 });

    // Explicit null clears back to unknown.
    const toUnknown = await patchProduct(USER, tenantId, publicId, {
      expectedVersion: 2,
      highSalt: null,
      walkingTimeMinutes: null,
      directStockIntent: true,
    });
    expect(toUnknown.status).toBe(200);
    expect((await getProduct(ADMIN, tenantId, publicId)).body.product).toMatchObject({
      version: 3,
      highSalt: null,
      walkingTimeMinutes: null,
      preparationTimeMinutes: 0,
      directStockIntent: true,
      barcode: "001234",
    });

    const events = await db
      .select()
      .from(tenantAuditEvents)
      .where(and(eq(tenantAuditEvents.tenantId, tenantId), eq(tenantAuditEvents.action, "catalogue.product.selling_attributes.update")));
    expect(events.map((event) => [event.entityPublicId, event.entityVersion, event.changeSummary])).toEqual([
      [publicId, 2, { highSalt: { before: true, after: false } }],
      [
        publicId,
        3,
        {
          highSalt: { before: false, after: null },
          walkingTimeMinutes: { before: 25, after: null },
          directStockIntent: { before: false, after: true },
        },
      ],
    ]);
  });

  it("rejects invalid values and stale versions without writing", async () => {
    const { tenantId } = await seed();
    const { body } = await createProduct(ADMIN, tenantId, latte);
    const publicId = body.product.publicId;

    for (const [patch, field] of [
      [{ preparationTimeMinutes: -1 }, "preparationTimeMinutes"],
      [{ walkingTimeMinutes: 2.5 }, "walkingTimeMinutes"],
      [{ highSalt: "yes" }, "highSalt"],
    ] as const) {
      const response = await patchProduct(ADMIN, tenantId, publicId, { expectedVersion: 1, ...patch });
      expect(response.status, field).toBe(400);
      expect(response.body.field).toBe(field);
    }
    const stale = await patchProduct(ADMIN, tenantId, publicId, { expectedVersion: 9, preparationTimeMinutes: 5 });
    expect(stale.status).toBe(409);

    const [row] = await db.select().from(catalogueProducts).where(eq(catalogueProducts.publicId, publicId));
    expect(row).toMatchObject({ version: 1, preparationTimeMinutes: null, walkingTimeMinutes: null, highSalt: null });
  });

  it("gates walking time and high salt to hospitality, but not prep time or stock intent", async () => {
    const { flowersTenantId } = await seed();
    const roses = {
      ...latte,
      internalName: "roses",
      translations: { en: { displayName: "Roses" }, ar: { displayName: "ورد" } },
    };
    const walking = await createProduct(FLOWERS_ADMIN, flowersTenantId, { ...roses, walkingTimeMinutes: 10 });
    expect(walking.status).toBe(400);
    expect(walking.body.field).toBe("walkingTimeMinutes");
    const salt = await createProduct(FLOWERS_ADMIN, flowersTenantId, { ...roses, highSalt: false });
    expect(salt.status).toBe(400);

    const ok = await createProduct(FLOWERS_ADMIN, flowersTenantId, { ...roses, preparationTimeMinutes: 15, directStockIntent: true });
    expect(ok.status).toBe(201);
    expect(ok.body.product).toMatchObject({ preparationTimeMinutes: 15, directStockIntent: true, walkingTimeMinutes: null, highSalt: null });
  });

  it("keeps tenant isolation (403 for a non-member, 404 for another tenant's record) and 409 for an archived product", async () => {
    const { tenantId, flowersTenantId, flowersAdmin } = await seed();
    const { body } = await createProduct(ADMIN, tenantId, latte);
    const publicId = body.product.publicId;

    // A caller with no membership in this tenant: the existing membership gate answers 403.
    expect((await patchProduct(FLOWERS_ADMIN, tenantId, publicId, { expectedVersion: 1, preparationTimeMinutes: 3 })).status).toBe(403);

    // Another tenant's records addressed through this tenant's path are not found.
    const roses = await createProduct(FLOWERS_ADMIN, flowersTenantId, {
      ...latte,
      internalName: "roses",
      translations: { en: { displayName: "Roses" }, ar: { displayName: "ورد" } },
    });
    const rosesId = roses.body.product.publicId;
    expect((await patchProduct(ADMIN, tenantId, rosesId, { expectedVersion: 1, preparationTimeMinutes: 3 })).status).toBe(404);
    expect((await getProduct(ADMIN, tenantId, rosesId)).status).toBe(404);
    expect(
      (await patchVariant(ADMIN, tenantId, rosesId, roses.body.product.defaultVariant.publicId, {
        expectedProductVersion: 1,
        sellingQuantityBasis: "each",
      })).status,
    ).toBe(404);
    const flowersGroup = await createModifierGroup(
      db,
      flowersTenantId,
      { internalName: "wrap", translations: { en: { displayName: "Wrap" }, ar: { displayName: "تغليف" } } },
      FLOWERS_ADMIN,
      flowersAdmin,
    );
    as(ADMIN);
    const crossOption = await optionsPOST(json("POST", { expectedGroupVersion: flowersGroup.version, nutritionCalories: 10 }), {
      params: Promise.resolve({ tenantId, groupPublicId: flowersGroup.publicId }),
    });
    expect(crossOption.status).toBe(404);
    const [untouched] = await db.select().from(catalogueProducts).where(eq(catalogueProducts.publicId, rosesId));
    expect(untouched).toMatchObject({ version: 1, preparationTimeMinutes: null });

    await archiveDraftProduct(db, tenantId, publicId, ADMIN);
    const archived = await patchProduct(ADMIN, tenantId, publicId, { expectedVersion: 2, preparationTimeMinutes: 3 });
    expect(archived.status).toBe(409);
    const archivedVariant = await patchVariant(ADMIN, tenantId, publicId, body.product.defaultVariant.publicId, {
      expectedProductVersion: 2,
      sellingQuantityBasis: "weight",
    });
    expect(archivedVariant.status).toBe(409);
  });

  it("stores the selling basis on variants, keeps partial weight unresolved and bumps the product version", async () => {
    const { tenantId } = await seed();
    const { body } = await createProduct(ADMIN, tenantId, { ...latte, barcode: null });
    const publicId = body.product.publicId;
    const defaultVariant = body.product.defaultVariant.publicId;

    // A new product's default variant is undeclared, not per piece.
    expect(body.product.variants[0]).toMatchObject({
      sellingQuantityBasis: null,
      priceUnit: null,
      priceUnitQuantity: null,
      sellingBasisState: "undeclared",
    });

    const weightOnly = await patchVariant(USER, tenantId, publicId, defaultVariant, {
      expectedProductVersion: 1,
      barcode: "001234",
      sellingQuantityBasis: "weight",
    });
    expect(weightOnly.status).toBe(200);
    expect(weightOnly.body.productVersion).toBe(2);
    expect(weightOnly.body.variants[0]).toMatchObject({
      barcode: "001234",
      sellingQuantityBasis: "weight",
      priceUnit: null,
      sellingBasisState: "unresolved",
    });

    const illegal = await patchVariant(USER, tenantId, publicId, defaultVariant, { expectedProductVersion: 2, priceUnit: "each" });
    expect(illegal.status).toBe(400);
    expect(illegal.body.field).toBe("priceUnit");

    const resolved = await patchVariant(USER, tenantId, publicId, defaultVariant, {
      expectedProductVersion: 2,
      priceUnit: "g",
      priceUnitQuantity: 100,
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.variants[0]).toMatchObject({
      sellingQuantityBasis: "weight",
      priceUnit: "g",
      priceUnitQuantity: 100,
      sellingBasisState: "weight_resolved",
    });

    const product = (await getProduct(ADMIN, tenantId, publicId)).body.product;
    expect(product.version).toBe(3);
    expect(product.variants[0]).toMatchObject({ barcode: "001234", priceUnitQuantity: 100 });

    // Default must be labelled before a second choice exists.
    await patchVariant(ADMIN, tenantId, publicId, defaultVariant, {
      expectedProductVersion: 3,
      translations: { en: { displayName: "Regular" }, ar: { displayName: "عادي" } },
    });
    as(ADMIN);
    const createdVariant = await variantsPOST(
      json("POST", {
        expectedProductVersion: 4,
        barcode: "0001235",
        sellingQuantityBasis: "each",
        priceUnit: "kg",
        translations: { en: { displayName: "Large" }, ar: { displayName: "كبير" } },
      }),
      { params: Promise.resolve({ tenantId, productPublicId: publicId }) },
    );
    expect(createdVariant.status).toBe(400);
    const second = await variantsPOST(
      json("POST", {
        expectedProductVersion: 4,
        barcode: "0001235",
        sellingQuantityBasis: "each",
        translations: { en: { displayName: "Large" }, ar: { displayName: "كبير" } },
      }),
      { params: Promise.resolve({ tenantId, productPublicId: publicId }) },
    );
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as VariantBody;
    expect(secondBody.variants.find((variant) => variant.barcode === "0001235")).toMatchObject({
      sellingQuantityBasis: "each",
      sellingBasisState: "each",
    });

    const audit = await db
      .select()
      .from(tenantAuditEvents)
      .where(and(eq(tenantAuditEvents.tenantId, tenantId), eq(tenantAuditEvents.action, "catalogue.variant.update")));
    expect(audit.map((event) => (event.changeSummary as { sellingBasis?: unknown }).sellingBasis).filter(Boolean)).toEqual([
      { sellingQuantityBasis: { before: null, after: "weight" } },
      { priceUnit: { before: null, after: "g" }, priceUnitQuantity: { before: null, after: 100 } },
    ]);
  });

  it("saves and reloads modifier option calories including 0, and clears them with null", async () => {
    const { tenantId, admin } = await seed();
    const group = await createModifierGroup(
      db,
      tenantId,
      { internalName: "milk", translations: { en: { displayName: "Milk" }, ar: { displayName: "الحليب" } } },
      ADMIN,
      admin,
    );
    const groupParams = { tenantId, groupPublicId: group.publicId };

    as(ADMIN);
    const created = await optionsPOST(
      json("POST", {
        expectedGroupVersion: group.version,
        nutritionCalories: 0,
        translations: { en: { displayName: "Oat milk" }, ar: { displayName: "حليب الشوفان" } },
      }),
      { params: Promise.resolve(groupParams) },
    );
    expect(created.status).toBe(200);
    const createdBody = (await created.json()) as OptionsBody;
    expect(createdBody.group.businessProfile).toBe("hospitality");
    const option = createdBody.group.options[0]!;
    expect(option).toMatchObject({
      nutritionCalories: 0,
      translations: { en: { displayName: "Oat milk" }, ar: { displayName: "حليب الشوفان" } },
    });

    // A User may record calories (no price change), as with other option fields.
    as(USER);
    const updated = await optionPATCH(json("PATCH", { expectedGroupVersion: createdBody.group.version, nutritionCalories: 45 }), {
      params: Promise.resolve({ ...groupParams, optionPublicId: option.publicId }),
    });
    expect(updated.status).toBe(200);
    const updatedBody = (await updated.json()) as OptionsBody;
    expect(updatedBody.group.options[0]!.nutritionCalories).toBe(45);

    const negative = await optionPATCH(json("PATCH", { expectedGroupVersion: updatedBody.group.version, nutritionCalories: -1 }), {
      params: Promise.resolve({ ...groupParams, optionPublicId: option.publicId }),
    });
    expect(negative.status).toBe(400);

    const cleared = await optionPATCH(json("PATCH", { expectedGroupVersion: updatedBody.group.version, nutritionCalories: null }), {
      params: Promise.resolve({ ...groupParams, optionPublicId: option.publicId }),
    });
    expect(cleared.status).toBe(200);
    expect(((await cleared.json()) as OptionsBody).group.options[0]!.nutritionCalories).toBeNull();

    const audit = await db
      .select()
      .from(tenantAuditEvents)
      .where(and(eq(tenantAuditEvents.tenantId, tenantId), eq(tenantAuditEvents.action, "catalogue.modifier_option.update")));
    expect(audit.map((event) => (event.changeSummary as { nutritionCalories?: unknown }).nutritionCalories)).toEqual([
      { before: 0, after: 45 },
      { before: 45, after: null },
    ]);
  });

  it("rejects option calories for a non-hospitality business", async () => {
    const { flowersTenantId, flowersAdmin } = await seed();
    const group = await createModifierGroup(
      db,
      flowersTenantId,
      { internalName: "wrap", translations: { en: { displayName: "Wrap" }, ar: { displayName: "تغليف" } } },
      FLOWERS_ADMIN,
      flowersAdmin,
    );
    as(FLOWERS_ADMIN);
    const response = await optionsPOST(
      json("POST", {
        expectedGroupVersion: group.version,
        nutritionCalories: 10,
        translations: { en: { displayName: "Paper" }, ar: { displayName: "ورق" } },
      }),
      { params: Promise.resolve({ tenantId: flowersTenantId, groupPublicId: group.publicId }) },
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as OptionsBody).field).toBe("nutritionCalories");
  });
});
