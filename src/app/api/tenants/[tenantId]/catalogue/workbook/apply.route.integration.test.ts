import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { eq, sql as dsql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogueCategories,
  catalogueCategoryTranslations,
  catalogueMenuLiveRevisions,
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
  workbookSourceLinks,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { applyWorkbookPlan } from "@/lib/workbook/apply";
import { faultAt } from "@/lib/workbook/apply/test-support";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { buildFoodicsMenuFixture } from "@/lib/workbook/foodics-menu/fixture";
import type { PlanDecision, WorkbookReviewResult } from "@/lib/workbook/validation/model";

import { POST as applyPOST } from "./plans/[planPublicId]/apply/route";
import { POST as reviewPOST } from "./plans/[planPublicId]/review/route";
import { GET as planGET } from "./plans/[planPublicId]/route";
import { POST as previewPOST } from "./preview/route";

/* QOS-217 apply routes against local Postgres (`qos_qos217`). Seed and auth
   mocks follow the QOS-194 preview route test. */

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

const ORIGINAL_SHA256 = "2a73c4f19c98e35803b026038b08439a5f0f77070f88e59e4356623ded3e4cd3";
const PRIVATE_DIR = "/workspace/qos-phase2/private";

function originalPath() {
  const fromEnv = process.env.QOS_216_SOURCE_XLSX;
  if (fromEnv) return fromEnv;
  if (!existsSync(PRIVATE_DIR)) return null;
  const candidate = readdirSync(PRIVATE_DIR).find((name) => name.toLowerCase().endsWith(".xlsx"));
  return candidate ? path.join(PRIVATE_DIR, candidate) : null;
}

const TRUNCATE = `TRUNCATE TABLE qos.workbook_source_links, qos.workbook_import_plan_rows, qos.workbook_import_applies, qos.workbook_import_plans, qos.catalogue_import_source_links, qos.tenant_audit_events, qos.catalogue_menu_live_revisions, qos.catalogue_menu_publish_operations, qos.catalogue_variant_location_price_reset_audits, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_product_categories, qos.catalogue_category_translations, qos.catalogue_categories, qos.catalogue_variant_location_price_overrides, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;

integrationDescribe("catalogue workbook apply routes (DB)", () => {
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
    await sqlClient.unsafe(TRUNCATE);
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

    await db.insert(catalogueMenuLiveRevisions).values({
      tenantId,
      menuId: menu.id,
      locationId: quotes.locationA.id,
      sourceVersion: 1,
      payload: { hash: "live-a" } as never,
      publishedBySubject: ADMIN,
    });
    await db.insert(catalogueMenuLiveRevisions).values({
      tenantId,
      menuId: menu.id,
      locationId: quotes.locationB.id,
      sourceVersion: 1,
      payload: { hash: "live-b" } as never,
      publishedBySubject: ADMIN,
    });

    return { quotes, flowers, tenantId, productId: product.id, menuId: menu.id, admin };
  }

  function as(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }

  function params(tenantId: string) {
    return { params: Promise.resolve({ tenantId }) };
  }

  function planParams(tenantId: string, planPublicId: string) {
    return { params: Promise.resolve({ tenantId, planPublicId }) };
  }

  let foodicsFixture: Promise<Buffer> | null = null;
  function foodicsMenu() {
    foodicsFixture ??= buildFoodicsMenuFixture({ filled: true, prefillLastRow: 200 });
    return foodicsFixture;
  }

  let keyCounter = 0;
  function nextKey() {
    keyCounter += 1;
    return `apply-key-${keyCounter}`;
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

  async function applyAs(
    subject: string,
    tenantId: string,
    planPublicId: string,
    expectedPlanHash: string,
    options: { key?: string | null } = {},
  ) {
    as(subject);
    const headers = new Headers({ "content-type": "application/json" });
    const key = options.key === undefined ? nextKey() : options.key;
    if (key) headers.set("Idempotency-Key", key);
    return applyPOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${planPublicId}/apply`, {
        method: "POST",
        headers,
        body: JSON.stringify({ expectedPlanHash }),
      }),
      planParams(tenantId, planPublicId),
    );
  }

  async function ok(response: Response) {
    const body = await response.json();
    expect(response.status, JSON.stringify(body).slice(0, 800)).toBe(200);
    return body as WorkbookReviewResult;
  }

  function decisionsFor(result: WorkbookReviewResult): PlanDecision[] {
    const decisions: PlanDecision[] = [];
    for (const row of result.rows) {
      if (row.classification === "conflicting") {
        const preferred =
          row.candidates?.find((candidate) => candidate.publicId === "prd_flat_white" || candidate.publicId === "var_flat_white_regular") ??
          row.candidates?.[0];
        if (preferred) {
          decisions.push({ kind: "match_existing", sheet: row.sheet, row: row.row, targetPublicId: preferred.publicId });
        } else {
          decisions.push({ kind: "exclude", sheet: row.sheet, row: row.row });
        }
      } else if (row.classification === "invalid") {
        decisions.push({ kind: "exclude", sheet: row.sheet, row: row.row });
      }
    }
    for (const ack of result.acknowledgements.required) {
      if (ack.kind === "acknowledge_deferred") {
        decisions.push({ kind: "acknowledge_deferred", sheet: ack.sheet!, column: ack.column! });
      } else {
        decisions.push({ kind: ack.kind });
      }
    }
    return decisions;
  }

  function decisionKey(decision: PlanDecision) {
    if ("sheet" in decision && "row" in decision && typeof decision.row === "number") {
      return `row:${decision.sheet}:${decision.row}`;
    }
    if (decision.kind === "acknowledge_deferred") {
      return `ack:${decision.kind}:${decision.sheet}:${decision.column}`;
    }
    return `ack:${decision.kind}`;
  }

  function mergeDecisions(existing: PlanDecision[], extra: PlanDecision[]) {
    const merged = new Map<string, PlanDecision>();
    for (const decision of [...existing, ...extra]) merged.set(decisionKey(decision), decision);
    return [...merged.values()];
  }

  async function completeReview(subject: string, tenantId: string, initial: WorkbookReviewResult) {
    let plan = initial;
    let decisions: PlanDecision[] = [
      ...plan.rows.flatMap((row) => (row.decision ? [row.decision] : [])),
      ...plan.acknowledgements.given,
    ];
    for (let step = 0; step < 5 && !plan.readiness.reviewComplete; step += 1) {
      decisions = mergeDecisions(decisions, decisionsFor(plan));
      plan = await ok(
        await reviewAs(subject, tenantId, plan.plan.publicId, { expectedPlanHash: plan.plan.planHash, decisions }),
      );
    }
    expect(plan.readiness.reviewComplete, JSON.stringify({ readiness: plan.readiness, leftover: plan.rows.filter((row) => row.classification === "conflicting" || row.classification === "invalid").map((row) => ({ sheet: row.sheet, row: row.row, key: row.key, classification: row.classification, candidates: row.candidates, diagnostics: row.diagnostics })) })).toBe(true);
    expect(plan.apply?.permissions.canApply).toBe(subject === ADMIN);
    return plan;
  }

  async function catalogueCounts() {
    const [row] = await sqlClient`
      SELECT
        (SELECT count(*)::int FROM qos.catalogue_products) AS products,
        (SELECT count(*)::int FROM qos.catalogue_variants) AS variants,
        (SELECT count(*)::int FROM qos.catalogue_categories) AS categories,
        (SELECT count(*)::int FROM qos.catalogue_menus) AS menus,
        (SELECT count(*)::int FROM qos.catalogue_menu_sections) AS sections,
        (SELECT count(*)::int FROM qos.catalogue_menu_section_products) AS items,
        (SELECT count(*)::int FROM qos.catalogue_modifier_groups) AS groups,
        (SELECT count(*)::int FROM qos.catalogue_modifier_options) AS options,
        (SELECT count(*)::int FROM qos.workbook_source_links) AS source_links,
        (SELECT count(*)::int FROM qos.catalogue_import_source_links) AS product_source_links,
        (SELECT count(*)::int FROM qos.catalogue_menu_live_revisions) AS live_revisions,
        (SELECT count(*)::int FROM qos.catalogue_menu_publish_operations) AS publish_operations
    `;
    return row!;
  }

  it("returns 401 without a staff session and requires an Idempotency-Key", async () => {
    const { tenantId } = await seed();
    vi.stubEnv("STAFF_BETTER_AUTH_SECRET", "qos217-route-test-secret-qos217-route-test");
    const actual = await vi.importActual<typeof import("@/lib/staff/auth")>("@/lib/staff/auth");
    staffMocks.requireStaffIdentity.mockImplementation(actual.requireStaffIdentity);
    const response = await applyPOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/wbp_0000000000000000/apply`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": "k" },
        body: JSON.stringify({ expectedPlanHash: "h".repeat(64) }),
      }),
      planParams(tenantId, "wbp_0000000000000000"),
    );
    expect(response.status).toBe(401);

    staffMocks.requireStaffIdentity.mockReset();
    as(ADMIN);
    const missing = await applyPOST(
      new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/wbp_0000000000000000/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedPlanHash: "h".repeat(64) }),
      }),
      planParams(tenantId, "wbp_0000000000000000"),
    );
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ code: "idempotency_key_required" });
  });

  it("answers 404 for another tenant or plan and 403 for a user member", async () => {
    const { tenantId, flowers } = await seed();
    const previewed = await ok(await previewAs(ADMIN, tenantId, await foodicsMenu()));
    const planId = previewed.plan.publicId;
    const hash = previewed.plan.planHash;

    expect((await applyAs(FLOWERS_ADMIN, tenantId, planId, hash)).status).toBe(404);
    expect((await applyAs(ADMIN, flowers.tenant.id, planId, hash)).status).toBe(404);
    expect((await applyAs(ADMIN, "00000000-0000-4000-8000-000000000000", planId, hash)).status).toBe(404);
    expect((await applyAs(ADMIN, "not-a-uuid", planId, hash)).status).toBe(404);
    expect((await applyAs(ADMIN, tenantId, "wbp_ffffffffffffffff", hash)).status).toBe(404);

    const forbidden = await applyAs(USER_HBZ, tenantId, planId, hash);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toMatchObject({ code: "apply_requires_administrator" });
  });

  it("applies a reviewed filled Foodics fixture, is a no-op on re-apply, and leaves live menus unchanged", async () => {
    const { tenantId } = await seed();
    const before = await catalogueCounts();
    const liveBefore = await db.select().from(catalogueMenuLiveRevisions);
    expect(liveBefore).toHaveLength(2);

    const previewed = await ok(await previewAs(ADMIN, tenantId, await foodicsMenu()));
    expect(previewed.apply?.permissions.canApply).toBe(false);
    const reviewed = await completeReview(ADMIN, tenantId, previewed);
    expect(reviewed.apply?.permissions.canApply).toBe(true);

    const applied = await ok(await applyAs(ADMIN, tenantId, reviewed.plan.publicId, reviewed.plan.planHash, { key: "happy-1" }));
    expect(applied.plan.status, JSON.stringify(applied.apply?.attempts)).toBe("applied");
    expect(applied.replayed).toBeFalsy();
    expect(applied.apply?.attempts[0]?.status).toBe("completed");
    expect(applied.apply?.permissions.canApply).toBe(false);

    const after = await catalogueCounts();
    expect(after.products).toBeGreaterThan(before.products);
    expect(after.variants).toBeGreaterThan(before.variants);
    expect(after.categories).toBeGreaterThanOrEqual(before.categories);
    // Foodics conversion does not emit Menus / sections / items; apply must not invent them.
    expect(after.menus).toBe(before.menus);
    expect(after.source_links).toBeGreaterThan(0);
    expect(after.product_source_links).toBe(0);
    expect(after.live_revisions).toBe(before.live_revisions);
    expect(after.publish_operations).toBe(0);

    const links = await db.select().from(workbookSourceLinks);
    expect(links.every((link) => link.sourceNamespace.startsWith("foodics-menu-v1:"))).toBe(true);
    expect(new Set(links.map((link) => `${link.entityType}:${link.sourceKey}`)).size).toBe(links.length);

    const [flat] = await db.select().from(catalogueProducts).where(eq(catalogueProducts.publicId, "prd_flat_white"));
    expect(flat).toBeTruthy();
    // Flat White regular is updated to 1250 in the fixture when matched.
    const updated = await db
      .select({ amountMinor: catalogueVariantPrices.amountMinor })
      .from(catalogueVariantPrices)
      .innerJoin(catalogueVariants, eq(catalogueVariants.id, catalogueVariantPrices.variantId))
      .where(eq(catalogueVariants.publicId, "var_flat_white_regular"));
    expect(updated[0]?.amountMinor).toBe(1250);

    const audits = await sqlClient`SELECT action FROM qos.tenant_audit_events WHERE action LIKE 'catalogue.workbook.apply.%'`;
    expect(audits.map((row) => row.action)).toEqual(expect.arrayContaining(["catalogue.workbook.apply.start", "catalogue.workbook.apply.finish"]));
    expect(audits.some((row) => row.action === "catalogue.workbook.apply.row")).toBe(true);

    const liveAfter = await db.select().from(catalogueMenuLiveRevisions);
    expect(liveAfter.map((row) => row.payload)).toEqual(liveBefore.map((row) => row.payload));

    const replayed = await ok(await applyAs(ADMIN, tenantId, applied.plan.publicId, applied.plan.planHash, { key: "happy-1" }));
    expect(replayed.replayed).toBe(true);
    expect(await catalogueCounts()).toEqual(after);

    const second = await applyAs(ADMIN, tenantId, applied.plan.publicId, applied.plan.planHash, { key: "happy-2" });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ code: "plan_applied" });
    expect(await catalogueCounts()).toEqual(after);

    const reimport = await ok(await previewAs(ADMIN, tenantId, await foodicsMenu()));
    expect(reimport.counts.create).toBe(0);
    const colliding = reimport.rows.filter((row) => row.classification === "conflicting");
    expect(colliding.some((row) => row.sheet === "Products")).toBe(false);
  });

  it("rejects a stale plan, a hash mismatch, and does not apply name-only conflicts", async () => {
    const { tenantId, productId } = await seed();
    const previewed = await ok(await previewAs(ADMIN, tenantId, await foodicsMenu()));
    const reviewed = await completeReview(ADMIN, tenantId, previewed);
    const before = await catalogueCounts();

    const mismatch = await applyAs(ADMIN, tenantId, reviewed.plan.publicId, "0".repeat(64));
    expect(mismatch.status).toBe(409);
    expect(await mismatch.json()).toMatchObject({ code: "plan_hash_mismatch" });
    expect(await catalogueCounts()).toEqual(before);

    await db
      .update(catalogueProducts)
      .set({ version: dsql`${catalogueProducts.version} + 1`, updatedAt: new Date("2026-11-22T08:00:00Z") })
      .where(eq(catalogueProducts.id, productId));
    const stale = await applyAs(ADMIN, tenantId, reviewed.plan.publicId, reviewed.plan.planHash);
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "plan_stale" });
    expect(await catalogueCounts()).toEqual(before);

    const loaded = await ok(await planGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${reviewed.plan.publicId}`), planParams(tenantId, reviewed.plan.publicId)));
    expect(loaded.plan.status).toBe("stale");
  });

  it("applies the original template as a no-op when the private file is present", async () => {
    const source = originalPath();
    if (!source) {
      // Keep the suite honest: the file is present on this machine; if it
      // disappears, skip with the same documented reason as QOS-194.
      expect(source, "original workbook missing").toBeTruthy();
      return;
    }
    const bytes = readFileSync(source);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(ORIGINAL_SHA256);
    const { tenantId } = await seed();
    const before = await catalogueCounts();
    const previewed = await ok(await previewAs(ADMIN, tenantId, bytes, { fileName: path.basename(source) }));
    expect(previewed.counts.rows).toBe(0);
    expect(previewed.counts.create).toBe(0);
    expect(previewed.counts.update).toBe(0);
    const reviewed = previewed.readiness.reviewComplete ? previewed : await completeReview(ADMIN, tenantId, previewed);
    const applied = await ok(await applyAs(ADMIN, tenantId, reviewed.plan.publicId, reviewed.plan.planHash));
    expect(applied.plan.status).toBe("applied");
    expect(await catalogueCounts()).toEqual(before);
    const rowAudits = await sqlClient`SELECT action FROM qos.tenant_audit_events WHERE action = 'catalogue.workbook.apply.row'`;
    expect(rowAudits).toEqual([]);
  });

  it("rolls back the in-flight unit on an injected fault and retries after re-review without duplicates", async () => {
    const { tenantId, admin } = await seed();
    const previewed = await ok(await previewAs(ADMIN, tenantId, await foodicsMenu()));
    const reviewed = await completeReview(ADMIN, tenantId, previewed);
    const before = await catalogueCounts();
    const productCreates = reviewed.rows.filter((row) => row.sheet === "Products" && row.classification === "create");
    expect(productCreates.length).toBeGreaterThan(0);
    const targetRow = productCreates[0]!.row;

    await expect(
      applyWorkbookPlan(
        db,
        tenantId,
        admin,
        ADMIN,
        reviewed.plan.publicId,
        { expectedPlanHash: reviewed.plan.planHash, idempotencyKey: "fault-1" },
        { hooks: { beforeCheckpoint: faultAt("Products", targetRow) } },
      ),
    ).resolves.toMatchObject({ plan: { status: "apply_failed" } });

    const mid = await catalogueCounts();
    expect(mid.products).toBeGreaterThanOrEqual(before.products);
    const named = await sqlClient`
      SELECT p.public_id, p.internal_name
      FROM qos.catalogue_products p
      JOIN qos.workbook_import_plan_rows r ON r.applied_public_id = p.public_id
      WHERE r.sheet = 'Products' AND r.row_number = ${targetRow}`;
    expect(named).toEqual([]);
    const failed = await sqlClient`
      SELECT apply_state, apply_error
      FROM qos.workbook_import_plan_rows
      WHERE sheet = 'Products' AND row_number = ${targetRow}`;
    expect(failed[0]?.apply_state).toBe("failed");

    const afterReview = await ok(
      await reviewAs(ADMIN, tenantId, reviewed.plan.publicId, {
        expectedPlanHash: (await ok(await planGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${reviewed.plan.publicId}`), planParams(tenantId, reviewed.plan.publicId)))).plan.planHash,
        decisions: decisionsFor(
          await ok(await planGET(new Request(`http://localhost/api/tenants/${tenantId}/catalogue/workbook/plans/${reviewed.plan.publicId}`), planParams(tenantId, reviewed.plan.publicId))),
        ),
      }),
    );
    const retried = afterReview.readiness.reviewComplete
      ? afterReview
      : await completeReview(ADMIN, tenantId, afterReview);
    const finished = await ok(await applyAs(ADMIN, tenantId, retried.plan.publicId, retried.plan.planHash, { key: "fault-2" }));
    expect(finished.plan.status).toBe("applied");
    const links = await sqlClient`
      SELECT entity_type, source_key, target_public_id
      FROM qos.workbook_source_links`;
    const keys = links.map((row) => `${row.entity_type}:${row.source_key}`);
    expect(keys).toEqual([...new Set(keys)]);
  });
});
