import { eq, sql as dsql } from "drizzle-orm";
import type ExcelJS from "exceljs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { inventoryItems, inventoryUnits, staffIdentities, staffLocationScopes, staffMemberships, workbookSourceLinks } from "@/db/schema";
import { createIntegrationDb, grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { attachModifierGroupToProduct, createModifierGroup, createModifierOption, listProductModifierGroups } from "@/lib/catalogue/modifiers";
import { createDraftProduct } from "@/lib/catalogue/products";
import { getCategory } from "@/lib/inventory/categories";
import { getItem } from "@/lib/inventory/items";
import { getSupplier } from "@/lib/inventory/suppliers";
import { getUnit, listUnits } from "@/lib/inventory/units";
import { getWarehouse } from "@/lib/inventory/warehouses";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { getRecipe } from "@/lib/recipes/recipes";
import { approveVersion, createDraftFromVersion } from "@/lib/recipes/versions";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { applyWorkbookPlan } from "@/lib/workbook/apply";
import { faultAt } from "@/lib/workbook/apply/test-support";
import { loadWorkbook, saveWorkbook } from "@/lib/workbook/test-support";
import type { PlanDecision, ReviewRow, WorkbookReviewResult } from "@/lib/workbook/validation/model";

import { POST as applyPOST } from "./plans/[planPublicId]/apply/route";
import { POST as reviewPOST } from "./plans/[planPublicId]/review/route";
import { GET as planGET } from "./plans/[planPublicId]/route";
import { GET as exportGET } from "./export/route";
import { GET as templateGET } from "./template/route";
import { POST as previewPOST } from "./preview/route";

/* QOS-200 Phase 2 workbook apply against local Postgres: units, suppliers,
   warehouses, inventory categories, ingredients (conversion, dated cost),
   recipes as drafts with sellable links, recipe lines, prep steps and
   modifier effects, through the real preview, review and apply routes and
   the real inventory and recipe services. Every assertion reloads the
   domain records through their services or tables, never the plan alone. */

const staffMocks = vi.hoisted(() => ({ requireStaffIdentity: vi.fn() }));
vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return { ...actual, requireStaffIdentity: staffMocks.requireStaffIdentity };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN = "admin.phase2@test";
const USER = "user.phase2@test";
const FLOWERS_ADMIN = "admin.flowers.phase2@test";
const BRANCH_A = "loc_quotes_hbz";
const BRANCH_B = "loc_quotes_hct";

const TRUNCATE = `TRUNCATE TABLE qos.workbook_source_links, qos.workbook_import_plan_rows, qos.workbook_import_applies, qos.workbook_import_plans, qos.tenant_audit_events,
  qos.recipe_version_modifier_effects, qos.recipe_sellable_links, qos.recipe_version_snapshots, qos.recipe_version_steps, qos.recipe_version_lines, qos.recipe_versions, qos.recipes,
  qos.inventory_item_reference_costs, qos.inventory_item_conversions, qos.inventory_items, qos.inventory_categories, qos.inventory_units, qos.inventory_warehouses, qos.inventory_suppliers,
  qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options,
  qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants,
  qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;

/* Synthetic rows, written into a real export so references to the existing latte variant and oat option use QOS ids. */
const UNITS = [
  { unit_key: "u-kg", action: "create", standard_code: "kg", name: "Kilogram", quantity_kind: "MASS", decimal_places: "3", active: "TRUE" },
  { unit_key: "u-g", action: "create", name: "g", quantity_kind: "MASS", decimal_places: "1", active: "TRUE" },
  { unit_key: "u-ml", action: "create", name: "Millilitre", quantity_kind: "VOLUME", decimal_places: "0", active: "TRUE" },
  { unit_key: "u-box", action: "create", code: "box12", name: "Box of 12", name_ar: "صندوق ١٢", quantity_kind: "PACK", decimal_places: "0", active: "TRUE" },
];
const SUPPLIERS = [
  { supplier_key: "s-farm", action: "create", name: "Fresh Farms", contact_name: "Huda", email: "orders@fresh.example", phone: "+971 4 555 0101", reference: "FF-01", active: "TRUE", notes: "Delivers daily" },
];
const WAREHOUSES = [{ warehouse_key: "w-main", action: "create", branch_key: BRANCH_A, code: "MAIN", name: "Main store", active: "TRUE", notes: "Back room" }];
const CATEGORIES = [{ inventory_category_key: "c-dairy", action: "create", name_en: "Dairy", name_ar: "ألبان", active: "TRUE" }];
const INGREDIENTS = [
  {
    ingredient_key: "i-milk",
    action: "create",
    name_en: "Milk",
    name_ar: "حليب",
    inventory_category_key: "c-dairy",
    ingredient_type: "PURCHASED",
    storage_unit_key: "u-box",
    recipe_unit_key: "u-ml",
    recipe_units_per_storage_unit: "12000",
    default_supplier_key: "s-farm",
    reference_cost_per_storage_unit: "24.50",
    cost_currency: "AED",
    cost_tax_basis: "NET",
    cost_effective_date: "2026-11-01",
    cost_source_reference: "INV-1",
    active: "TRUE",
    notes: "Full fat",
  },
  { ingredient_key: "i-sugar", action: "create", name_en: "Sugar", ingredient_type: "PURCHASED", storage_unit_key: "u-kg", recipe_unit_key: "u-g", recipe_units_per_storage_unit: "1000", reference_cost_per_storage_unit: "3.25", cost_currency: "AED", active: "TRUE" },
  { ingredient_key: "i-syrup", action: "create", name_en: "Vanilla syrup", ingredient_type: "PREPARED", storage_unit_key: "u-ml", recipe_unit_key: "u-ml", recipe_units_per_storage_unit: "1", active: "TRUE" },
];
function recipeRows(variant: string) {
  return [
    {
      recipe_version_key: "r-latte-1",
      action: "create",
      recipe_key: "r-latte",
      version_number: "1",
      name: "Latte",
      target_type: "SOLD_VARIANT",
      variant_key: variant,
      yield_quantity: "1",
      yield_unit_key: "u-ml",
      effective_from: "2026-12-01",
      notes: "House latte",
    },
    { recipe_version_key: "r-syrup-1", action: "create", recipe_key: "r-syrup", version_number: "1", name: "Vanilla syrup", target_type: "PREPARED_ITEM", prepared_ingredient_key: "i-syrup", yield_quantity: "1000", yield_unit_key: "u-ml", effective_from: "2026-12-01" },
  ];
}
const LINES = [
  { recipe_line_key: "l-milk", action: "create", recipe_version_key: "r-latte-1", ingredient_key: "i-milk", quantity_recipe_units: "200", sort_order: "1", notes: "steamed" },
  { recipe_line_key: "l-syrup", action: "create", recipe_version_key: "r-latte-1", ingredient_key: "i-syrup", quantity_recipe_units: "15", sort_order: "2" },
  { recipe_line_key: "l-sugar", action: "create", recipe_version_key: "r-syrup-1", ingredient_key: "i-sugar", quantity_recipe_units: "500.5", sort_order: "1" },
];
const STEPS = [
  { prep_step_key: "p-steam", action: "create", recipe_version_key: "r-latte-1", step_number: "1", title: "Steam", instruction: "Steam the milk to 65 degrees", expected_minutes: "2", checkpoint_required: "TRUE" },
  { prep_step_key: "p-pour", action: "create", recipe_version_key: "r-latte-1", step_number: "2", title: "Pour", instruction: "Pour over the shot", checkpoint_required: "FALSE" },
];
function effectRows(option: string) {
  return [
    { effect_key: "e-sweet", action: "create", modifier_option_key: option, recipe_version_key: "r-latte-1", effect_type: "ADD", ingredient_key: "i-sugar", quantity_per_sold_unit: "5", notes: "Extra sweet" },
    { effect_key: "e-nosyrup", action: "create", modifier_option_key: option, recipe_version_key: "r-latte-1", effect_type: "REMOVE", target_recipe_line_key: "l-syrup" },
  ];
}
const PENDING = {
  "Prep Targets": [{ prep_target_key: "t-syrup", action: "create", warehouse_key: "w-main", prepared_ingredient_key: "i-syrup", recipe_version_key: "r-syrup-1", target_quantity: "2", low_threshold_quantity: "1", observation_valid_minutes: "60", active: "TRUE" }],
  "Opening Stock": [{ opening_row_key: "o-milk", action: "create", warehouse_key: "w-main", ingredient_key: "i-milk", quantity_storage_units: "4", unit_cost_per_storage_unit: "24.5", cost_currency: "AED", as_of_at: "2026-11-28T08:00:00+04:00", source_reference: "COUNT-1" }],
  "External Mappings": [{ mapping_key: "m-latte", action: "create", connection_key: "foodics-main", provider: "FOODICS", external_entity_type: "PRODUCT", external_id: "F-100", target_entity_type: "SELLABLE_VARIANT", target_key: "latte" }],
};

/** Writes rows below a table's existing rows, matching header names on row 6. */
function appendRows(workbook: ExcelJS.Workbook, sheetName: string, rows: ReadonlyArray<Record<string, string | undefined>>) {
  const sheet = workbook.getWorksheet(sheetName)!;
  const columns = new Map<string, number>();
  sheet.getRow(6).eachCell((cell, column) => columns.set(String(cell.value), column));
  let next = 7;
  while (String(sheet.getCell(next, 1).value ?? "").trim()) next += 1;
  for (const [index, values] of rows.entries()) {
    for (const [key, value] of Object.entries(values)) {
      const column = columns.get(key);
      if (!column) throw new Error(`Missing column ${key} on ${sheetName}`);
      sheet.getCell(next + index, column).value = value ?? null;
    }
  }
}

/** Changes cells of the row whose first column is `key`. */
function editRow(workbook: ExcelJS.Workbook, sheetName: string, key: string, values: Record<string, string>) {
  const sheet = workbook.getWorksheet(sheetName)!;
  const columns = new Map<string, number>();
  sheet.getRow(6).eachCell((cell, column) => columns.set(String(cell.value), column));
  for (let row = 7; row < 7 + 500; row += 1) {
    if (String(sheet.getCell(row, 1).value ?? "") !== key) continue;
    for (const [column, value] of Object.entries(values)) sheet.getCell(row, columns.get(column)!).value = value;
    return;
  }
  throw new Error(`No ${sheetName} row ${key}`);
}

integrationDescribe("Phase 2 workbook apply (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sql: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  // A second connection: the apply holds the first one inside a unit, so a concurrent editor change needs its own.
  let other: Awaited<ReturnType<typeof createIntegrationDb>>;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sql = connection.sql;
    await grantRoleMembership(sql, "qos", "qos_app");
    other = await createIntegrationDb();
  }, 120_000);

  afterAll(async () => {
    await other.sql.end({ timeout: 5 });
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await sql.unsafe(TRUNCATE);
    staffMocks.requireStaffIdentity.mockReset();
  });

  async function seedMember(tenantId: string, subject: string, role: "administrator" | "user", locationIds: string[] = []): Promise<ActiveStaffMembership> {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    const [membership] = await db.insert(staffMemberships).values({ tenantId, staffIdentityId: identity!.id, role }).returning();
    for (const locationId of locationIds) await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership!.id, locationId });
    return { membershipId: membership!.id, role, staffIdentityId: identity!.id };
  }

  async function seed() {
    const quotes = await createQuotesTwoLocationTenant(db);
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const tenantId = quotes.tenant.id;
    const admin = await seedMember(tenantId, ADMIN, "administrator");
    const user = await seedMember(tenantId, USER, "user", [quotes.locationA.id]);
    const flowersAdmin = await seedMember(flowers.tenant.id, FLOWERS_ADMIN, "administrator");
    const latte = await createDraftProduct(db, tenantId, admin, {
      internalName: "latte",
      brandPublicId: quotes.brand.publicId,
      translations: { en: { displayName: "Latte", description: null }, ar: { displayName: "لاتيه", description: null } },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    let group = await createModifierGroup(db, tenantId, { internalName: "milk", minSelections: 0, maxSelections: 1, translations: { en: { displayName: "Milk" }, ar: { displayName: "الحليب" } } }, ADMIN, admin);
    group = await createModifierOption(db, tenantId, group.publicId, { expectedGroupVersion: group.version, publicId: "modopt_oat", translations: { en: { displayName: "Oat milk" }, ar: { displayName: "حليب الشوفان" } } }, ADMIN, admin);
    const assigned = await listProductModifierGroups(db, tenantId, latte.publicId);
    await attachModifierGroupToProduct(db, tenantId, latte.publicId, { expectedProductVersion: assigned.productVersion, modifierGroupPublicId: group.publicId }, ADMIN, admin);
    return { quotes, flowers, tenantId, admin, user, flowersAdmin, variant: latte.defaultVariant.publicId, option: "modopt_oat" };
  }

  function as(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }
  const params = (tenantId: string) => ({ params: Promise.resolve({ tenantId }) });
  const planParams = (tenantId: string, planPublicId: string) => ({ params: Promise.resolve({ tenantId, planPublicId }) });
  let keyCounter = 0;
  const nextKey = () => `phase2-key-${(keyCounter += 1)}`;

  async function exportBytes(tenantId: string) {
    as(ADMIN);
    const response = await exportGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/export`), params(tenantId));
    expect(response.status).toBe(200);
    return Buffer.from(await response.arrayBuffer());
  }

  async function previewAs(subject: string, tenantId: string, bytes: Buffer) {
    as(subject);
    const form = new FormData();
    form.set("file", new File([new Uint8Array(bytes)], "phase2.xlsx"));
    return previewPOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/preview`, { method: "POST", body: form, headers: { "Idempotency-Key": nextKey() } }),
      params(tenantId),
    );
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

  async function applyAs(subject: string, tenantId: string, plan: WorkbookReviewResult, key = nextKey()) {
    as(subject);
    return applyPOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${plan.plan.publicId}/apply`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify({ expectedPlanHash: plan.plan.planHash }),
      }),
      planParams(tenantId, plan.plan.publicId),
    );
  }

  async function planOf(tenantId: string, planPublicId: string) {
    as(ADMIN);
    return ok(await planGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${planPublicId}`), planParams(tenantId, planPublicId)));
  }

  async function ok(response: Response) {
    const body = await response.json();
    expect(response.status, JSON.stringify(body).slice(0, 1200)).toBe(200);
    return body as WorkbookReviewResult;
  }

  /** Acknowledges what the review asks for and excludes rows that cannot apply; extra decisions first. */
  async function completeReview(tenantId: string, initial: WorkbookReviewResult, extra: PlanDecision[] = []) {
    let plan = initial;
    for (let step = 0; step < 4 && !plan.readiness.reviewComplete; step += 1) {
      const decisions: PlanDecision[] = [...extra];
      for (const row of plan.rows) {
        if (extra.some((decision) => "row" in decision && decision.sheet === row.sheet && decision.row === row.row)) continue;
        if (row.classification === "conflicting" || row.classification === "invalid") decisions.push({ kind: "exclude", sheet: row.sheet, row: row.row });
      }
      for (const ack of plan.acknowledgements.required) {
        decisions.push(ack.kind === "acknowledge_deferred" ? { kind: "acknowledge_deferred", sheet: ack.sheet!, column: ack.column! } : { kind: ack.kind });
      }
      plan = await ok(await reviewAs(ADMIN, tenantId, plan.plan.publicId, { expectedPlanHash: plan.plan.planHash, decisions }));
    }
    expect(plan.readiness.reviewComplete, JSON.stringify(plan.readiness)).toBe(true);
    return plan;
  }

  async function firstWorkbook(tenantId: string, fx: { variant: string; option: string }, edit?: (workbook: ExcelJS.Workbook) => void) {
    const workbook = await loadWorkbook(await exportBytes(tenantId));
    appendRows(workbook, "Units", UNITS);
    appendRows(workbook, "Suppliers", SUPPLIERS);
    appendRows(workbook, "Warehouses", WAREHOUSES);
    appendRows(workbook, "Inventory Categories", CATEGORIES);
    appendRows(workbook, "Ingredients", INGREDIENTS);
    appendRows(workbook, "Recipes", recipeRows(fx.variant));
    appendRows(workbook, "Recipe Lines", LINES);
    appendRows(workbook, "Prep Steps", STEPS);
    appendRows(workbook, "Modifier Effects", effectRows(fx.option));
    for (const [sheet, rows] of Object.entries(PENDING)) appendRows(workbook, sheet, rows);
    edit?.(workbook);
    return saveWorkbook(workbook);
  }

  const row = (result: WorkbookReviewResult, sheet: string, key: string): ReviewRow => {
    const found = result.rows.find((entry) => entry.sheet === sheet && entry.key === key);
    if (!found) throw new Error(`No ${sheet} ${key}`);
    return found;
  };
  const savedId = (result: WorkbookReviewResult, sheet: string, key: string) => row(result, sheet, key).apply!.appliedPublicId!;

  async function counts() {
    const [counted] = await sql`
      SELECT
        (SELECT count(*)::int FROM qos.inventory_units) AS units,
        (SELECT count(*)::int FROM qos.inventory_suppliers) AS suppliers,
        (SELECT count(*)::int FROM qos.inventory_warehouses) AS warehouses,
        (SELECT count(*)::int FROM qos.inventory_categories) AS categories,
        (SELECT count(*)::int FROM qos.inventory_items) AS items,
        (SELECT count(*)::int FROM qos.inventory_item_conversions) AS conversions,
        (SELECT count(*)::int FROM qos.inventory_item_reference_costs) AS costs,
        (SELECT count(*)::int FROM qos.recipes) AS recipes,
        (SELECT count(*)::int FROM qos.recipe_versions) AS versions,
        (SELECT count(*)::int FROM qos.recipe_version_lines) AS lines,
        (SELECT count(*)::int FROM qos.recipe_version_steps) AS steps,
        (SELECT count(*)::int FROM qos.recipe_version_modifier_effects) AS effects,
        (SELECT count(*)::int FROM qos.recipe_sellable_links) AS links,
        (SELECT count(*)::int FROM qos.recipe_version_snapshots) AS snapshots,
        (SELECT count(*)::int FROM qos.workbook_source_links) AS source_links,
        (SELECT count(*)::int FROM qos.catalogue_menu_publish_operations) AS publishes,
        (SELECT count(*)::int FROM qos.catalogue_menu_live_revisions) AS live
    `;
    return counted!;
  }

  async function applyFirst() {
    const fx = await seed();
    const previewed = await ok(await previewAs(ADMIN, fx.tenantId, await firstWorkbook(fx.tenantId, fx)));
    const reviewed = await completeReview(fx.tenantId, previewed);
    const applied = await ok(await applyAs(ADMIN, fx.tenantId, reviewed));
    return { fx, previewed, reviewed, applied };
  }

  it("creates every Phase 2 record through the services and reloads each applied field; recipes land as drafts", async () => {
    const { fx, previewed, applied } = await applyFirst();
    for (const sheet of ["Units", "Suppliers", "Warehouses", "Inventory Categories", "Ingredients", "Recipes", "Recipe Lines", "Prep Steps", "Modifier Effects"]) {
      expect(previewed.rows.filter((entry) => entry.sheet === sheet).map((entry) => entry.classification), sheet).toEqual(
        previewed.rows.filter((entry) => entry.sheet === sheet).map(() => "create"),
      );
    }
    expect(applied.plan.status, JSON.stringify(applied.rows.filter((entry) => entry.apply?.state === "failed").map((entry) => [entry.sheet, entry.key, entry.apply?.error]))).toBe("applied");
    const { tenantId, admin } = fx;

    // Units: standard by code, standard by name, custom with code and Arabic name.
    const kg = (await getUnit(db, tenantId, savedId(applied, "Units", "u-kg"))).unit;
    expect(kg).toMatchObject({ code: "kg", standardCode: "kg", quantityKind: "mass", decimalPlaces: 3, nameEn: "Kilogram", status: "active" });
    const g = (await getUnit(db, tenantId, savedId(applied, "Units", "u-g"))).unit;
    expect(g).toMatchObject({ standardCode: "g", decimalPlaces: 1, nameEn: "Gram" });
    const ml = (await getUnit(db, tenantId, savedId(applied, "Units", "u-ml"))).unit;
    expect(ml).toMatchObject({ standardCode: "ml", nameEn: "Millilitre", decimalPlaces: 0 });
    const box = (await getUnit(db, tenantId, savedId(applied, "Units", "u-box"))).unit;
    expect(box).toMatchObject({ code: "box12", nameEn: "Box of 12", nameAr: "صندوق ١٢", quantityKind: "pack", standardCode: null, decimalPlaces: 0 });

    const supplier = (await getSupplier(db, tenantId, savedId(applied, "Suppliers", "s-farm"))).supplier;
    expect(supplier).toMatchObject({ nameEn: "Fresh Farms", contactName: "Huda", email: "orders@fresh.example", phone: "+971 4 555 0101", code: "FF-01", notes: "Delivers daily", status: "active" });
    const warehouse = (await getWarehouse(db, tenantId, admin, savedId(applied, "Warehouses", "w-main"))).warehouse;
    expect(warehouse).toMatchObject({ code: "MAIN", nameEn: "Main store", notes: "Back room", status: "active" });
    expect(JSON.stringify(warehouse)).toContain(BRANCH_A);
    const category = (await getCategory(db, tenantId, savedId(applied, "Inventory Categories", "c-dairy"))).category;
    expect(category).toMatchObject({ nameEn: "Dairy", nameAr: "ألبان", status: "active" });

    // Ingredients: item, storage → recipe rule (custom pair) and dated cost in exact micros.
    const milk = await getItem(db, tenantId, savedId(applied, "Ingredients", "i-milk"));
    expect(milk.item).toMatchObject({
      nameEn: "Milk",
      nameAr: "حليب",
      kind: "purchased",
      storageUnitPublicId: box.publicId,
      recipeUnitPublicId: ml.publicId,
      defaultSupplierPublicId: supplier.publicId,
      categoryPublicId: category.publicId,
      notes: "Full fat",
      status: "active",
    });
    expect(milk.rules).toEqual([expect.objectContaining({ fromUnitPublicId: box.publicId, toUnitPublicId: ml.publicId, factor: "12000", factorMicros: "12000000000", revision: 1 })]);
    expect(milk.costHistory).toEqual([
      expect.objectContaining({ amount: "24.5", amountMicros: "24500000", currency: "AED", taxBasis: "net", source: "manual", sourceReference: "INV-1", effectiveFrom: "2026-11-01", unitPublicId: box.publicId, revision: 1, current: true }),
    ]);
    const sugar = await getItem(db, tenantId, savedId(applied, "Ingredients", "i-sugar"));
    // Two standard units: the standard conversion applies and no rule is stored. A blank basis is unconfirmed.
    expect(sugar.rules).toEqual([]);
    expect(sugar.costHistory).toEqual([expect.objectContaining({ amount: "3.25", taxBasis: "unconfirmed", unitPublicId: kg.publicId })]);
    const syrup = await getItem(db, tenantId, savedId(applied, "Ingredients", "i-syrup"));
    // No cost given: unknown, never zero.
    expect(syrup.costHistory).toEqual([]);
    expect(syrup.referenceCost).toMatchObject({ status: "unknown" });
    expect(syrup.item.kind).toBe("prepared");

    // Recipes: draft version 1 with yield, notes, lines, steps, effects and the sold variant's recipe link.
    const latteRow = row(applied, "Recipes", "r-latte-1");
    const latte = await getRecipe(db, tenantId, latteRow.apply!.result!.parentPublicId!);
    expect(latte.recipe).toMatchObject({ nameEn: "Latte", kind: "sellable", status: "active" });
    expect(latte.versions).toHaveLength(1);
    const draft = latte.versions[0]!;
    expect(draft).toMatchObject({ publicId: latteRow.apply!.appliedPublicId, versionNumber: 1, status: "draft", effectiveFrom: null, approvedAt: null, notes: "House latte", yieldQuantity: "1" });
    expect(draft.yieldUnit?.publicId).toBe(ml.publicId);
    expect(draft.lines.map((line) => [line.item.publicId, line.quantity, line.unit.publicId])).toEqual([
      [milk.item.publicId, "200", ml.publicId],
      [syrup.item.publicId, "15", ml.publicId],
    ]);
    expect(draft.lines[0]!.publicId).toBe(savedId(applied, "Recipe Lines", "l-milk"));
    expect(draft.steps.map((step) => step.textEn)).toEqual(["Steam the milk to 65 degrees", "Pour over the shot"]);
    expect(draft.effects).toHaveLength(2);
    expect(JSON.stringify(draft.effects)).toContain("Extra sweet");
    const effectTypes = draft.effects.map((effect) => effect.effectType).sort();
    expect(effectTypes).toEqual(["add", "remove"]);
    expect(latte.linkedVariants.map((link) => link.variantPublicId)).toEqual([fx.variant]);
    const syrupRecipe = await getRecipe(db, tenantId, row(applied, "Recipes", "r-syrup-1").apply!.result!.parentPublicId!);
    expect(syrupRecipe.recipe).toMatchObject({ kind: "prepared", outputItem: expect.objectContaining({ publicId: syrup.item.publicId }) });
    expect(syrupRecipe.versions[0]!.lines[0]!.quantity).toBe("500.5");

    // History: sub-records and parents per row; deferred values reported with their owner, never saved.
    expect(row(applied, "Recipes", "r-latte-1").apply!.result!.records).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "recipe", created: true }), expect.objectContaining({ kind: "recipe_version", revision: 1 }), expect.objectContaining({ kind: "sellable_link", created: true })]),
    );
    expect(row(applied, "Ingredients", "i-milk").apply!.result!.records).toEqual([
      expect.objectContaining({ kind: "conversion", revision: 1, created: true }),
      expect.objectContaining({ kind: "reference_cost", revision: 1, effectiveFrom: "2026-11-01" }),
    ]);
    expect(row(applied, "Ingredients", "i-sugar").apply!.result!.records).toEqual([
      expect.objectContaining({ kind: "conversion", note: "standard", created: false }),
      expect.objectContaining({ kind: "reference_cost", created: true }),
    ]);
    expect(row(applied, "Recipes", "r-latte-1").apply!.result!.deferred.map((field) => field.column).sort()).toEqual(["effective_from", "version_number"]);
    expect(row(applied, "Prep Steps", "p-steam").apply!.result!.deferred.map((field) => field.column).sort()).toEqual(["checkpoint_required", "expected_minutes", "title"]);
    expect(row(applied, "Recipe Lines", "l-milk").apply!.result!.deferred).toEqual([
      { column: "notes", owner: "Recipe editor: line notes have no field yet; line labels are edited in the recipe editor" },
    ]);
    expect(row(applied, "Recipe Lines", "l-milk").apply!.result!.fieldsApplied).not.toContain("notes");
    const [steps] = await sql`SELECT count(*)::int AS n FROM qos.recipe_version_steps WHERE text_en LIKE '%Steam%' OR text_en = 'Steam'`;
    expect(steps!.n).toBe(1);

    // Pending sheets are read, kept and never applied; nothing was approved, published or posted.
    for (const [sheet, key] of [["Prep Targets", "t-syrup"], ["Opening Stock", "o-milk"], ["External Mappings", "m-latte"]] as const) {
      expect(row(applied, sheet, key)).toMatchObject({ classification: "unsupported", apply: { state: "not_applied" } });
    }
    const total = await counts();
    expect(total).toMatchObject({ snapshots: 0, publishes: 0, live: 0, links: 1, versions: 2 });
    const [approved] = await sql`SELECT count(*)::int AS n FROM qos.recipe_versions WHERE status <> 'draft'`;
    expect(approved!.n).toBe(0);
    const audits = await sql`SELECT action FROM qos.tenant_audit_events WHERE tenant_id = ${tenantId} ORDER BY occurred_at, id`;
    const actions = audits.map((entry) => entry.action as string);
    expect(actions).toEqual(expect.arrayContaining(["inventory.unit.create", "inventory.item.create", "inventory.conversion.create", "inventory.reference_cost.create", "recipe.create", "recipe.link.create", "recipe.version.lines.update", "recipe.version.effects.update"]));
    expect(actions.some((action) => action.startsWith("recipe.version.approve") || action.includes("publish"))).toBe(false);
    // Masters before relationships: every unit is created before the first item, every item before the first recipe.
    expect(actions.lastIndexOf("inventory.unit.create")).toBeLessThan(actions.indexOf("inventory.item.create"));
    expect(actions.lastIndexOf("inventory.item.create")).toBeLessThan(actions.indexOf("recipe.create"));
    const rowAudits = await sql`SELECT entity_type FROM qos.tenant_audit_events WHERE tenant_id = ${tenantId} AND action = 'catalogue.workbook.apply.row'`;
    expect(new Set(rowAudits.map((entry) => entry.entity_type))).toEqual(
      new Set(["inventory_unit", "inventory_supplier", "inventory_warehouse", "inventory_category", "inventory_item", "recipe_version"]),
    );

    // Typed links for every new record; a fresh upload of the same file creates nothing.
    const links = await db.select().from(workbookSourceLinks);
    expect(new Set(links.map((link) => link.entityType))).toEqual(
      new Set(["unit", "supplier", "warehouse", "inventory_category", "inventory_item", "recipe", "recipe_version", "recipe_line", "prep_step", "modifier_effect"]),
    );
    const before = await counts();
    const again = await ok(await previewAs(ADMIN, tenantId, await firstWorkbook(tenantId, fx)));
    const phase2 = again.rows.filter((entry) => !["Prep Targets", "Opening Stock", "External Mappings"].includes(entry.sheet) && entry.key.match(/^[a-z]-/));
    expect(phase2.length).toBeGreaterThan(15);
    expect(phase2.filter((entry) => entry.classification !== "unchanged").map((entry) => [entry.sheet, entry.key, entry.classification, entry.changes, entry.diagnostics.filter((d) => d.severity !== "info")])).toEqual([]);
    const reapplied = await ok(await applyAs(ADMIN, tenantId, await completeReview(tenantId, again)));
    expect(reapplied.plan.status).toBe("applied");
    expect(await counts()).toEqual(before);
  });

  it("updates every applied field from an export, as new dated revisions, and closes a cost with clear_fields", async () => {
    const { fx, applied } = await applyFirst();
    const { tenantId } = fx;
    const untouched = await ok(await previewAs(ADMIN, tenantId, await exportBytes(tenantId)));
    expect(untouched.counts).toMatchObject({ create: 0, update: 0, invalid: 0, conflicting: 0 });

    const ids = (sheet: string, key: string) => savedId(applied, sheet, key);
    const workbook = await loadWorkbook(await exportBytes(tenantId));
    editRow(workbook, "Units", ids("Units", "u-box"), { action: "update", name: "Box of twelve", name_ar: "علبة ١٢", decimal_places: "1" });
    editRow(workbook, "Suppliers", ids("Suppliers", "s-farm"), { action: "update", name: "Fresh Farms LLC", contact_name: "Sara", email: "buy@fresh.example", phone: "+971 4 555 0102", reference: "FF-02", notes: "", clear_fields: "notes" });
    editRow(workbook, "Warehouses", ids("Warehouses", "w-main"), { action: "update", name: "Main stock room", notes: "Ground floor" });
    editRow(workbook, "Inventory Categories", ids("Inventory Categories", "c-dairy"), { action: "update", name_en: "Dairy and alternatives", name_ar: "ألبان وبدائل" });
    editRow(workbook, "Ingredients", ids("Ingredients", "i-milk"), {
      action: "update",
      name_en: "Whole milk",
      name_ar: "حليب كامل",
      recipe_units_per_storage_unit: "11500",
      reference_cost_per_storage_unit: "26",
      cost_tax_basis: "GROSS",
      cost_effective_date: "2026-11-15",
      cost_source_reference: "INV-2",
      notes: "Organic",
    });
    editRow(workbook, "Ingredients", ids("Ingredients", "i-sugar"), { action: "update", reference_cost_per_storage_unit: "", clear_fields: "reference_cost_per_storage_unit" });
    editRow(workbook, "Recipes", ids("Recipes", "r-latte-1"), { action: "update", name: "Caffe latte", yield_quantity: "2", notes: "Two cups" });
    editRow(workbook, "Recipe Lines", ids("Recipe Lines", "l-milk"), { action: "update", quantity_recipe_units: "180" });
    editRow(workbook, "Prep Steps", ids("Prep Steps", "p-pour"), { action: "update", instruction: "Pour slowly over the shot" });
    editRow(workbook, "Modifier Effects", ids("Modifier Effects", "e-sweet"), { action: "update", quantity_per_sold_unit: "7", notes: "Very sweet" });
    const previewed = await ok(await previewAs(ADMIN, tenantId, await saveWorkbook(workbook)));
    expect(previewed.counts.update, JSON.stringify(previewed.rows.filter((entry) => entry.classification !== "skipped" && entry.classification !== "update").map((entry) => [entry.sheet, entry.key, entry.classification, entry.diagnostics]))).toBe(10);
    const updated = await ok(await applyAs(ADMIN, tenantId, await completeReview(tenantId, previewed)));
    expect(updated.plan.status, JSON.stringify(updated.rows.filter((entry) => entry.apply?.state === "failed").map((entry) => [entry.sheet, entry.apply?.error]))).toBe("applied");

    expect((await getUnit(db, tenantId, ids("Units", "u-box"))).unit).toMatchObject({ nameEn: "Box of twelve", nameAr: "علبة ١٢", decimalPlaces: 1, code: "box12", version: 2 });
    expect((await getSupplier(db, tenantId, ids("Suppliers", "s-farm"))).supplier).toMatchObject({ nameEn: "Fresh Farms LLC", contactName: "Sara", email: "buy@fresh.example", phone: "+971 4 555 0102", code: "FF-02", notes: null });
    expect((await getWarehouse(db, tenantId, fx.admin, ids("Warehouses", "w-main"))).warehouse).toMatchObject({ nameEn: "Main stock room", notes: "Ground floor", code: "MAIN" });
    expect((await getCategory(db, tenantId, ids("Inventory Categories", "c-dairy"))).category).toMatchObject({ nameEn: "Dairy and alternatives", nameAr: "ألبان وبدائل" });
    const milk = await getItem(db, tenantId, ids("Ingredients", "i-milk"));
    expect(milk.item).toMatchObject({ nameEn: "Whole milk", nameAr: "حليب كامل", notes: "Organic" });
    // A changed factor and cost are new revisions; the earlier ones stay as history, never overwritten.
    expect(milk.rules).toEqual([expect.objectContaining({ factor: "11500", revision: 2 })]);
    expect(milk.history.map((rule) => [rule.factor, rule.revision, rule.current])).toEqual(expect.arrayContaining([["12000", 1, false], ["11500", 2, true]]));
    expect(milk.costHistory.map((cost) => [cost.amount, cost.taxBasis, cost.effectiveFrom, cost.sourceReference, cost.revision, cost.current])).toEqual([
      ["26", "gross", "2026-11-15", "INV-2", 2, true],
      ["24.5", "net", "2026-11-01", "INV-1", 1, false],
    ]);
    const sugar = await getItem(db, tenantId, ids("Ingredients", "i-sugar"));
    expect(sugar.costHistory).toEqual([expect.objectContaining({ amount: "3.25", current: false })]);
    expect(sugar.referenceCost).toMatchObject({ status: "unknown" });
    const latte = await getRecipe(db, tenantId, row(applied, "Recipes", "r-latte-1").apply!.result!.parentPublicId!);
    expect(latte.recipe.nameEn).toBe("Caffe latte");
    expect(latte.versions).toHaveLength(1);
    expect(latte.versions[0]).toMatchObject({ status: "draft", yieldQuantity: "2", notes: "Two cups" });
    expect(latte.versions[0]!.lines.find((line) => line.publicId === ids("Recipe Lines", "l-milk"))!.quantity).toBe("180");
    expect(latte.versions[0]!.steps.map((step) => step.textEn)).toEqual(["Steam the milk to 65 degrees", "Pour slowly over the shot"]);
    const sweet = latte.versions[0]!.effects.find((effect) => effect.publicId === ids("Modifier Effects", "e-sweet"))!;
    expect(sweet).toMatchObject({ notes: "Very sweet" });
    expect(JSON.stringify(sweet)).toContain("7");
  });

  it("never changes an approved version: an edit saves a new draft, a retry is unchanged, an open draft is a reviewable conflict", async () => {
    const { fx, applied } = await applyFirst();
    const { tenantId, admin } = fx;
    const familyId = row(applied, "Recipes", "r-latte-1").apply!.result!.parentPublicId!;
    const v1 = row(applied, "Recipes", "r-latte-1").apply!.appliedPublicId!;
    const detail = await getRecipe(db, tenantId, familyId);
    await approveVersion(db, tenantId, admin, ADMIN, familyId, v1, { expectedVersion: detail.versions[0]!.version, effectiveFrom: "2026-11-20" });
    const [snapshotBefore] = await sql`SELECT row_to_json(v)::text AS v FROM qos.recipe_versions v WHERE public_id = ${v1}`;
    const linesBefore = await sql`SELECT l.public_id, l.quantity_micros::text, l.status FROM qos.recipe_version_lines l JOIN qos.recipe_versions v ON v.id = l.recipe_version_id WHERE v.public_id = ${v1} ORDER BY l.position`;

    const edit = async () => {
      const workbook = await loadWorkbook(await exportBytes(tenantId));
      editRow(workbook, "Recipes", v1, { action: "update", yield_quantity: "3" });
      editRow(workbook, "Recipe Lines", savedId(applied, "Recipe Lines", "l-milk"), { action: "update", quantity_recipe_units: "250" });
      return saveWorkbook(workbook);
    };
    const bytes = await edit();
    const previewed = await ok(await previewAs(ADMIN, tenantId, bytes));
    expect(row(previewed, "Recipes", v1)).toMatchObject({ classification: "update", operation: "update" });
    const saved = await ok(await applyAs(ADMIN, tenantId, await completeReview(tenantId, previewed)));
    expect(saved.plan.status, JSON.stringify(saved.rows.filter((entry) => entry.apply?.state === "failed").map((entry) => [entry.sheet, entry.apply?.error]))).toBe("applied");
    const draftId = row(saved, "Recipes", v1).apply!.appliedPublicId!;
    expect(draftId).not.toBe(v1);

    const [snapshotAfter] = await sql`SELECT row_to_json(v)::text AS v FROM qos.recipe_versions v WHERE public_id = ${v1}`;
    expect(snapshotAfter!.v).toBe(snapshotBefore!.v);
    const linesAfter = await sql`SELECT l.public_id, l.quantity_micros::text, l.status FROM qos.recipe_version_lines l JOIN qos.recipe_versions v ON v.id = l.recipe_version_id WHERE v.public_id = ${v1} ORDER BY l.position`;
    expect(linesAfter).toEqual(linesBefore);
    const after = await getRecipe(db, tenantId, familyId);
    const draft = after.versions.find((version) => version.publicId === draftId)!;
    expect(draft).toMatchObject({ status: "draft", versionNumber: 2, yieldQuantity: "3" });
    expect(draft.lines.find((line) => line.item.publicId === savedId(applied, "Ingredients", "i-milk"))!.quantity).toBe("250");
    expect(after.versions.find((version) => version.publicId === v1)).toMatchObject({ status: "approved", yieldQuantity: "1" });
    expect(row(saved, "Recipes", v1).apply!.result!.records).toEqual([expect.objectContaining({ kind: "recipe_version", revision: 2, created: true })]);
    const [link] = await db.select().from(workbookSourceLinks).where(eq(workbookSourceLinks.sourceKey, v1));
    expect(link).toMatchObject({ entityType: "recipe_version", targetPublicId: draftId });

    // The same file again, as a new upload: the open draft is offered as the choice, and its line waits for it.
    const before = await counts();
    const retry = await ok(await previewAs(ADMIN, tenantId, bytes));
    const retryRecipe = row(retry, "Recipes", v1);
    expect(retryRecipe.classification).toBe("conflicting");
    expect(retryRecipe.candidates?.map((candidate) => candidate.publicId)).toEqual([draftId]);
    expect(retryRecipe.diagnostics).toContainEqual(expect.objectContaining({ code: "existing_record_conflict", params: expect.objectContaining({ reason: "draft_exists" }) }));
    const retryLine = row(retry, "Recipe Lines", savedId(applied, "Recipe Lines", "l-milk"));
    expect(retryLine.classification).toBe("blocked");
    expect(retryLine.diagnostics).toContainEqual(expect.objectContaining({ code: "blocked_by_dependency", params: expect.objectContaining({ refSheet: "Recipes", reason: "conflicting" }) }));
    // Choosing the draft: compared against the draft it already saved, so nothing changes.
    const chosen = await completeReview(tenantId, retry, [{ kind: "match_existing", sheet: "Recipes", row: retryRecipe.row, targetPublicId: draftId }]);
    expect(row(chosen, "Recipes", v1)).toMatchObject({ classification: "unchanged", identity: expect.objectContaining({ targetPublicId: draftId }) });
    expect(row(chosen, "Recipe Lines", savedId(applied, "Recipe Lines", "l-milk")).classification).toBe("unchanged");
    await ok(await applyAs(ADMIN, tenantId, chosen));
    expect(await counts()).toEqual(before);

    // Someone approves that draft and opens another one in the editor: an import for the approved version must not patch it silently.
    const current = await getRecipe(db, tenantId, familyId);
    await approveVersion(db, tenantId, admin, ADMIN, familyId, draftId, { expectedVersion: current.versions.find((version) => version.publicId === draftId)!.version, effectiveFrom: "2026-11-25" });
    const opened = await createDraftFromVersion(db, tenantId, admin, ADMIN, familyId, { fromVersionPublicId: draftId });
    const openDraft = opened.versions.find((version) => version.status === "draft")!.publicId;
    const conflictBytes = await (async () => {
      const workbook = await loadWorkbook(await exportBytes(tenantId));
      editRow(workbook, "Recipes", draftId, { action: "update", yield_quantity: "4" });
      return saveWorkbook(workbook);
    })();
    const conflicting = await ok(await previewAs(ADMIN, tenantId, conflictBytes));
    const conflictRow = row(conflicting, "Recipes", draftId);
    expect(conflictRow.classification).toBe("conflicting");
    expect(conflictRow.diagnostics).toContainEqual(expect.objectContaining({ code: "existing_record_conflict", params: expect.objectContaining({ reason: "draft_exists" }) }));
    expect(conflictRow.candidates?.map((candidate) => candidate.publicId)).toEqual([openDraft]);
    // Choosing the open draft makes it the target: apply patches that draft and nothing else.
    const decided = await completeReview(tenantId, conflicting, [{ kind: "match_existing", sheet: "Recipes", row: conflictRow.row, targetPublicId: openDraft }]);
    expect(row(decided, "Recipes", draftId)).toMatchObject({ classification: "update", identity: expect.objectContaining({ targetPublicId: openDraft }) });
    const patched = await ok(await applyAs(ADMIN, tenantId, decided));
    expect(patched.plan.status).toBe("applied");
    const final = await getRecipe(db, tenantId, familyId);
    expect(final.versions.find((version) => version.publicId === openDraft)).toMatchObject({ status: "draft", yieldQuantity: "4" });
    expect(final.versions.find((version) => version.publicId === draftId)).toMatchObject({ status: "approved", yieldQuantity: "3" });
    expect(final.versions.filter((version) => version.status === "draft")).toHaveLength(1);

    // A line row for an approved version whose recipe row is skipped cannot be saved anywhere: refused at review.
    const syrupFamily = row(applied, "Recipes", "r-syrup-1").apply!.result!.parentPublicId!;
    const syrupVersion = row(applied, "Recipes", "r-syrup-1").apply!.appliedPublicId!;
    const syrupDetail = await getRecipe(db, tenantId, syrupFamily);
    await approveVersion(db, tenantId, admin, ADMIN, syrupFamily, syrupVersion, { expectedVersion: syrupDetail.versions[0]!.version, effectiveFrom: "2026-11-20" });
    const lineOnly = await loadWorkbook(await exportBytes(tenantId));
    const approvedLine = savedId(applied, "Recipe Lines", "l-sugar");
    editRow(lineOnly, "Recipe Lines", approvedLine, { action: "update", quantity_recipe_units: "260" });
    const refused = await ok(await previewAs(ADMIN, tenantId, await saveWorkbook(lineOnly)));
    expect(row(refused, "Recipe Lines", approvedLine).classification).toBe("invalid");
    expect(row(refused, "Recipe Lines", approvedLine).diagnostics).toContainEqual(expect.objectContaining({ code: "service_validation", params: expect.objectContaining({ reason: "recipe_draft_required" }) }));
  });

  it("rolls back an interrupted unit, reports partial success, and a retry recovers without duplicate records or links", async () => {
    const fx = await seed();
    const { tenantId, admin } = fx;
    const previewed = await ok(await previewAs(ADMIN, tenantId, await firstWorkbook(tenantId, fx)));
    const reviewed = await completeReview(tenantId, previewed);
    const milkRow = row(reviewed, "Ingredients", "i-milk").row;
    const failed = await applyWorkbookPlan(db, tenantId, admin, ADMIN, reviewed.plan.publicId, { expectedPlanHash: reviewed.plan.planHash, idempotencyKey: "fault-phase2" }, { hooks: { beforeCheckpoint: faultAt("Ingredients", milkRow) } });
    expect(failed.plan.status).toBe("apply_failed");
    expect(row(failed, "Ingredients", "i-milk").apply).toMatchObject({ state: "failed", error: { code: "unexpected" } });
    // The whole milk unit rolled back: no item, rule, cost, link or row audit for it.
    expect(await db.select().from(inventoryItems).where(eq(inventoryItems.nameEn, "Milk"))).toEqual([]);
    expect(await db.select().from(workbookSourceLinks).where(eq(workbookSourceLinks.sourceKey, "i-milk"))).toEqual([]);
    // Earlier masters are kept; what depends on milk is not applied, and says which row is responsible.
    expect(row(failed, "Units", "u-box").apply!.state).toBe("applied");
    expect(row(failed, "Ingredients", "i-sugar").apply!.state).toBe("applied");
    const milkLine = row(failed, "Recipe Lines", "l-milk").apply!;
    expect(milkLine.state).toBe("failed");
    expect(milkLine.error).toMatchObject({ code: "dependency_unresolved" });
    const attempt = failed.apply!.attempts[0]!;
    expect(attempt.status).toBe("failed");
    expect(attempt.counts.failed).toBeGreaterThan(0);
    expect(attempt.counts.applied).toBeGreaterThan(0);
    expect(attempt.summary.failures).toContainEqual(expect.objectContaining({ sheet: "Ingredients", key: "i-milk", code: "unexpected" }));

    // Retry: revalidate, then apply. Saved rows are unchanged, the rest is applied once.
    const current = await planOf(tenantId, reviewed.plan.publicId);
    const rereviewed = await completeReview(tenantId, await ok(await reviewAs(ADMIN, tenantId, current.plan.publicId, { expectedPlanHash: current.plan.planHash, decisions: [...current.acknowledgements.given, ...current.rows.flatMap((entry) => (entry.decision ? [entry.decision] : []))] })));
    expect(row(rereviewed, "Units", "u-box").classification).toBe("unchanged");
    expect(row(rereviewed, "Ingredients", "i-milk").classification).toBe("create");
    const finished = await ok(await applyAs(ADMIN, tenantId, rereviewed));
    expect(finished.plan.status, JSON.stringify(finished.rows.filter((entry) => entry.apply?.state === "failed").map((entry) => [entry.sheet, entry.key, entry.apply?.error]))).toBe("applied");
    expect(await counts()).toMatchObject({ units: 4, suppliers: 1, warehouses: 1, categories: 1, items: 3, conversions: 1, costs: 2, recipes: 2, versions: 2, lines: 3, steps: 2, effects: 2, links: 1 });
    const keys = (await db.select().from(workbookSourceLinks)).map((link) => `${link.entityType}:${link.sourceKey}`);
    expect(keys).toEqual([...new Set(keys)]);
    // Reordered rows and a renamed Arabic label in a re-upload still update, never create.
    const reordered = await firstWorkbook(tenantId, fx, (workbook) => {
      const sheet = workbook.getWorksheet("Ingredients")!;
      const first = sheet.getRow(7).values;
      const second = sheet.getRow(8).values;
      sheet.getRow(7).values = second as ExcelJS.CellValue[];
      sheet.getRow(8).values = first as ExcelJS.CellValue[];
      editRow(workbook, "Inventory Categories", "c-dairy", { name_ar: "منتجات الألبان" });
    });
    const again = await ok(await previewAs(ADMIN, tenantId, reordered));
    expect(again.rows.filter((entry) => entry.key.match(/^[a-z]-/) && entry.classification === "create")).toEqual([]);
    expect(row(again, "Inventory Categories", "c-dairy")).toMatchObject({ classification: "update", changes: [expect.objectContaining({ column: "name_ar", after: "منتجات الألبان" })] });
  });

  it("rechecks permission and revisions immediately before each mutation", async () => {
    const fx = await seed();
    const { tenantId, admin } = fx;
    const reviewed = await completeReview(tenantId, await ok(await previewAs(ADMIN, tenantId, await firstWorkbook(tenantId, fx))));

    // A user may review but never apply.
    const forbidden = await applyAs(USER, tenantId, reviewed);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: "apply_requires_administrator" });
    // Another tenant does not see the plan at all.
    expect((await applyAs(FLOWERS_ADMIN, tenantId, reviewed)).status).toBe(404);
    expect((await applyAs(ADMIN, fx.flowers.tenant.id, reviewed)).status).toBe(404);

    // Demoted after the first unit: everything after it is refused, the first unit stays.
    const demoted = await applyWorkbookPlan(db, tenantId, admin, ADMIN, reviewed.plan.publicId, { expectedPlanHash: reviewed.plan.planHash, idempotencyKey: "demote-1" }, {
      hooks: {
        beforeCheckpoint: async (unit) => {
          if (unit.sheet === "Units") await other.db.update(staffMemberships).set({ role: "user" }).where(eq(staffMemberships.id, admin.membershipId));
        },
      },
    });
    expect(demoted.plan.status).toBe("apply_failed");
    const states = demoted.rows.filter((entry) => entry.sheet === "Units").map((entry) => entry.apply!.state);
    expect(states[0]).toBe("applied");
    expect(states.slice(1).every((state) => state === "failed")).toBe(true);
    expect(row(demoted, "Suppliers", "s-farm").apply!.error).toMatchObject({ code: "forbidden" });
    expect(await counts()).toMatchObject({ units: 1, suppliers: 0, items: 0, recipes: 0 });
  });

  it("refuses a stale record: the plan becomes stale before apply, and a change during apply fails only that unit", async () => {
    const { fx, applied } = await applyFirst();
    const { tenantId, admin } = fx;
    const boxId = savedId(applied, "Units", "u-box");
    const milkId = savedId(applied, "Ingredients", "i-milk");
    const workbook = await loadWorkbook(await exportBytes(tenantId));
    editRow(workbook, "Units", boxId, { action: "update", name: "Crate" });
    editRow(workbook, "Ingredients", milkId, { action: "update", notes: "Changed by workbook" });
    const reviewed = await completeReview(tenantId, await ok(await previewAs(ADMIN, tenantId, await saveWorkbook(workbook))));

    // Changed in the editor after the review: the plan is stale and nothing is applied.
    await db.update(inventoryUnits).set({ version: dsql`${inventoryUnits.version} + 1`, updatedAt: new Date("2026-11-27T10:00:00Z") }).where(eq(inventoryUnits.publicId, boxId));
    const stale = await applyAs(ADMIN, tenantId, reviewed);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "plan_stale" });
    expect((await getUnit(db, tenantId, boxId)).unit.nameEn).toBe("Box of 12");

    // Re-reviewed, then the item changes while the apply runs: that unit fails stale, and stays reviewable.
    const fresh = await loadWorkbook(await exportBytes(tenantId));
    editRow(fresh, "Units", boxId, { action: "update", name: "Crate" });
    editRow(fresh, "Ingredients", milkId, { action: "update", notes: "Changed by workbook" });
    const second = await completeReview(tenantId, await ok(await previewAs(ADMIN, tenantId, await saveWorkbook(fresh))));
    const raced = await applyWorkbookPlan(db, tenantId, admin, ADMIN, second.plan.publicId, { expectedPlanHash: second.plan.planHash, idempotencyKey: "race-1" }, {
      hooks: {
        beforeCheckpoint: async (unit) => {
          if (unit.sheet === "Units") {
            await other.db.update(inventoryItems).set({ notes: "Changed in the editor", version: dsql`${inventoryItems.version} + 1`, updatedAt: new Date() }).where(eq(inventoryItems.publicId, milkId));
          }
        },
      },
    });
    expect(raced.plan.status).toBe("apply_failed");
    expect(row(raced, "Units", boxId).apply!.state).toBe("applied");
    expect(row(raced, "Ingredients", milkId).apply).toMatchObject({ state: "failed", error: { code: "stale_revision" } });
    expect((await getItem(db, tenantId, milkId)).item.notes).toBe("Changed in the editor");
    const reloaded = await planOf(tenantId, second.plan.publicId);
    const rereview = await ok(await reviewAs(ADMIN, tenantId, second.plan.publicId, { expectedPlanHash: reloaded.plan.planHash, decisions: reloaded.acknowledgements.given }));
    // The workbook still proposes its value against the new record: reviewable (stale revision decision or update), never silently applied.
    expect(["conflicting", "update"]).toContain(row(rereview, "Ingredients", milkId).classification);
  });

  it("keeps one active warehouse per branch, refuses an unknown branch scope and isolates tenants", async () => {
    const { fx, applied } = await applyFirst();
    const { tenantId } = fx;
    const workbook = await loadWorkbook(await exportBytes(tenantId));
    appendRows(workbook, "Warehouses", [
      { warehouse_key: "w-second", action: "create", branch_key: BRANCH_A, code: "SECOND", name: "Second store", active: "TRUE" },
      { warehouse_key: "w-hct", action: "create", branch_key: BRANCH_B, code: "HCT", name: "HCT store", active: "TRUE" },
      { warehouse_key: "w-off", action: "create", branch_key: BRANCH_B, code: "OFF", name: "Off store", active: "FALSE" },
    ]);
    const result = await ok(await previewAs(ADMIN, tenantId, await saveWorkbook(workbook)));
    expect(row(result, "Warehouses", "w-second")).toMatchObject({ classification: "conflicting", candidates: [expect.objectContaining({ publicId: savedId(applied, "Warehouses", "w-main") })] });
    expect(row(result, "Warehouses", "w-second").diagnostics).toContainEqual(expect.objectContaining({ code: "existing_record_conflict", params: expect.objectContaining({ reason: "warehouse_branch_taken" }) }));
    expect(row(result, "Warehouses", "w-hct").classification).toBe("create");
    expect(row(result, "Warehouses", "w-off").diagnostics).toContainEqual(expect.objectContaining({ params: expect.objectContaining({ reason: "create_inactive" }) }));

    // A branch user's review only sees their branch's warehouses.
    as(USER);
    const userExport = await exportGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/export`), params(tenantId));
    expect(userExport.status).toBe(200);
    const userBook = await loadWorkbook(Buffer.from(await userExport.arrayBuffer()));
    expect(String(userBook.getWorksheet("Warehouses")!.getCell(7, 1).value)).toBe(savedId(applied, "Warehouses", "w-main"));

    // Another tenant sees none of this tenant's typed links or records.
    const [visible] = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE qos_app`;
      await tx`SELECT set_config('qos.current_tenant_id', ${fx.flowers.tenant.id}, true)`;
      return tx`SELECT (SELECT count(*)::int FROM qos.workbook_source_links) AS links, (SELECT count(*)::int FROM qos.inventory_items) AS items, (SELECT count(*)::int FROM qos.recipes) AS recipes`;
    });
    expect(visible).toEqual({ links: 0, items: 0, recipes: 0 });
    expect((await listUnits(db, fx.flowers.tenant.id)).units).toEqual([]);
    const flowersPreview = await previewAs(FLOWERS_ADMIN, fx.flowers.tenant.id, await exportBytes(tenantId));
    expect(flowersPreview.status).not.toBe(200);
  });

  it("refuses invalid Phase 2 rows at review with the service's reason, never dropping a column", async () => {
    const fx = await seed();
    const { tenantId } = fx;
    const workbook = await loadWorkbook(await exportBytes(tenantId));
    appendRows(workbook, "Units", [
      { unit_key: "u-crate", action: "create", name: "Crate", quantity_kind: "PACK", decimal_places: "0", active: "TRUE" },
      { unit_key: "u-kgx", action: "create", standard_code: "kg", name: "Kilo", quantity_kind: "VOLUME", decimal_places: "3", active: "TRUE" },
      { unit_key: "u-kg", action: "create", standard_code: "kg", name: "Kilogram", quantity_kind: "MASS", decimal_places: "3", active: "TRUE" },
      { unit_key: "u-g", action: "create", standard_code: "g", name: "Gram", quantity_kind: "MASS", decimal_places: "0", active: "TRUE" },
    ]);
    appendRows(workbook, "Ingredients", [
      { ingredient_key: "i-flour", action: "create", name_en: "Flour", ingredient_type: "PURCHASED", storage_unit_key: "u-kg", recipe_unit_key: "u-g", recipe_units_per_storage_unit: "999", active: "TRUE" },
      { ingredient_key: "i-salt", action: "create", name_en: "Salt", ingredient_type: "PURCHASED", storage_unit_key: "u-kg", recipe_unit_key: "u-g", recipe_units_per_storage_unit: "1000", reference_cost_per_storage_unit: "1.1234567", cost_currency: "USD", cost_effective_date: "28/11/2026", active: "TRUE" },
    ]);
    const result = await ok(await previewAs(ADMIN, tenantId, await saveWorkbook(workbook)));
    const reason = (sheet: string, key: string) => row(result, sheet, key).diagnostics.filter((entry) => entry.severity === "error").map((entry) => entry.params?.reason ?? entry.code);
    expect(reason("Units", "u-crate")).toEqual(["code_required"]);
    expect(reason("Units", "u-kgx")).toEqual(["standard_unit_kind_mismatch"]);
    expect(reason("Ingredients", "i-flour")).toEqual(["factor_conflicts_with_standard"]);
    expect(new Set(reason("Ingredients", "i-salt"))).toEqual(new Set(["decimal_too_precise", "currency_mismatch", "malformed_date"]));
    expect(row(result, "Units", "u-kg").classification).toBe("create");
  });
  /* QOS-200 follow-up: a hand-filled template (keys are workbook keys, not QOS ids), as browser QA used it. */
  async function templateBytes(tenantId: string, rows: Record<string, ReadonlyArray<Record<string, string>>>) {
    as(ADMIN);
    const response = await templateGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/template`), params(tenantId));
    expect(response.status).toBe(200);
    const workbook = await loadWorkbook(Buffer.from(await response.arrayBuffer()));
    for (const [sheet, entries] of Object.entries(rows)) appendRows(workbook, sheet, entries);
    return saveWorkbook(workbook);
  }

  /** The recipe row of the first workbook and its line, step and effect, edited by their workbook keys. */
  const APPROVED_EDIT = {
    Recipes: [{ recipe_version_key: "r-latte-1", action: "update", recipe_key: "r-latte", yield_quantity: "3" }],
    "Recipe Lines": [{ recipe_line_key: "l-milk", action: "update", recipe_version_key: "r-latte-1", quantity_recipe_units: "250" }],
    "Prep Steps": [{ prep_step_key: "p-steam", action: "update", recipe_version_key: "r-latte-1", instruction: "Steam to 60 degrees" }],
    "Modifier Effects": [{ effect_key: "e-sweet", action: "update", recipe_version_key: "r-latte-1", quantity_per_sold_unit: "7" }],
  };

  /** Everything stored for a version: its row and its lines, steps and effects, as JSON text. */
  async function versionState(publicId: string) {
    const [state] = await sql`
      SELECT
        (SELECT row_to_json(v)::text FROM qos.recipe_versions v WHERE v.public_id = ${publicId}) AS version,
        (SELECT coalesce(json_agg(row_to_json(l) ORDER BY l.position)::text, '[]') FROM qos.recipe_version_lines l JOIN qos.recipe_versions v ON v.id = l.recipe_version_id WHERE v.public_id = ${publicId}) AS lines,
        (SELECT coalesce(json_agg(row_to_json(s) ORDER BY s.position)::text, '[]') FROM qos.recipe_version_steps s JOIN qos.recipe_versions v ON v.id = s.recipe_version_id WHERE v.public_id = ${publicId}) AS steps,
        (SELECT coalesce(json_agg(row_to_json(e) ORDER BY e.position)::text, '[]') FROM qos.recipe_version_modifier_effects e JOIN qos.recipe_versions v ON v.id = e.recipe_version_id WHERE v.public_id = ${publicId}) AS effects
    `;
    return state!;
  }

  async function linkTarget(entityType: string, sourceKey: string) {
    const links = await db.select().from(workbookSourceLinks).where(eq(workbookSourceLinks.sourceKey, sourceKey));
    return links.filter((link) => link.entityType === entityType).map((link) => link.targetPublicId);
  }

  async function approveLatte(fx: Awaited<ReturnType<typeof seed>>, applied: WorkbookReviewResult) {
    const familyId = row(applied, "Recipes", "r-latte-1").apply!.result!.parentPublicId!;
    const v1 = row(applied, "Recipes", "r-latte-1").apply!.appliedPublicId!;
    const detail = await getRecipe(db, fx.tenantId, familyId);
    await approveVersion(db, fx.tenantId, fx.admin, ADMIN, familyId, v1, { expectedVersion: detail.versions[0]!.version, effectiveFrom: "2026-11-20" });
    return { familyId, v1, before: await versionState(v1) };
  }

  /** The draft's line, step and effect that copy the first workbook's l-milk, p-steam and e-sweet. */
  async function draftChildren(tenantId: string, familyId: string, draftId: string, applied: WorkbookReviewResult) {
    const draft = (await getRecipe(db, tenantId, familyId)).versions.find((version) => version.publicId === draftId)!;
    const milkItem = savedId(applied, "Ingredients", "i-milk");
    const sugarItem = savedId(applied, "Ingredients", "i-sugar");
    return {
      draft,
      line: draft.lines.find((line) => line.item.publicId === milkItem)!,
      step: [...draft.steps].sort((a, b) => a.position - b.position)[0]!,
      effect: draft.effects.find((effect) => effect.effectType === "add" && effect.item?.publicId === sugarItem)!,
    };
  }

  it("applies lines, steps and effects of an approved version to the draft its recipe row creates when the rows use workbook keys", async () => {
    const { fx, applied } = await applyFirst();
    const { tenantId } = fx;
    const { familyId, v1, before } = await approveLatte(fx, applied);
    const bytes = await templateBytes(tenantId, APPROVED_EDIT);

    const previewed = await ok(await previewAs(ADMIN, tenantId, bytes));
    for (const [sheet, key] of [["Recipes", "r-latte-1"], ["Recipe Lines", "l-milk"], ["Prep Steps", "p-steam"], ["Modifier Effects", "e-sweet"]] as const) {
      expect(row(previewed, sheet, key), `${sheet} ${key}`).toMatchObject({ classification: "update" });
    }
    const saved = await ok(await applyAs(ADMIN, tenantId, await completeReview(tenantId, previewed)));
    expect(saved.plan.status, JSON.stringify(saved.rows.filter((entry) => entry.apply?.state === "failed").map((entry) => [entry.sheet, entry.key, entry.apply?.error]))).toBe("applied");

    const draftId = row(saved, "Recipes", "r-latte-1").apply!.appliedPublicId!;
    expect(draftId).not.toBe(v1);
    const { draft, line, step, effect } = await draftChildren(tenantId, familyId, draftId, applied);
    expect(draft).toMatchObject({ status: "draft", versionNumber: 2, yieldQuantity: "3" });
    expect(line.quantity).toBe("250");
    expect(step.textEn).toBe("Steam to 60 degrees");
    expect(effect.quantity).toBe("7");
    // Each child row was saved to its copy on the draft, and its key now follows that copy.
    expect(row(saved, "Recipe Lines", "l-milk").apply!.appliedPublicId).toBe(line.publicId);
    expect(row(saved, "Prep Steps", "p-steam").apply!.appliedPublicId).toBe(step.publicId);
    expect(row(saved, "Modifier Effects", "e-sweet").apply!.appliedPublicId).toBe(effect.publicId);
    expect(await linkTarget("recipe_version", "r-latte-1")).toEqual([draftId]);
    expect(await linkTarget("recipe_line", "l-milk")).toEqual([line.publicId]);
    expect(await linkTarget("prep_step", "p-steam")).toEqual([step.publicId]);
    expect(await linkTarget("modifier_effect", "e-sweet")).toEqual([effect.publicId]);

    // The approved version, its lines, steps and effects are byte-identical; one draft, nothing approved.
    expect(await versionState(v1)).toEqual(before);
    const after = await getRecipe(db, tenantId, familyId);
    expect(after.versions.filter((version) => version.status === "draft").map((version) => version.publicId)).toEqual([draftId]);
    expect(after.versions.find((version) => version.publicId === v1)).toMatchObject({ status: "approved", yieldQuantity: "1" });
    expect(await counts()).toMatchObject({ snapshots: 1, publishes: 0, live: 0 });
  });

  it("re-uploading while that draft is open makes the recipe row conflicting with the draft and blocks its lines until it is chosen", async () => {
    const { fx, applied } = await applyFirst();
    const { tenantId } = fx;
    const { familyId } = await approveLatte(fx, applied);
    const bytes = await templateBytes(tenantId, APPROVED_EDIT);
    const first = await ok(await applyAs(ADMIN, tenantId, await completeReview(tenantId, await ok(await previewAs(ADMIN, tenantId, bytes)))));
    expect(first.plan.status).toBe("applied");
    const draftId = row(first, "Recipes", "r-latte-1").apply!.appliedPublicId!;

    // The same file again, as a new upload: the open draft is a human-owned state, so the operator chooses it.
    const again = await ok(await previewAs(ADMIN, tenantId, bytes));
    const recipe = row(again, "Recipes", "r-latte-1");
    expect(recipe.classification).toBe("conflicting");
    expect(recipe.candidates?.map((candidate) => candidate.publicId)).toEqual([draftId]);
    expect(recipe.diagnostics).toContainEqual(expect.objectContaining({ code: "existing_record_conflict", params: expect.objectContaining({ reason: "draft_exists" }) }));
    for (const [sheet, key] of [["Recipe Lines", "l-milk"], ["Prep Steps", "p-steam"], ["Modifier Effects", "e-sweet"]] as const) {
      const child = row(again, sheet, key);
      expect(child.classification, `${sheet} ${key}`).toBe("blocked");
      expect(child.diagnostics).toContainEqual(expect.objectContaining({ code: "blocked_by_dependency", params: expect.objectContaining({ refSheet: "Recipes", key: "r-latte-1", reason: "conflicting" }) }));
    }

    const before = await counts();
    const draftBefore = await versionState(draftId);
    const decided = await ok(
      await reviewAs(ADMIN, tenantId, again.plan.publicId, {
        expectedPlanHash: again.plan.planHash,
        decisions: [{ kind: "match_existing", sheet: "Recipes", row: recipe.row, key: "r-latte-1", targetPublicId: draftId }],
      }),
    );
    expect(row(decided, "Recipes", "r-latte-1")).toMatchObject({ classification: "unchanged", identity: expect.objectContaining({ targetPublicId: draftId }) });
    for (const [sheet, key] of [["Recipe Lines", "l-milk"], ["Prep Steps", "p-steam"], ["Modifier Effects", "e-sweet"]] as const) {
      expect(row(decided, sheet, key).classification, `${sheet} ${key}`).toBe("unchanged");
    }
    const reapplied = await ok(await applyAs(ADMIN, tenantId, await completeReview(tenantId, decided)));
    expect(reapplied.plan.status).toBe("applied");
    expect(await counts()).toEqual(before);
    expect(await versionState(draftId)).toEqual(draftBefore);
    expect((await getRecipe(db, tenantId, familyId)).versions.filter((version) => version.status === "draft")).toHaveLength(1);
  });

  it("a retry after a partial apply follows the draft the same plan made, with no conflict", async () => {
    const { fx, applied } = await applyFirst();
    const { tenantId, admin } = fx;
    const { familyId, v1, before } = await approveLatte(fx, applied);
    const reviewed = await completeReview(tenantId, await ok(await previewAs(ADMIN, tenantId, await templateBytes(tenantId, APPROVED_EDIT))));
    const lineRow = row(reviewed, "Recipe Lines", "l-milk").row;
    const failed = await applyWorkbookPlan(db, tenantId, admin, ADMIN, reviewed.plan.publicId, { expectedPlanHash: reviewed.plan.planHash, idempotencyKey: "fault-approved-line" }, { hooks: { beforeCheckpoint: faultAt("Recipe Lines", lineRow) } });
    expect(failed.plan.status).toBe("apply_failed");
    expect(row(failed, "Recipes", "r-latte-1").apply!.state).toBe("applied");
    expect(row(failed, "Recipe Lines", "l-milk").apply!.state).toBe("failed");
    const draftId = row(failed, "Recipes", "r-latte-1").apply!.appliedPublicId!;
    const copy = (await draftChildren(tenantId, familyId, draftId, applied)).line;
    expect(copy.quantity).toBe("200");

    // Revalidate the same plan: the recipe row follows its own draft; the line row is matched to its copy on that draft.
    const current = await planOf(tenantId, reviewed.plan.publicId);
    const rereviewed = await ok(await reviewAs(ADMIN, tenantId, current.plan.publicId, { expectedPlanHash: current.plan.planHash, decisions: [...current.acknowledgements.given, ...current.rows.flatMap((entry) => (entry.decision ? [entry.decision] : []))] }));
    expect(row(rereviewed, "Recipes", "r-latte-1")).toMatchObject({ classification: "unchanged", identity: expect.objectContaining({ targetPublicId: draftId }) });
    expect(row(rereviewed, "Recipe Lines", "l-milk")).toMatchObject({ classification: "update", identity: expect.objectContaining({ targetPublicId: copy.publicId }) });
    const finished = await ok(await applyAs(ADMIN, tenantId, await completeReview(tenantId, rereviewed)));
    expect(finished.plan.status, JSON.stringify(finished.rows.filter((entry) => entry.apply?.state === "failed").map((entry) => [entry.sheet, entry.key, entry.apply?.error]))).toBe("applied");
    expect((await draftChildren(tenantId, familyId, draftId, applied)).line.quantity).toBe("250");
    expect(await linkTarget("recipe_line", "l-milk")).toEqual([copy.publicId]);
    expect(await versionState(v1)).toEqual(before);
    expect((await getRecipe(db, tenantId, familyId)).versions.filter((version) => version.status === "draft")).toHaveLength(1);
  });
});
