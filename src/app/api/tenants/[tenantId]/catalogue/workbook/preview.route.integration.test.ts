import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";
import { eq, sql as dsql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  brands,
  catalogueCategories,
  catalogueCategoryTranslations,
  catalogueImportSourceLinks,
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
import { buildFoodicsMenuFixture } from "@/lib/workbook/foodics-menu/fixture";
import { fillSheet, loadWorkbook, saveWorkbook } from "@/lib/workbook/test-support";
import type { ReviewRow, WorkbookReviewResult } from "@/lib/workbook/validation/model";

import { GET as exportGET } from "./export/route";
import { GET as reportGET } from "./plans/[planPublicId]/correction-report/route";
import { POST as reviewPOST } from "./plans/[planPublicId]/review/route";
import { GET as planGET } from "./plans/[planPublicId]/route";
import { POST as previewPOST } from "./preview/route";

/* QOS-194 review routes against local Postgres. Seed and auth mocks follow
   the QOS-193/216 workbook route test (copied here; that file is unchanged). */

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

integrationDescribe("catalogue workbook review routes (DB)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.workbook_import_plan_rows, qos.workbook_import_plans, qos.catalogue_import_source_links, qos.tenant_audit_events, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_product_categories, qos.catalogue_category_translations, qos.catalogue_categories, qos.catalogue_variant_location_price_overrides, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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

  let foodicsFixture: Promise<Buffer> | null = null;
  function foodicsMenu() {
    foodicsFixture ??= buildFoodicsMenuFixture({ filled: true, prefillLastRow: 200 });
    return foodicsFixture;
  }

  async function bytesOf(response: Response) {
    return Buffer.from(await response.arrayBuffer());
  }

  let keyCounter = 0;
  function nextKey() {
    keyCounter += 1;
    return `test-key-${keyCounter}`;
  }

  async function previewAs(
    subject: string,
    tenantId: string,
    bytes: Buffer,
    options: { key?: string | null; brand?: string; branch?: string; decisions?: unknown; fileName?: string } = {},
  ) {
    as(subject);
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], options.fileName ?? "upload.xlsx"));
    if (options.brand) form.set("brand", options.brand);
    if (options.branch) form.set("branch", options.branch);
    if (options.decisions) form.set("decisions", JSON.stringify(options.decisions));
    const headers = new Headers();
    const key = options.key === undefined ? nextKey() : options.key;
    if (key) headers.set("Idempotency-Key", key);
    return previewPOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/preview`, { method: "POST", body: form, headers }),
      params(tenantId),
    );
  }

  function planParams(tenantId: string, planPublicId: string) {
    return { params: Promise.resolve({ tenantId, planPublicId }) };
  }

  async function planAs(subject: string, tenantId: string, planPublicId: string) {
    as(subject);
    return planGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${planPublicId}`), planParams(tenantId, planPublicId));
  }

  async function reviewAs(subject: string, tenantId: string, planPublicId: string, body: unknown) {
    as(subject);
    return reviewPOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${planPublicId}/review`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      }),
      planParams(tenantId, planPublicId),
    );
  }

  async function reportAs(subject: string, tenantId: string, planPublicId: string, locale = "en") {
    as(subject);
    return reportGET(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${planPublicId}/correction-report?locale=${locale}`),
      planParams(tenantId, planPublicId),
    );
  }

  async function exportBytes(subject: string, tenantId: string, query = "") {
    as(subject);
    const response = await exportGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/export${query}`), params(tenantId));
    expect(response.status).toBe(200);
    return bytesOf(response);
  }

  async function ok(response: Response) {
    const body = await response.json();
    expect(response.status, JSON.stringify(body).slice(0, 400)).toBe(200);
    return body as WorkbookReviewResult;
  }

  function find(result: WorkbookReviewResult, sheet: string, predicate: (row: ReviewRow) => boolean) {
    const row = result.rows.find((entry) => entry.sheet === sheet && predicate(entry));
    expect(row, sheet).toBeTruthy();
    return row!;
  }

  async function catalogueState() {
    const [row] = await sqlClient`
      SELECT
        (SELECT count(*)::int FROM qos.catalogue_products) AS products,
        (SELECT max(updated_at) FROM qos.catalogue_products) AS products_updated,
        (SELECT count(*)::int FROM qos.catalogue_product_translations) AS product_translations,
        (SELECT max(updated_at) FROM qos.catalogue_product_translations) AS product_translations_updated,
        (SELECT count(*)::int FROM qos.catalogue_variants) AS variants,
        (SELECT max(updated_at) FROM qos.catalogue_variants) AS variants_updated,
        (SELECT count(*)::int FROM qos.catalogue_variant_prices) AS prices,
        (SELECT max(updated_at) FROM qos.catalogue_variant_prices) AS prices_updated,
        (SELECT count(*)::int FROM qos.catalogue_variant_location_price_overrides) AS overrides,
        (SELECT count(*)::int FROM qos.catalogue_categories) AS categories,
        (SELECT max(updated_at) FROM qos.catalogue_categories) AS categories_updated,
        (SELECT count(*)::int FROM qos.catalogue_product_categories) AS product_categories,
        (SELECT count(*)::int FROM qos.catalogue_modifier_groups) AS groups,
        (SELECT max(updated_at) FROM qos.catalogue_modifier_groups) AS groups_updated,
        (SELECT count(*)::int FROM qos.catalogue_modifier_options) AS options,
        (SELECT max(updated_at) FROM qos.catalogue_modifier_options) AS options_updated,
        (SELECT count(*)::int FROM qos.catalogue_product_modifier_groups) AS product_groups,
        (SELECT count(*)::int FROM qos.catalogue_menus) AS menus,
        (SELECT max(updated_at) FROM qos.catalogue_menus) AS menus_updated,
        (SELECT count(*)::int FROM qos.catalogue_import_source_links) AS source_links,
        (SELECT count(*)::int FROM qos.tenant_audit_events) AS audit_events`;
    return row;
  }

  it("returns 401 on every review route without a staff session", async () => {
    const { tenantId } = await seed();
    vi.stubEnv("STAFF_BETTER_AUTH_SECRET", "qos194-route-test-secret-qos194-route-test");
    const actual = await vi.importActual<typeof import("@/lib/staff/auth")>("@/lib/staff/auth");
    staffMocks.requireStaffIdentity.mockImplementation(actual.requireStaffIdentity);
    const base = `http://localhost/api/tenants/${tenantId}/catalogue/workbook`;
    const form = new FormData();
    form.set("file", new File([new Uint8Array(await foodicsMenu())], "menu.xlsx"));
    expect((await previewPOST(new Request(`${base}/preview`, { method: "POST", body: form, headers: { "Idempotency-Key": "k" } }), params(tenantId))).status).toBe(401);
    const plan = "wbp_0000000000000000";
    expect((await planGET(new Request(`${base}/plans/${plan}`), planParams(tenantId, plan))).status).toBe(401);
    expect((await reviewPOST(new Request(`${base}/plans/${plan}/review`, { method: "POST", body: "{}" }), planParams(tenantId, plan))).status).toBe(401);
    const report = await reportGET(new Request(`${base}/plans/${plan}/correction-report`), planParams(tenantId, plan));
    expect(report.status).toBe(401);
    expect(report.headers.get("content-type")).not.toBe(XLSX);
  });

  it("answers 404 for another tenant, unknown or malformed tenants and another tenant's plan; 403 for branches out of scope and inactive businesses", async () => {
    const { tenantId, flowers } = await seed();
    const bytes = await foodicsMenu();
    expect((await previewAs(FLOWERS_ADMIN, tenantId, bytes)).status).toBe(404);
    expect((await previewAs(ADMIN, "00000000-0000-4000-8000-000000000000", bytes)).status).toBe(404);
    expect((await previewAs(ADMIN, "../../platform", bytes)).status).toBe(404);

    const plan = await ok(await previewAs(ADMIN, tenantId, bytes));
    expect((await planAs(FLOWERS_ADMIN, tenantId, plan.plan.publicId)).status).toBe(404);
    expect((await planAs(FLOWERS_ADMIN, flowers.tenant.id, plan.plan.publicId)).status).toBe(404);
    expect((await reportAs(FLOWERS_ADMIN, flowers.tenant.id, plan.plan.publicId)).status).toBe(404);
    expect((await reviewAs(FLOWERS_ADMIN, flowers.tenant.id, plan.plan.publicId, { expectedPlanHash: plan.plan.planHash, decisions: [] })).status).toBe(404);
    expect((await planAs(ADMIN, tenantId, "wbp_ffffffffffffffff")).status).toBe(404);
    expect((await planAs(ADMIN, tenantId, "not-a-plan")).status).toBe(404);

    expect((await previewAs(USER_HBZ, tenantId, bytes, { branch: "loc_quotes_hct" })).status).toBe(403);
    expect((await previewAs(USER_HBZ, tenantId, bytes, { branch: "loc_flowers_main" })).status).toBe(403);

    await db.update(tenants).set({ status: "suspended" }).where(eq(tenants.id, tenantId));
    const inactive = await previewAs(ADMIN, tenantId, bytes);
    expect(inactive.status).toBe(403);
    expect(await inactive.json()).toMatchObject({ code: "tenant_inactive" });
    const inactivePlan = await planAs(ADMIN, tenantId, plan.plan.publicId);
    expect(inactivePlan.status).toBe(403);
  });

  it("gives a scoped user a 200 with the other branch's price row Invalid, not a 403", async () => {
    const { tenantId } = await seed();
    const workbook = await loadWorkbook(await exportBytes(ADMIN, tenantId));
    fillSheet(workbook, "Branch Prices", 6, [{}, { action: "update", amount_minor: "2100" }]);
    const result = await ok(await previewAs(USER_HBZ, tenantId, await saveWorkbook(workbook)));
    expect(result.context.branchScope).toEqual(["loc_quotes_hbz"]);
    const hct = find(result, "Branch Prices", (row) => row.key.includes("loc_quotes_hct"));
    expect(hct.classification).toBe("invalid");
    expect(hct.diagnostics).toContainEqual(expect.objectContaining({ code: "branch_not_permitted", params: { branch: "loc_quotes_hct" } }));
    expect(find(result, "Branch Prices", (row) => row.key.includes("loc_quotes_hbz")).classification).toBe("skipped");
  });

  it("round-trips an export: untouched is all Skipped; real edits give real diffs, collisions and stale revisions", async () => {
    const { tenantId, productId } = await seed();
    const exported = await exportBytes(ADMIN, tenantId);
    const untouched = await ok(await previewAs(ADMIN, tenantId, exported));
    expect(untouched.context).toMatchObject({ keysVerified: true, isExport: true, sourceNamespace: "qos:ten_quotes_dev", branchScope: "all" });
    expect(untouched.counts).toMatchObject({ create: 0, update: 0, conflicting: 0, invalid: 0, blocked: 0 });
    expect(untouched.counts.skipped).toBe(untouched.counts.rows);
    expect(untouched.rows.every((row) => row.changes.length === 0)).toBe(true);

    const workbook = await loadWorkbook(exported);
    fillSheet(workbook, "Variants", 6, [{ action: "update", amount_minor: "1900" }]);
    fillSheet(workbook, "Products", 6, [
      { action: "update", display_name_en: "Flat White (large)" },
      { product_key: "new-fw", action: "create", internal_name: "flat-white-2", display_name_en: "Flat White", display_name_ar: "فلات وايت ٢", status: "draft" },
      { product_key: "prd_flowers_rose", qos_product_id: "prd_flowers_rose", action: "update", internal_name: "rose", display_name_en: "Rose", display_name_ar: "وردة", status: "draft" },
    ]);
    const edited = await saveWorkbook(workbook);
    const result = await ok(await previewAs(ADMIN, tenantId, edited));
    const variant = find(result, "Variants", (row) => row.key === "var_flat_white_regular");
    expect(variant).toMatchObject({ classification: "update", operation: "update", changes: [{ column: "amount_minor", before: "1800", after: "1900" }] });
    expect(find(result, "Products", (row) => row.key === "prd_flat_white")).toMatchObject({
      classification: "update",
      changes: [{ column: "display_name_en", before: "Flat White", after: "Flat White (large)" }],
    });
    const collision = find(result, "Products", (row) => row.key === "new-fw");
    expect(collision).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "prd_flat_white" })] });
    expect(collision.diagnostics).toContainEqual(expect.objectContaining({ code: "name_collision" }));
    expect(find(result, "Products", (row) => row.key === "prd_flowers_rose").diagnostics).toContainEqual(expect.objectContaining({ code: "target_not_found" }));

    await db.update(catalogueProducts).set({ version: dsql`${catalogueProducts.version} + 1`, updatedAt: new Date("2026-11-22T08:00:00Z") }).where(eq(catalogueProducts.id, productId));
    const stale = await ok(await previewAs(ADMIN, tenantId, edited));
    const product = find(stale, "Products", (row) => row.key === "prd_flat_white");
    expect(product.classification).toBe("conflicting");
    expect(product.diagnostics).toContainEqual(expect.objectContaining({ code: "stale_revision" }));
    expect(stale.notices).toContainEqual(expect.objectContaining({ code: "export_outdated" }));
  });

  it("reviews the Foodics menu against a tenant that already has Flat White: conflicts, decisions and no silent duplicate", async () => {
    const { tenantId } = await seed();
    const bytes = await foodicsMenu();
    const first = await ok(await previewAs(ADMIN, tenantId, bytes));
    expect(first.context).toMatchObject({ profile: "foodics_menu_v1", keysVerified: false, sourceNamespace: "foodics-menu-v1:ten_quotes_dev", currency: "AED" });
    const product = find(first, "Products", (row) => row.key.startsWith("prd~flat-white"));
    expect(product).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "prd_flat_white" })] });
    const variant = find(first, "Variants", (row) => row.key.startsWith("prd~flat-white"));
    expect(variant).toMatchObject({ classification: "blocked", dependencies: { blockedBy: [{ sheet: "Products", row: product.row, key: product.key }] } });
    expect(variant.deferredFields.find((field) => field.column === "tax_rate_basis_points")).toMatchObject({ display: { basisPoints: 500, percentDisplay: "5%" } });

    const again = await ok(await previewAs(ADMIN, tenantId, bytes));
    expect(again.plan.publicId).not.toBe(first.plan.publicId);
    expect(again.rows.map((row) => [row.sheet, row.row, row.classification])).toEqual(first.rows.map((row) => [row.sheet, row.row, row.classification]));
    const colliding = ["Flat White", "Hot drinks"];
    expect(again.rows.filter((row) => row.classification === "create" && colliding.includes(row.label.en))).toEqual([]);

    const matched = await ok(
      await reviewAs(ADMIN, tenantId, first.plan.publicId, {
        expectedPlanHash: first.plan.planHash,
        decisions: [{ kind: "match_existing", sheet: "Products", row: product.row, targetPublicId: "prd_flat_white" }],
      }),
    );
    expect(matched.plan.revision).toBe(2);
    const updated = find(matched, "Products", (row) => row.key === product.key);
    expect(updated).toMatchObject({ classification: "update", identity: { via: "decision", targetPublicId: "prd_flat_white" } });
    const changed = updated.changes.map((change) => change.column);
    expect(changed).toEqual(expect.arrayContaining(["description_en"]));
    expect(changed).not.toContain("sku");
    expect(changed).not.toContain("barcode");
    expect(changed).not.toContain("display_name_en");
    const pending = find(matched, "Variants", (row) => row.key === variant.key);
    expect(pending).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "var_flat_white_regular" })] });

    const priced = await ok(
      await reviewAs(ADMIN, tenantId, first.plan.publicId, {
        expectedPlanHash: matched.plan.planHash,
        decisions: [
          { kind: "match_existing", sheet: "Products", row: product.row, targetPublicId: "prd_flat_white" },
          { kind: "match_existing", sheet: "Variants", row: variant.row, targetPublicId: "var_flat_white_regular" },
        ],
      }),
    );
    expect(find(priced, "Variants", (row) => row.key === variant.key)).toMatchObject({ classification: "update" });
    expect(find(priced, "Variants", (row) => row.key === variant.key).changes).toContainEqual(
      expect.objectContaining({ column: "amount_minor", before: "1800", after: "1250" }),
    );
  });

  it("writes only the plan tables: no catalogue change, no source link and no audit event", async () => {
    const { tenantId } = await seed();
    const before = await catalogueState();
    const productsBefore = await db.select().from(catalogueProducts);
    const plan = await ok(await previewAs(ADMIN, tenantId, await foodicsMenu()));
    await ok(await planAs(ADMIN, tenantId, plan.plan.publicId));
    await ok(await reviewAs(ADMIN, tenantId, plan.plan.publicId, { expectedPlanHash: plan.plan.planHash, decisions: [{ kind: "acknowledge_partial_apply" }] }));
    expect((await reportAs(ADMIN, tenantId, plan.plan.publicId)).status).toBe(200);
    expect(await catalogueState()).toEqual(before);
    expect(before.audit_events).toBe(0);
    expect(await db.select().from(catalogueProducts)).toEqual(productsBefore);
    const [{ count }] = await sqlClient`SELECT count(*)::int AS count FROM qos.workbook_import_plans`;
    expect(count).toBe(1);
  });

  it("persists plans: idempotent replay, key reuse, missing key, hash mismatch, staleness and who may re-review", async () => {
    const { tenantId, productId } = await seed();
    const bytes = await foodicsMenu();
    expect((await previewAs(ADMIN, tenantId, bytes, { key: null })).status).toBe(400);

    const created = await ok(await previewAs(USER_HBZ, tenantId, bytes, { key: "same-key" }));
    expect(created.plan).toMatchObject({ revision: 1, status: "review_ready", createdBySubject: USER_HBZ });
    expect(created.plan.publicId).toMatch(/^wbp_[0-9a-f]{16}$/);
    const [header] = await sqlClient`SELECT count(*)::int AS rows FROM qos.workbook_import_plan_rows`;
    expect(header!.rows).toBe(created.counts.rows);

    const replay = await previewAs(USER_HBZ, tenantId, bytes, { key: "same-key" });
    const replayed = await ok(replay);
    expect(replayed).toMatchObject({ replayed: true, plan: { publicId: created.plan.publicId, planHash: created.plan.planHash } });
    const reused = await previewAs(USER_HBZ, tenantId, await buildFoodicsMenuFixture({ filled: true, prefillLastRow: 30 }), { key: "same-key" });
    expect(reused.status).toBe(409);
    expect(await reused.json()).toMatchObject({ code: "idempotency_key_reused" });

    const mismatch = await reviewAs(USER_HBZ, tenantId, created.plan.publicId, { expectedPlanHash: "0".repeat(64), decisions: [] });
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ code: "plan_hash_mismatch" });
    const malformed = await reviewAs(USER_HBZ, tenantId, created.plan.publicId, { expectedPlanHash: created.plan.planHash, decisions: [{ kind: "drop_table" }] });
    expect(malformed.status).toBe(400);

    const fresh = await ok(await planAs(USER_HBZ, tenantId, created.plan.publicId));
    expect(fresh).toMatchObject({ stale: false, plan: { status: "review_ready" } });

    await db.update(catalogueProducts).set({ updatedAt: new Date("2026-11-22T09:00:00Z") }).where(eq(catalogueProducts.id, productId));
    const stale = await ok(await planAs(USER_HBZ, tenantId, created.plan.publicId));
    expect(stale).toMatchObject({ stale: true, plan: { status: "stale" }, readiness: { reviewComplete: false } });
    expect(stale.readiness.blockers).toContain("stale");
    const [stored] = await sqlClient`SELECT status FROM qos.workbook_import_plans WHERE public_id = ${created.plan.publicId}`;
    expect(stored!.status).toBe("stale");

    const otherUser = "user.workbook-hct@test";
    await seedMember(tenantId, otherUser, "user", []);
    const forbidden = await reviewAs(otherUser, tenantId, created.plan.publicId, { expectedPlanHash: created.plan.planHash, decisions: [] });
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: "plan_not_yours" });

    const revised = await ok(await reviewAs(ADMIN, tenantId, created.plan.publicId, { expectedPlanHash: created.plan.planHash, decisions: [] }));
    expect(revised).toMatchObject({ stale: false, plan: { revision: 2, status: "review_ready" } });
    expect(revised.plan.planHash).not.toBe(created.plan.planHash);
    expect(revised.context.branchScope).toEqual(["loc_quotes_hbz"]);
  });

  it("downloads the correction report in English and Arabic with one row per error or warning", async () => {
    const { tenantId, flowers } = await seed();
    const plan = await ok(await previewAs(ADMIN, tenantId, await foodicsMenu()));
    const expected = plan.rows.flatMap((row) => row.diagnostics.filter((diagnostic) => diagnostic.severity !== "info")).length;
    for (const locale of ["en", "ar"]) {
      const response = await reportAs(ADMIN, tenantId, plan.plan.publicId, locale);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toBe(XLSX);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(response.headers.get("content-disposition")).toBe(`attachment; filename="qos-correction-report-${plan.plan.publicId}-r1.xlsx"`);
      const workbook = new ExcelJS.Workbook();
      const bytes = await bytesOf(response);
      await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
      expect(workbook.getWorksheet("Corrections")!.rowCount).toBe(expected + 1);
    }
    expect((await reportAs(FLOWERS_ADMIN, flowers.tenant.id, plan.plan.publicId)).status).toBe(404);
  });

  it("treats a product source link for the namespace as a verified identity", async () => {
    const { tenantId, productId } = await seed();
    await db.insert(catalogueImportSourceLinks).values({ tenantId, connectionKey: "foodics-menu-v1:ten_quotes_dev", sourceId: "prd~vanilla-latte~48102bbb", productId });
    const plan = await ok(await previewAs(ADMIN, tenantId, await foodicsMenu()));
    const vanilla = find(plan, "Products", (row) => row.key === "prd~vanilla-latte~48102bbb");
    expect(vanilla).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: "prd_flat_white", kind: "linked" })] });
    expect(vanilla.diagnostics).toContainEqual(expect.objectContaining({ code: "key_already_linked" }));
  });

  it("refuses a workbook naming another business and a current catalogue file, storing nothing", async () => {
    const { tenantId } = await seed();
    const workbook = await loadWorkbook(await exportBytes(ADMIN, tenantId));
    const start = workbook.getWorksheet("Start Here")!;
    start.eachRow((row) => {
      if (row.getCell(1).value === "source_namespace") row.getCell(2).value = "qos:ten_flowers_dev";
    });
    const rejected = await previewAs(ADMIN, tenantId, await saveWorkbook(workbook));
    expect(rejected.status).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "review_context_rejected", reason: "namespace", found: "qos:ten_flowers_dev" });
    const legacy = await previewAs(ADMIN, tenantId, Buffer.from("source_id,internal_name\nq1,flat"), { fileName: "current.csv" });
    expect(legacy.status).toBe(400);
    expect(await legacy.json()).toMatchObject({ code: "review_unsupported_profile" });
    const [{ count }] = await sqlClient`SELECT count(*)::int AS count FROM qos.workbook_import_plans`;
    expect(count).toBe(0);
  });

  it("asks for a brand when the business has several", async () => {
    const { tenantId, quotes } = await seed();
    await db.insert(brands).values({ tenantId, organizationId: quotes.organization.id, publicId: "brd_azur", name: "Azur" });
    const ambiguous = await previewAs(ADMIN, tenantId, await foodicsMenu());
    expect(ambiguous.status).toBe(400);
    expect(await ambiguous.json()).toMatchObject({ code: "brand_required" });
    const chosen = await ok(await previewAs(ADMIN, tenantId, await foodicsMenu(), { brand: "brd_azur" }));
    expect(chosen.context.brandPublicId).toBe("brd_azur");
    expect(find(chosen, "Products", (row) => row.key.startsWith("prd~flat-white")).classification).toBe("create");
  });

  const ORIGINAL_SHA256 = "2a73c4f19c98e35803b026038b08439a5f0f77070f88e59e4356623ded3e4cd3";
  const privateDir = "/workspace/qos-phase2/private";
  const originalFile =
    process.env.QOS_216_SOURCE_XLSX ??
    (existsSync(privateDir) ? readdirSync(privateDir).filter((name) => name.toLowerCase().endsWith(".xlsx")).map((name) => path.join(privateDir, name))[0] : undefined);

  it.skipIf(!originalFile)("reviews the original client template through the route as a no-op", async () => {
    const { tenantId } = await seed();
    const bytes = readFileSync(originalFile!);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ORIGINAL_SHA256);
    const result = await ok(await previewAs(ADMIN, tenantId, bytes, { fileName: path.basename(originalFile!) }));
    expect(result.counts).toMatchObject({ rows: 0, create: 0, update: 0 });
    expect(result.rows).toEqual([]);
    expect(result.context.ignoredSheets?.some((sheet) => sheet.reason === "credentials")).toBe(true);
  });
});
