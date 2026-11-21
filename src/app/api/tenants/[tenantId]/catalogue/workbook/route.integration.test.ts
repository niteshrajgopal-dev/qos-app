import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  brands,
  catalogueCategories,
  catalogueCategoryTranslations,
  catalogueMenuLocations,
  catalogueMenus,
  catalogueMenuSectionProducts,
  catalogueMenuSections,
  catalogueMenuSectionTranslations,
  catalogueMenuTranslations,
  catalogueModifierGroups,
  catalogueModifierGroupTranslations,
  catalogueModifierOptions,
  catalogueModifierOptionTranslations,
  catalogueProductCategories,
  catalogueProductModifierGroups,
  catalogueProducts,
  catalogueProductTranslations,
  catalogueVariantLocationPriceOverrides,
  catalogueVariantPrices,
  catalogueVariants,
  catalogueVariantTranslations,
  staffIdentities,
  staffLocationScopes,
  staffMemberships,
  tenants,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { SUPPORTED_ENTITY_SHEETS } from "@/lib/workbook/contract";
import { loadCurrentRecordExport } from "@/lib/workbook/export";
import { buildFoodicsMenuFixture, FIXTURE_SHEETS } from "@/lib/workbook/foodics-menu/fixture";
import type { FoodicsMenuParseResult } from "@/lib/workbook/foodics-menu/reader";
import type { ExtendedWorkbookParseResult } from "@/lib/workbook/reader";
import { fillSheet, loadWorkbook, saveWorkbook, setManifestValue } from "@/lib/workbook/test-support";

import { POST as convertPOST } from "./convert/route";
import { GET as exportGET } from "./export/route";
import { POST as parsePOST } from "./parse/route";
import { GET as templateGET } from "./template/route";

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

const ADMIN = "admin.workbook@test";
const USER_HBZ = "user.workbook-hbz@test";
const FLOWERS_ADMIN = "admin.flowers.workbook@test";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

integrationDescribe("catalogue workbook routes (DB)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_product_categories, qos.catalogue_category_translations, qos.catalogue_categories, qos.catalogue_variant_location_price_overrides, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  async function seedMember(tenantId: string, subject: string, role: "administrator" | "user", locationIds: string[] = []) {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    for (const locationId of locationIds) {
      await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership.id, locationId });
    }
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  async function seed() {
    const quotes = await createQuotesTwoLocationTenant(db);
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const tenantId = quotes.tenant.id;
    const admin = await seedMember(tenantId, ADMIN, "administrator");
    await seedMember(tenantId, USER_HBZ, "user", [quotes.locationA.id]);
    await seedMember(flowers.tenant.id, FLOWERS_ADMIN, "administrator");

    const [category] = await db
      .insert(catalogueCategories)
      .values({ tenantId, publicId: "cat_hot", internalName: "hot-drinks", sortOrder: 1, status: "active", provenance: "operator_entered" })
      .returning();
    await db.insert(catalogueCategoryTranslations).values([
      { tenantId, categoryId: category.id, locale: "en", displayName: "Hot drinks" },
      { tenantId, categoryId: category.id, locale: "ar", displayName: "مشروبات ساخنة" },
    ]);

    const [product] = await db
      .insert(catalogueProducts)
      .values({
        tenantId,
        brandId: quotes.brand.id,
        publicId: "prd_flat_white",
        internalName: "flat-white",
        status: "active",
        provenance: "operator_entered",
        sku: "000123",
        barcode: "0062911234567",
        nutritionCalories: 120,
      })
      .returning();
    await db.insert(catalogueProductTranslations).values([
      { tenantId, productId: product.id, locale: "en", displayName: "Flat White", description: "Double shot" },
      { tenantId, productId: product.id, locale: "ar", displayName: "فلات وايت", description: "جرعتان" },
    ]);
    await db.insert(catalogueProductCategories).values({ tenantId, productId: product.id, categoryId: category.id, sortOrder: 2 });

    const [variant] = await db
      .insert(catalogueVariants)
      .values({ tenantId, productId: product.id, publicId: "var_flat_white_regular", isDefault: true, sortOrder: 0, sku: "000123-R" })
      .returning();
    await db.insert(catalogueVariantTranslations).values([
      { tenantId, variantId: variant.id, locale: "en", displayName: "Regular" },
      { tenantId, variantId: variant.id, locale: "ar", displayName: "عادي" },
    ]);
    await db.insert(catalogueVariantPrices).values({ tenantId, variantId: variant.id, currency: "AED", amountMinor: 1800 });
    await db.insert(catalogueVariantLocationPriceOverrides).values([
      { tenantId, variantId: variant.id, locationId: quotes.locationA.id, currency: "AED", amountMinor: 1900, centralPriceVersionAtOverride: 1, createdBySubject: ADMIN, updatedBySubject: ADMIN },
      { tenantId, variantId: variant.id, locationId: quotes.locationB.id, currency: "AED", amountMinor: 2000, centralPriceVersionAtOverride: 1, createdBySubject: ADMIN, updatedBySubject: ADMIN },
    ]);

    const [group] = await db
      .insert(catalogueModifierGroups)
      .values({ tenantId, publicId: "mg_milk", internalName: "milk", minSelections: 0, maxSelections: 1, provenance: "operator_entered" })
      .returning();
    await db.insert(catalogueModifierGroupTranslations).values([
      { tenantId, modifierGroupId: group.id, locale: "en", displayName: "Milk" },
      { tenantId, modifierGroupId: group.id, locale: "ar", displayName: "الحليب" },
    ]);
    const [option] = await db
      .insert(catalogueModifierOptions)
      .values({ tenantId, modifierGroupId: group.id, publicId: "opt_oat", priceMinor: 300, sortOrder: 1 })
      .returning();
    await db.insert(catalogueModifierOptionTranslations).values([
      { tenantId, modifierOptionId: option.id, locale: "en", displayName: "Oat milk" },
      { tenantId, modifierOptionId: option.id, locale: "ar", displayName: "حليب الشوفان" },
    ]);
    await db.insert(catalogueProductModifierGroups).values({ tenantId, productId: product.id, modifierGroupId: group.id, sortOrder: 0 });

    const [menu] = await db
      .insert(catalogueMenus)
      .values({ tenantId, brandId: quotes.brand.id, publicId: "menu_main", internalName: "main", provenance: "operator_entered" })
      .returning();
    await db.insert(catalogueMenuTranslations).values([
      { tenantId, menuId: menu.id, locale: "en", displayName: "Main menu" },
      { tenantId, menuId: menu.id, locale: "ar", displayName: "القائمة الرئيسية" },
    ]);
    await db.insert(catalogueMenuLocations).values([
      { tenantId, menuId: menu.id, locationId: quotes.locationA.id },
      { tenantId, menuId: menu.id, locationId: quotes.locationB.id },
    ]);
    const [section] = await db
      .insert(catalogueMenuSections)
      .values({ tenantId, menuId: menu.id, publicId: "sec_coffee", internalName: "coffee", sortOrder: 0 })
      .returning();
    await db.insert(catalogueMenuSectionTranslations).values([
      { tenantId, sectionId: section.id, locale: "en", displayName: "Coffee" },
      { tenantId, sectionId: section.id, locale: "ar", displayName: "القهوة" },
    ]);
    await db.insert(catalogueMenuSectionProducts).values({ tenantId, sectionId: section.id, productId: product.id, sortOrder: 0 });

    return { quotes, flowers, tenantId, admin, productId: product.id };
  }

  function as(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }

  function params(tenantId: string) {
    return { params: Promise.resolve({ tenantId }) };
  }

  async function exportAs(subject: string, tenantId: string, query = "") {
    as(subject);
    return exportGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/export${query}`), params(tenantId));
  }

  async function templateAs(subject: string, tenantId: string) {
    as(subject);
    return templateGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/template`), params(tenantId));
  }

  async function parseAs(subject: string, tenantId: string, bytes: Buffer, fileName = "upload.xlsx") {
    as(subject);
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], fileName));
    return parsePOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/parse`, { method: "POST", body: form }),
      params(tenantId),
    );
  }

  async function convertAs(subject: string, tenantId: string, bytes: Buffer, fileName = "menu.xlsx", brand?: string) {
    as(subject);
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], fileName));
    if (brand) form.set("brand", brand);
    return convertPOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/convert`, { method: "POST", body: form }),
      params(tenantId),
    );
  }

  let foodicsFixture: Promise<Buffer> | null = null;
  function foodicsMenu() {
    foodicsFixture ??= buildFoodicsMenuFixture({ filled: true, prefillLastRow: 200 });
    return foodicsFixture;
  }

  async function bytesOf(response: Response) {
    return Buffer.from(await response.arrayBuffer());
  }

  function sheetRows(result: ExtendedWorkbookParseResult, sheet: string) {
    return result.sheets.find((entry) => entry.sheet === sheet)!.rows.map((row) => row.values);
  }

  it("returns 401 on every workbook route when there is no staff session", async () => {
    const { tenantId } = await seed();
    vi.stubEnv("STAFF_BETTER_AUTH_SECRET", "qos193-route-test-secret-qos193-route-test");
    const actual = await vi.importActual<typeof import("@/lib/staff/auth")>("@/lib/staff/auth");
    staffMocks.requireStaffIdentity.mockImplementation(actual.requireStaffIdentity);

    const base = `http://localhost/api/tenants/${tenantId}/catalogue/workbook`;
    expect((await templateGET(new Request(`${base}/template`), params(tenantId))).status).toBe(401);
    const exported = await exportGET(new Request(`${base}/export`, { headers: { cookie: "qos-staff.session_token=forged.value" } }), params(tenantId));
    expect(exported.status).toBe(401);
    expect(exported.headers.get("content-type")).not.toBe(XLSX);
    const form = new FormData();
    form.set("file", new File([new Uint8Array(Buffer.from("a,b\n1,2"))], "x.csv"));
    expect((await parsePOST(new Request(`${base}/parse`, { method: "POST", body: form }), params(tenantId))).status).toBe(401);
    const converted = await convertPOST(new Request(`${base}/convert`, { method: "POST", body: form }), params(tenantId));
    expect(converted.status).toBe(401);
    expect(converted.headers.get("content-type")).not.toBe(XLSX);
  });

  it("returns 404 for another tenant, an unknown tenant and a malformed tenant id", async () => {
    const { tenantId, flowers } = await seed();

    const crossTenant = await exportAs(FLOWERS_ADMIN, tenantId);
    expect(crossTenant.status).toBe(404);
    expect(crossTenant.headers.get("content-type")).not.toBe(XLSX);
    expect((await templateAs(FLOWERS_ADMIN, tenantId)).status).toBe(404);
    expect((await parseAs(FLOWERS_ADMIN, tenantId, Buffer.from("a,b\n1,2"), "x.csv")).status).toBe(404);
    const crossConvert = await convertAs(FLOWERS_ADMIN, tenantId, await foodicsMenu());
    expect(crossConvert.status).toBe(404);
    expect(crossConvert.headers.get("content-type")).not.toBe(XLSX);
    expect((await convertAs(ADMIN, "00000000-0000-4000-8000-000000000000", await foodicsMenu())).status).toBe(404);
    expect((await exportAs(ADMIN, flowers.tenant.id)).status).toBe(404);
    expect((await exportAs(ADMIN, "00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await exportAs(ADMIN, "../../platform")).status).toBe(404);
  });

  it("returns 403 when the caller asks for a branch outside their scope", async () => {
    const { tenantId } = await seed();

    expect((await exportAs(USER_HBZ, tenantId, "?branch=loc_quotes_hct")).status).toBe(403);
    expect((await exportAs(USER_HBZ, tenantId, "?branch=all")).status).toBe(403);
    expect((await exportAs(USER_HBZ, tenantId, "?branch=loc_flowers_main")).status).toBe(403);
    expect((await exportAs(USER_HBZ, tenantId, "?branch=loc_quotes_hbz")).status).toBe(200);
  });

  it("keeps the existing tenant_inactive response for members of a suspended business", async () => {
    const { tenantId } = await seed();
    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenantId));
    const response = await exportAs(ADMIN, tenantId);
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "tenant_inactive" });
    const converted = await convertAs(ADMIN, tenantId, await foodicsMenu());
    expect(converted.status).toBe(403);
    expect(await converted.json()).toMatchObject({ code: "tenant_inactive" });
  });

  it("downloads the blank template as a real XLSX that parses as the expanded profile", async () => {
    const { tenantId } = await seed();
    const response = await templateAs(USER_HBZ, tenantId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(XLSX);
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="qos-menu-and-operations-template-v1.3.xlsx"',
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");

    const parsed = await parseAs(ADMIN, tenantId, await bytesOf(response));
    expect(parsed.status).toBe(200);
    const body = (await parsed.json()) as ExtendedWorkbookParseResult;
    expect(body.profile).toBe("qos_extended_v1");
    expect(body.manifest.tenant_public_id).toBe("");
    expect(body.summary.supported.rows).toBe(0);
  });

  it("exports the administrator's actual records with ids, keys, revisions and immutable context", async () => {
    const { tenantId } = await seed();
    const response = await exportAs(ADMIN, tenantId);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(XLSX);
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="qos-export-ten_quotes_dev-brd_quotes-\d{8}T\d{4}Z\.xlsx"$/,
    );

    const body = (await (await parseAs(ADMIN, tenantId, await bytesOf(response))).json()) as ExtendedWorkbookParseResult;
    expect(body.isExport).toBe(true);
    expect(body.issues).toEqual([]);
    expect(body.summary.errors).toBe(0);
    expect(body.manifest).toMatchObject({
      profile: "qos-extended-v1-proposed",
      template_version: "1.3",
      tenant_public_id: "ten_quotes_dev",
      brand_public_id: "brd_quotes",
      source_namespace: "qos:ten_quotes_dev",
      pilot_currency: "AED",
      business_timezone: "Asia/Dubai",
    });
    expect(body.manifest.export_revision).toMatch(/^rv1\.[A-Za-z0-9_-]{22}$/);
    expect(body.manifest.exported_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+00:00$/);

    expect(sheetRows(body, "Branches").map((row) => [row.branch_key, row.qos_location_id, row.name, row.status])).toEqual([
      ["loc_quotes_hbz", "loc_quotes_hbz", "HBZ Stadium", "active"],
      ["loc_quotes_hct", "loc_quotes_hct", "HCT Academic City", "active"],
    ]);
    expect(sheetRows(body, "Products")).toEqual([
      {
        product_key: "prd_flat_white",
        qos_product_id: "prd_flat_white",
        action: "skip",
        internal_name: "flat-white",
        display_name_en: "Flat White",
        display_name_ar: "فلات وايت",
        description_en: "Double shot",
        description_ar: "جرعتان",
        sku: "000123",
        barcode: "0062911234567",
        nutrition_calories: "120",
        // QOS-214 columns: an existing record has none of them, so they export blank.
        preparation_time_minutes: "",
        walking_time_minutes: "",
        high_salt: "",
        is_stock_product: "",
        image_url: "",
        status: "active",
        expected_revision: expect.stringMatching(/^rv1\./),
        clear_fields: "",
      },
    ]);
    expect(sheetRows(body, "Variants")[0]).toMatchObject({
      variant_key: "var_flat_white_regular",
      product_key: "prd_flat_white",
      variant_label_ar: "عادي",
      is_default: "TRUE",
      sku: "000123-R",
      amount_minor: "1800",
      currency: "AED",
      selling_quantity_basis: "",
      price_unit: "",
      price_unit_quantity: "",
    });
    expect(sheetRows(body, "Branch Prices").map((row) => [row.branch_key, row.amount_minor, row.central_price_version])).toEqual([
      ["loc_quotes_hbz", "1900", "1"],
      ["loc_quotes_hct", "2000", "1"],
    ]);
    expect(sheetRows(body, "Product Categories")[0]).toMatchObject({
      product_category_key: "prd_flat_white~cat_hot",
      product_key: "prd_flat_white",
      category_key: "cat_hot",
      sort_order: "2",
    });
    expect(sheetRows(body, "Product Categories")[0]!.qos_product_category_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(sheetRows(body, "Modifier Options")[0]).toMatchObject({
      modifier_group_key: "mg_milk",
      price_minor: "300",
      display_name_ar: "حليب الشوفان",
      nutrition_calories: "",
    });
    expect(sheetRows(body, "Product Modifiers")[0]).toMatchObject({
      product_key: "prd_flat_white",
      modifier_group_key: "mg_milk",
      min_selections: "",
      max_selections: "",
      repeat_allowed: "",
      selection_count_mode: "",
      free_options_count: "",
    });
    expect(sheetRows(body, "Menus")[0]).toMatchObject({ menu_key: "menu_main", display_name_ar: "القائمة الرئيسية", status: "draft" });
    expect(sheetRows(body, "Menu Branches").map((row) => row.branch_key)).toEqual(["loc_quotes_hbz", "loc_quotes_hct"]);
    expect(sheetRows(body, "Menu Sections")[0]).toMatchObject({ section_key: "sec_coffee", menu_key: "menu_main", archived: "FALSE" });
    expect(sheetRows(body, "Menu Items")[0]).toMatchObject({ section_key: "sec_coffee", product_key: "prd_flat_white" });
    for (const sheet of ["Units", "Opening Stock", "Future Combos", "Current Import"]) {
      expect(body.sheets.find((entry) => entry.sheet === sheet)!.rowCount, sheet).toBe(0);
    }
  });

  it("exports product modifier assignment overrides and folds the assignment version into its revision", async () => {
    const { tenantId, productId } = await seed();
    const exportModifiers = async () => {
      const body = (await (await parseAs(ADMIN, tenantId, await bytesOf(await exportAs(ADMIN, tenantId)))).json()) as ExtendedWorkbookParseResult;
      expect(body.summary.errors).toBe(0);
      return sheetRows(body, "Product Modifiers");
    };

    const [before] = await exportModifiers();
    const [link] = await db
      .update(catalogueProductModifierGroups)
      .set({ minSelections: 1, maxSelections: 2, repeatAllowed: false, selectionCountMode: "total_quantity", version: 2 })
      .where(eq(catalogueProductModifierGroups.productId, productId))
      .returning();

    const [after] = await exportModifiers();
    expect(after).toMatchObject({
      qos_product_modifier_id: link!.id,
      min_selections: "1",
      max_selections: "2",
      repeat_allowed: "FALSE",
      selection_count_mode: "total_quantity",
      free_options_count: "",
    });
    expect(after!.expected_revision).toMatch(/^rv1\./);
    expect(after!.expected_revision).not.toBe(before!.expected_revision);
  });

  it("exports supplied selling attributes and keeps unknown, zero and false distinct (QOS-214)", async () => {
    const { tenantId, productId } = await seed();
    await db
      .update(catalogueProducts)
      .set({ barcode: "001234", preparationTimeMinutes: 0, walkingTimeMinutes: 35, highSalt: false, directStockIntent: true })
      .where(eq(catalogueProducts.id, productId));
    await db
      .update(catalogueVariants)
      .set({ barcode: "001234", sellingQuantityBasis: "weight", priceUnit: "g", priceUnitQuantity: 100 })
      .where(eq(catalogueVariants.publicId, "var_flat_white_regular"));
    await db.update(catalogueModifierOptions).set({ nutritionCalories: 0 }).where(eq(catalogueModifierOptions.publicId, "opt_oat"));

    const body = (await (await parseAs(ADMIN, tenantId, await bytesOf(await exportAs(ADMIN, tenantId)))).json()) as ExtendedWorkbookParseResult;
    expect(body.summary.errors).toBe(0);
    expect(body.sheets.flatMap((entry) => entry.issues).filter((issue) => issue.code === "missing_columns")).toEqual([]);
    expect(sheetRows(body, "Products")[0]).toMatchObject({
      barcode: "001234",
      preparation_time_minutes: "0",
      walking_time_minutes: "35",
      high_salt: "FALSE",
      is_stock_product: "TRUE",
      nutrition_calories: "120",
      description_ar: "جرعتان",
    });
    expect(sheetRows(body, "Variants")[0]).toMatchObject({
      barcode: "001234",
      selling_quantity_basis: "weight",
      price_unit: "g",
      price_unit_quantity: "100",
    });
    expect(sheetRows(body, "Modifier Options")[0]).toMatchObject({ nutrition_calories: "0" });

    await db
      .update(catalogueProducts)
      .set({ highSalt: true, walkingTimeMinutes: null, directStockIntent: null })
      .where(eq(catalogueProducts.id, productId));
    const again = (await (await parseAs(ADMIN, tenantId, await bytesOf(await exportAs(ADMIN, tenantId)))).json()) as ExtendedWorkbookParseResult;
    expect(sheetRows(again, "Products")[0]).toMatchObject({ high_salt: "TRUE", walking_time_minutes: "", is_stock_product: "" });
  });

  it("limits branch rows, branch prices and menu branches to the caller's permitted branches", async () => {
    const { tenantId } = await seed();

    const user = (await (await parseAs(USER_HBZ, tenantId, await bytesOf(await exportAs(USER_HBZ, tenantId)))).json()) as ExtendedWorkbookParseResult;
    expect(sheetRows(user, "Branches").map((row) => row.branch_key)).toEqual(["loc_quotes_hbz"]);
    expect(sheetRows(user, "Branch Prices").map((row) => row.branch_key)).toEqual(["loc_quotes_hbz"]);
    expect(sheetRows(user, "Menu Branches").map((row) => row.branch_key)).toEqual(["loc_quotes_hbz"]);
    expect(sheetRows(user, "Products")).toHaveLength(1);

    const adminHct = (await (await parseAs(ADMIN, tenantId, await bytesOf(await exportAs(ADMIN, tenantId, "?branch=loc_quotes_hct")))).json()) as ExtendedWorkbookParseResult;
    expect(sheetRows(adminHct, "Branches").map((row) => row.branch_key)).toEqual(["loc_quotes_hct"]);
    expect(sheetRows(adminHct, "Branch Prices").map((row) => row.amount_minor)).toEqual(["2000"]);
  });

  it("asks for a brand when the business has several, and refuses a brand it does not own", async () => {
    const { tenantId, quotes, flowers } = await seed();
    await db
      .insert(brands)
      .values({ tenantId, organizationId: quotes.organization.id, publicId: "brd_azur", name: "Azur" });

    const ambiguous = await exportAs(ADMIN, tenantId);
    expect(ambiguous.status).toBe(400);
    expect(await ambiguous.json()).toMatchObject({
      code: "brand_required",
      brands: [
        { publicId: "brd_azur", name: "Azur" },
        { publicId: "brd_quotes", name: "Quotes" },
      ],
    });

    const azur = await exportAs(ADMIN, tenantId, "?brand=brd_azur");
    expect(azur.status).toBe(200);
    const body = (await (await parseAs(ADMIN, tenantId, await bytesOf(azur))).json()) as ExtendedWorkbookParseResult;
    expect(body.manifest.brand_public_id).toBe("brd_azur");
    expect(sheetRows(body, "Products")).toEqual([]);
    expect(sheetRows(body, "Branches")).toEqual([]);

    expect((await exportAs(ADMIN, tenantId, `?brand=${flowers.brand.publicId}`)).status).toBe(404);
  });

  it("derives stable revision tokens that change only when the record changes", async () => {
    const { tenantId, admin, productId } = await seed();
    const first = await loadCurrentRecordExport(db, tenantId, admin);
    const again = await loadCurrentRecordExport(db, tenantId, admin);
    expect(again.records).toEqual(first.records);
    expect(again.manifest.export_revision).toBe(first.manifest.export_revision);

    await db
      .update(catalogueProducts)
      .set({ version: 2, updatedAt: new Date("2026-11-20T10:00:00Z") })
      .where(eq(catalogueProducts.id, productId));
    const changed = await loadCurrentRecordExport(db, tenantId, admin);
    expect(changed.records.Products[0]!.expected_revision).not.toBe(first.records.Products[0]!.expected_revision);
    expect(changed.records.Categories).toEqual(first.records.Categories);
    expect(changed.manifest.export_revision).not.toBe(first.manifest.export_revision);
  });

  it("round-trips: export, parse, then a changed cell changes the parsed record", async () => {
    const { tenantId, admin } = await seed();
    const data = await loadCurrentRecordExport(db, tenantId, admin);
    const exported = await bytesOf(await exportAs(ADMIN, tenantId));

    const parsed = (await (await parseAs(ADMIN, tenantId, exported)).json()) as ExtendedWorkbookParseResult;
    for (const sheet of SUPPORTED_ENTITY_SHEETS) {
      expect(sheetRows(parsed, sheet), sheet).toEqual(data.records[sheet]);
    }

    const workbook = await loadWorkbook(exported);
    fillSheet(workbook, "Products", 6, [{ action: "update", display_name_en: "Flat White (large)" }]);
    const edited = (await (await parseAs(ADMIN, tenantId, await saveWorkbook(workbook))).json()) as ExtendedWorkbookParseResult;
    expect(sheetRows(edited, "Products")[0]).toMatchObject({
      action: "update",
      display_name_en: "Flat White (large)",
      expected_revision: data.records.Products[0]!.expected_revision,
    });
    expect(edited.fileFingerprint).not.toBe(parsed.fileFingerprint);
  });

  it("flags an uploaded workbook whose context names another tenant", async () => {
    const { tenantId } = await seed();
    const workbook = await loadWorkbook(await bytesOf(await exportAs(ADMIN, tenantId)));
    setManifestValue(workbook, "tenant_public_id", "ten_flowers_dev");
    const body = (await (await parseAs(ADMIN, tenantId, await saveWorkbook(workbook))).json()) as ExtendedWorkbookParseResult;
    expect(body.issues).toContainEqual(
      expect.objectContaining({ code: "tenant_mismatch", severity: "error", params: { found: "ten_flowers_dev", expected: "ten_quotes_dev" } }),
    );
  });

  it("answers parse failures with a recoverable code and keeps the legacy profile", async () => {
    const { tenantId } = await seed();

    as(ADMIN);
    const missing = await parsePOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/parse`, { method: "POST", body: new FormData() }),
      params(tenantId),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "file_required" });

    const wrong = await parseAs(ADMIN, tenantId, Buffer.from("%PDF-1.7"), "menu.pdf");
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ code: "wrong_type" });

    const empty = await parseAs(ADMIN, tenantId, Buffer.alloc(0), "empty.csv");
    expect(await empty.json()).toMatchObject({ code: "empty_file" });

    const oversize = await parseAs(ADMIN, tenantId, Buffer.alloc(8 * 1024 * 1024 + 1, 0x41), "big.csv");
    expect(oversize.status).toBe(413);
    expect(await oversize.json()).toMatchObject({ code: "file_too_large" });

    const legacy = await parseAs(
      ADMIN,
      tenantId,
      Buffer.from("source_id,internal_name,display_name_en,display_name_ar,amount_minor,currency\nq1,flat,Flat,فلات,1800,AED"),
      "current.csv",
    );
    expect(legacy.status).toBe(200);
    expect(await legacy.json()).toMatchObject({ profile: "legacy_flat", rowCount: 1, rows: [{ source_id: "q1", amount_minor: "1800" }] });
  });

  it("writes nothing: no catalogue change and no audit event", async () => {
    const { tenantId } = await seed();
    const before = await db.select().from(catalogueProducts);

    const exported = await bytesOf(await exportAs(ADMIN, tenantId));
    await parseAs(ADMIN, tenantId, exported);
    await templateAs(ADMIN, tenantId);

    expect(await db.select().from(catalogueProducts)).toEqual(before);
    const [{ count }] = await sqlClient`SELECT count(*)::int AS count FROM qos.tenant_audit_events`;
    expect(count).toBe(0);
  });

  it("recognises the Foodics menu workbook on parse with the tenant's currency, brand and namespace", async () => {
    const { tenantId } = await seed();
    const response = await parseAs(USER_HBZ, tenantId, await foodicsMenu());
    expect(response.status).toBe(200);
    const body = (await response.json()) as FoodicsMenuParseResult;
    expect(body.profile).toBe("foodics_menu_v1");
    expect(body.context).toEqual({
      tenantPublicId: "ten_quotes_dev",
      brandPublicId: "brd_quotes",
      currency: "AED",
      sourceNamespace: "foodics-menu-v1:ten_quotes_dev",
    });
    expect(body.summary).toMatchObject({ errors: 0, recognizedRows: 16, deferredRows: 18 });
    expect(body.sheets.find((sheet) => sheet.sheet === "Variants")!.rows[0]!.values).toMatchObject({ amount_minor: "1250", currency: "AED" });
  });

  it("converts the Foodics menu workbook into a QOS workbook that reads back with the tenant context", async () => {
    const { tenantId } = await seed();
    const response = await convertAs(USER_HBZ, tenantId, await foodicsMenu());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(XLSX);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="qos-converted-foodics-menu-v1-ten_quotes_dev-[0-9a-f]{8}\.xlsx"$/,
    );

    const body = (await (await parseAs(ADMIN, tenantId, await bytesOf(response))).json()) as ExtendedWorkbookParseResult;
    expect(body.profile).toBe("qos_extended_v1");
    expect(body.isExport).toBe(false);
    expect(body.issues).toEqual([]);
    expect(body.summary.errors).toBe(0);
    expect(body.manifest).toMatchObject({
      tenant_public_id: "ten_quotes_dev",
      brand_public_id: "brd_quotes",
      source_namespace: "foodics-menu-v1:ten_quotes_dev",
      pilot_currency: "AED",
      business_timezone: "Asia/Dubai",
    });
    expect(body.manifestExtensions).toMatchObject({ source_profile: "foodics_menu_v1", dictionary_version: "1.1" });
    expect(sheetRows(body, "Products").map((row) => [row.sku, row.barcode, row.display_name_ar])).toEqual([
      ["000123", "0062911234567", "فلات وايت"],
      ["000124", "0062911234574", "فانيلا لاتيه"],
      ["000125", "", "كرك"],
    ]);
    expect(sheetRows(body, "Branch Prices")).toEqual([]);
  });

  it("asks for a brand on convert when the business has several, and refuses another tenant's brand", async () => {
    const { tenantId, quotes, flowers } = await seed();
    await db.insert(brands).values({ tenantId, organizationId: quotes.organization.id, publicId: "brd_azur", name: "Azur" });

    const parsed = (await (await parseAs(ADMIN, tenantId, await foodicsMenu())).json()) as FoodicsMenuParseResult;
    expect(parsed.requiredMappings.find((mapping) => mapping.kind === "brand")).toEqual({
      kind: "brand",
      status: "required",
      choices: [
        { publicId: "brd_azur", name: "Azur" },
        { publicId: "brd_quotes", name: "Quotes" },
      ],
    });

    const ambiguous = await convertAs(ADMIN, tenantId, await foodicsMenu());
    expect(ambiguous.status).toBe(400);
    expect(await ambiguous.json()).toMatchObject({ code: "brand_required", brands: [{ publicId: "brd_azur" }, { publicId: "brd_quotes" }] });

    const chosen = await convertAs(ADMIN, tenantId, await foodicsMenu(), "menu.xlsx", "brd_azur");
    expect(chosen.status).toBe(200);
    const body = (await (await parseAs(ADMIN, tenantId, await bytesOf(chosen))).json()) as ExtendedWorkbookParseResult;
    expect(body.manifest.brand_public_id).toBe("brd_azur");

    const foreign = await convertAs(ADMIN, tenantId, await foodicsMenu(), "menu.xlsx", flowers.brand.publicId);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toMatchObject({ code: "brand_not_found" });
  });

  it("refuses to convert a QOS workbook, a current catalogue file or a modified layout", async () => {
    const { tenantId } = await seed();
    const template = await convertAs(ADMIN, tenantId, await bytesOf(await templateAs(ADMIN, tenantId)), "template.xlsx");
    expect(template.status).toBe(400);
    expect(await template.json()).toMatchObject({ code: "convert_unsupported_profile", params: { profile: "qos_extended_v1" } });

    const csv = await convertAs(ADMIN, tenantId, Buffer.from("source_id,internal_name\nq1,flat"), "current.csv");
    expect(csv.status).toBe(400);
    expect(await csv.json()).toMatchObject({ code: "convert_unsupported_profile", params: { profile: "legacy_flat" } });

    const modified = await buildFoodicsMenuFixture({
      filled: true,
      prefillLastRow: 40,
      edit: (workbook) => {
        workbook.getWorksheet(FIXTURE_SHEETS.products)!.getCell("K6").value = "Amount";
      },
    });
    const partial = await convertAs(ADMIN, tenantId, modified);
    expect(partial.status).toBe(400);
    expect(await partial.json()).toMatchObject({ code: "source_layout_partial", params: { region: "products", missingHeaders: "price" } });
    const parsedPartial = await parseAs(ADMIN, tenantId, modified);
    expect(parsedPartial.status).toBe(400);
    expect(await parsedPartial.json()).toMatchObject({ code: "source_layout_partial" });

    as(ADMIN);
    const missing = await convertPOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/convert`, { method: "POST", body: new FormData() }),
      params(tenantId),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "file_required" });
  });

  it("parse and convert write nothing: no catalogue change and no audit event", async () => {
    const { tenantId } = await seed();
    const counts = async () => {
      const [row] = await sqlClient`
        SELECT
          (SELECT count(*)::int FROM qos.catalogue_categories) AS categories,
          (SELECT count(*)::int FROM qos.catalogue_products) AS products,
          (SELECT count(*)::int FROM qos.catalogue_product_categories) AS product_categories,
          (SELECT count(*)::int FROM qos.catalogue_variants) AS variants,
          (SELECT count(*)::int FROM qos.catalogue_variant_prices) AS prices,
          (SELECT count(*)::int FROM qos.catalogue_variant_location_price_overrides) AS overrides,
          (SELECT count(*)::int FROM qos.catalogue_modifier_groups) AS groups,
          (SELECT count(*)::int FROM qos.catalogue_modifier_options) AS options,
          (SELECT count(*)::int FROM qos.catalogue_product_modifier_groups) AS product_groups,
          (SELECT count(*)::int FROM qos.catalogue_menus) AS menus,
          (SELECT count(*)::int FROM qos.tenant_audit_events) AS audit_events`;
      return row;
    };
    const before = await counts();
    const productsBefore = await db.select().from(catalogueProducts);

    expect((await parseAs(ADMIN, tenantId, await foodicsMenu())).status).toBe(200);
    expect((await convertAs(ADMIN, tenantId, await foodicsMenu())).status).toBe(200);

    expect(await counts()).toEqual(before);
    expect(before.audit_events).toBe(0);
    expect(await db.select().from(catalogueProducts)).toEqual(productsBefore);
  });
});
