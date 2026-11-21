import { and, asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogueModifierOptionReferenceCostPolicies,
  catalogueVariantReferenceCostPolicies,
  catalogueVariants,
  staffIdentities,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import type { ModifierGroupEditorView } from "@/lib/catalogue/modifiers";
import { createModifierGroup } from "@/lib/catalogue/modifiers";
import { createDraftProduct, type DraftProductEditorView } from "@/lib/catalogue/products";
import type { ProductVariantsEditorView } from "@/lib/catalogue/variants";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { loadCurrentRecordExport } from "@/lib/workbook/export";

import { GET as getGroup } from "../../../modifier-groups/[groupPublicId]/route";
import { POST as postOption } from "../../../modifier-groups/[groupPublicId]/options/route";
import { PATCH as patchOption } from "../../../modifier-groups/[groupPublicId]/options/[optionPublicId]/route";
import { GET as getProduct } from "../route";
import { GET as listVariants, POST as postVariant } from "./route";
import { PATCH as patchVariant } from "./[variantPublicId]/route";

const staffMocks = vi.hoisted(() => ({ requireStaffIdentity: vi.fn() }));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return { ...actual, requireStaffIdentity: staffMocks.requireStaffIdentity };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN = "admin.qos215@test";
const USER = "user.qos215@test";
const OUTSIDER = "outsider.qos215@test";
const FLOWERS_ADMIN = "admin.flowers.qos215@test";

integrationDescribe("QOS-215 selling tax and reference-cost policies (DB routes)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_modifier_option_reference_cost_policies, qos.catalogue_variant_reference_cost_policies, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_variant_translations, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_location_scopes, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  async function seedMember(tenantId: string, subject: string, role: "administrator" | "user") {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    const tenantId = quotes.tenant.id;
    const admin = await seedMember(tenantId, ADMIN, "administrator");
    await seedMember(tenantId, USER, "user");
    await seedMember(flowers.tenant.id, FLOWERS_ADMIN, "administrator");
    await db.insert(staffIdentities).values({ providerSubject: OUTSIDER, email: OUTSIDER });

    const product = await createDraftProduct(db, tenantId, admin, {
      internalName: "qos215-flat-white",
      translations: {
        en: { displayName: "Flat White", description: null },
        ar: { displayName: "فلات وايت", description: null },
      },
      defaultVariant: { amountMinor: 1800, currency: "AED" },
    });
    const group = await createModifierGroup(
      db,
      tenantId,
      { internalName: "milk", translations: { en: { displayName: "Milk" }, ar: { displayName: "حليب" } } },
      ADMIN,
      admin,
    );
    return { tenantId, flowersTenantId: flowers.tenant.id, admin, product, group };
  }

  function as(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }

  async function patchVariantAs(
    subject: string,
    tenantId: string,
    productPublicId: string,
    variantPublicId: string,
    body: Record<string, unknown>,
  ) {
    as(subject);
    const response = await patchVariant(
      new Request("http://localhost/variant", { method: "PATCH", body: JSON.stringify(body) }),
      { params: Promise.resolve({ tenantId, productPublicId, variantPublicId }) },
    );
    return { status: response.status, body: (await response.json()) as ProductVariantsEditorView & { error?: string; field?: string } };
  }

  async function variantsOf(tenantId: string, productPublicId: string) {
    as(ADMIN);
    const response = await listVariants(new Request("http://localhost/variants"), {
      params: Promise.resolve({ tenantId, productPublicId }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as ProductVariantsEditorView;
  }

  async function variantRow(tenantId: string, publicId: string) {
    const [row] = await db
      .select()
      .from(catalogueVariants)
      .where(and(eq(catalogueVariants.tenantId, tenantId), eq(catalogueVariants.publicId, publicId)));
    return row!;
  }

  async function variantPolicyHistory(variantId: string) {
    return db
      .select()
      .from(catalogueVariantReferenceCostPolicies)
      .where(eq(catalogueVariantReferenceCostPolicies.variantId, variantId))
      .orderBy(asc(catalogueVariantReferenceCostPolicies.revision));
  }

  async function exportRow(tenantId: string, admin: Awaited<ReturnType<typeof seedMember>>, sheet: "Variants" | "Modifier Options", key: string) {
    const exported = await loadCurrentRecordExport(db, tenantId, admin);
    const keyColumn = sheet === "Variants" ? "variant_key" : "modifier_option_key";
    const rows = exported.records[sheet].filter((row) => row[keyColumn] === key);
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  it("saves and reloads variant tax: inclusive/exclusive/unconfirmed, 0 bps, and clear to null", async () => {
    const { tenantId, product } = await seed();
    const variantPublicId = product.defaultVariant.publicId;

    const zero = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: product.version,
      priceTaxBasis: "inclusive",
      taxRateBasisPoints: 0,
    });
    expect(zero.status).toBe(200);
    expect(zero.body.productVersion).toBe(product.version + 1);
    let reloaded = (await variantsOf(tenantId, product.publicId)).variants[0]!;
    expect(reloaded).toMatchObject({ priceTaxBasis: "inclusive", taxRateBasisPoints: 0, taxProvenance: "operator_entered" });

    // Omitting a tax field keeps it; the known 0% rate survives a basis change.
    const exclusive = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: zero.body.productVersion,
      priceTaxBasis: "exclusive",
    });
    reloaded = (await variantsOf(tenantId, product.publicId)).variants[0]!;
    expect(reloaded).toMatchObject({ priceTaxBasis: "exclusive", taxRateBasisPoints: 0 });

    const unconfirmed = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: exclusive.body.productVersion,
      priceTaxBasis: "unconfirmed",
      taxRateBasisPoints: 500,
    });
    reloaded = (await variantsOf(tenantId, product.publicId)).variants[0]!;
    expect(reloaded).toMatchObject({ priceTaxBasis: "unconfirmed", taxRateBasisPoints: 500 });
    expect(reloaded.referenceMargin).toEqual({ status: "unavailable", reason: "unconfirmed_selling_tax_basis" });

    // An unrelated update leaves tax alone.
    const unrelated = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: unconfirmed.body.productVersion,
      sku: "FW-1",
    });
    expect(unrelated.status).toBe(200);
    expect((await variantsOf(tenantId, product.publicId)).variants[0]).toMatchObject({
      priceTaxBasis: "unconfirmed",
      taxRateBasisPoints: 500,
    });

    const cleared = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: unrelated.body.productVersion,
      priceTaxBasis: null,
      taxRateBasisPoints: null,
    });
    expect(cleared.status).toBe(200);
    expect(await variantRow(tenantId, variantPublicId)).toMatchObject({
      priceTaxBasis: null,
      taxRateBasisPoints: null,
      taxProvenance: null,
    });

    const audits = await db
      .select({ action: tenantAuditEvents.action, changeSummary: tenantAuditEvents.changeSummary })
      .from(tenantAuditEvents)
      .where(and(eq(tenantAuditEvents.tenantId, tenantId), eq(tenantAuditEvents.action, "catalogue.variant_tax.update")))
      .orderBy(asc(tenantAuditEvents.occurredAt));
    expect(audits).toHaveLength(4);
    expect(audits[0]!.changeSummary).toMatchObject({
      before: { priceTaxBasis: null, taxRateBasisPoints: null },
      after: { priceTaxBasis: "inclusive", taxRateBasisPoints: 0 },
    });

    // Invalid values are rejected rather than coerced.
    const bad = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: cleared.body.productVersion,
      priceTaxBasis: "GROSS",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.field).toBe("priceTaxBasis");
  });

  it("keeps a manual variant override through save, reload, generic updates and export; recipe-derived and clear are explicit", async () => {
    const { tenantId, product, admin } = await seed();
    const variantPublicId = product.defaultVariant.publicId;
    const variant = await variantRow(tenantId, variantPublicId);

    const manualZero = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: product.version,
      priceTaxBasis: "exclusive",
      taxRateBasisPoints: 500,
      costPolicy: {
        operation: "set_manual",
        amount: "0",
        currency: "AED",
        unit: "each",
        taxBasis: "net",
        effectiveFrom: "2026-11-01",
        source: "Owner costing sheet",
      },
    });
    expect(manualZero.status).toBe(200);
    let reloaded = (await variantsOf(tenantId, product.publicId)).variants[0]!;
    expect(reloaded.referenceCost.policy).toMatchObject({
      method: "manual",
      amountMicros: "0",
      amountMajor: "0",
      currency: "AED",
      unit: "each",
      taxBasis: "net",
      effectiveFrom: "2026-11-01",
      revision: 1,
      provenance: "operator_entered",
    });
    expect(reloaded.referenceCost.resolution).toMatchObject({ status: "manual_reference", amountMicros: "0" });
    expect(reloaded.referenceMargin).toMatchObject({ status: "available", basis: "net", marginMicros: "18000000" });
    const firstPolicyId = reloaded.referenceCost.policy!.publicId;

    // A generic update that omits costPolicy leaves the override in place.
    const generic = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: manualZero.body.productVersion,
      translations: { en: { displayName: "Regular" }, ar: { displayName: "عادي" } },
    });
    expect(generic.status).toBe(200);
    reloaded = (await variantsOf(tenantId, product.publicId)).variants[0]!;
    expect(reloaded.referenceCost.policy).toMatchObject({ publicId: firstPolicyId, amountMicros: "0", revision: 1 });
    expect(await variantPolicyHistory(variant.id)).toHaveLength(1);

    // Product view carries the default variant's tax and cost (no product-level store).
    as(ADMIN);
    const productResponse = await getProduct(new Request("http://localhost/product"), {
      params: Promise.resolve({ tenantId, productPublicId: product.publicId }),
    });
    const productView = ((await productResponse.json()) as { product: DraftProductEditorView }).product;
    expect(productView.defaultVariant).toMatchObject({
      priceTaxBasis: "exclusive",
      taxRateBasisPoints: 500,
      referenceCost: { policy: { publicId: firstPolicyId } },
    });

    expect(await exportRow(tenantId, admin, "Variants", variantPublicId)).toMatchObject({
      price_tax_basis: "exclusive",
      tax_rate_basis_points: "500",
      cost_method: "manual",
      reference_cost_amount: "0",
      cost_currency: "AED",
      cost_unit: "each",
      cost_tax_basis: "NET",
      cost_effective_date: "2026-11-01",
      cost_source: "Owner costing sheet",
      cost_source_reference: "",
    });

    // A successor closes the previous row; its amount is not rewritten.
    const successor = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: generic.body.productVersion,
      costPolicy: { operation: "set_manual", amount: "4.123456", currency: "AED", unit: "each", taxBasis: "net", effectiveFrom: "2026-11-10" },
    });
    expect(successor.status).toBe(200);

    const backdated = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: successor.body.productVersion,
      costPolicy: { operation: "set_manual", amount: "1", currency: "AED", effectiveFrom: "2026-10-01" },
    });
    expect(backdated.status).toBe(400);
    expect(backdated.body.field).toBe("costPolicy.effectiveFrom");

    const recipe = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: successor.body.productVersion,
      costPolicy: { operation: "change_to_recipe_derived", effectiveFrom: "2026-11-20" },
    });
    expect(recipe.status).toBe(200);
    reloaded = (await variantsOf(tenantId, product.publicId)).variants[0]!;
    expect(reloaded.referenceCost.policy).toMatchObject({ method: "recipe_derived", amountMicros: null, revision: 3 });
    expect(reloaded.referenceCost.resolution).toMatchObject({
      status: "recipe_derived_reference",
      amount: "unavailable",
      reason: "recipe_engine_not_available",
    });
    expect(reloaded.referenceMargin).toEqual({ status: "unavailable", reason: "recipe_derived_cost_not_computed" });

    let history = await variantPolicyHistory(variant.id);
    expect(history.map((row) => [row.revision, row.method, row.amountMicros, row.effectiveFrom, row.effectiveTo])).toEqual([
      [1, "manual", BigInt(0), "2026-11-01", "2026-11-10"],
      [2, "manual", BigInt(4_123_456), "2026-11-10", "2026-11-20"],
      [3, "recipe_derived", null, "2026-11-20", null],
    ]);

    expect(await exportRow(tenantId, admin, "Variants", variantPublicId)).toMatchObject({
      cost_method: "recipe_derived",
      reference_cost_amount: "",
      cost_currency: "",
      cost_effective_date: "2026-11-20",
    });

    const cleared = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: recipe.body.productVersion,
      costPolicy: { operation: "clear" },
    });
    expect(cleared.status).toBe(200);
    reloaded = (await variantsOf(tenantId, product.publicId)).variants[0]!;
    expect(reloaded.referenceCost).toEqual({ policy: null, resolution: { status: "unavailable", reason: "no_policy" } });
    expect(reloaded.referenceMargin).toEqual({ status: "unavailable", reason: "cost_unavailable" });
    history = await variantPolicyHistory(variant.id);
    expect(history).toHaveLength(3);
    expect(history.every((row) => row.effectiveTo != null)).toBe(true);
    expect(history[1]!.amountMicros).toBe(BigInt(4_123_456));
    expect(await exportRow(tenantId, admin, "Variants", variantPublicId)).toMatchObject({
      cost_method: "",
      reference_cost_amount: "",
    });

    const policyAudits = await db
      .select({ action: tenantAuditEvents.action })
      .from(tenantAuditEvents)
      .where(and(eq(tenantAuditEvents.tenantId, tenantId), eq(tenantAuditEvents.entityPublicId, variantPublicId)))
      .orderBy(asc(tenantAuditEvents.occurredAt));
    expect(policyAudits.map((row) => row.action).filter((action) => action.startsWith("catalogue.reference_cost_policy"))).toEqual([
      "catalogue.reference_cost_policy.set_manual",
      "catalogue.reference_cost_policy.set_manual",
      "catalogue.reference_cost_policy.change_to_recipe_derived",
      "catalogue.reference_cost_policy.clear",
    ]);
  });

  it("creates a variant with tax and a manual cost in one request", async () => {
    const { tenantId, product } = await seed();
    // A second choice needs labels on every active variant.
    const labelled = await patchVariantAs(ADMIN, tenantId, product.publicId, product.defaultVariant.publicId, {
      expectedProductVersion: product.version,
      translations: { en: { displayName: "Regular" }, ar: { displayName: "عادي" } },
    });
    expect(labelled.status).toBe(200);
    as(ADMIN);
    const response = await postVariant(
      new Request("http://localhost/variants", {
        method: "POST",
        body: JSON.stringify({
          expectedProductVersion: labelled.body.productVersion,
          publicId: "var_qos215_large",
          translations: { en: { displayName: "Large" }, ar: { displayName: "كبير" } },
          amountMinor: 2200,
          priceTaxBasis: "inclusive",
          taxRateBasisPoints: 500,
          costPolicy: { operation: "set_manual", amountMicros: "1250000", currency: "AED", unit: "each", taxBasis: "net", effectiveFrom: "2026-11-22" },
        }),
      }),
      { params: Promise.resolve({ tenantId, productPublicId: product.publicId }) },
    );
    expect(response.status).toBe(200);
    const created = ((await response.json()) as ProductVariantsEditorView).variants.find((row) => row.publicId === "var_qos215_large")!;
    expect(created).toMatchObject({
      priceTaxBasis: "inclusive",
      taxRateBasisPoints: 500,
      referenceCost: { policy: { method: "manual", amountMicros: "1250000", amountMajor: "1.25" } },
      // 22.00 gross at 5% → 20.952380952… net, rounded once half-up to 20_952_381 micros.
      referenceMargin: { status: "available", basis: "net", priceMicros: "20952381", marginMicros: "19702381", rounding: "half_up_micros" },
    });
  });

  it("keeps a manual modifier-option override through save, reload and export, then switches to recipe-derived", async () => {
    const { tenantId, group, admin } = await seed();
    as(ADMIN);
    const createResponse = await postOption(
      new Request("http://localhost/options", {
        method: "POST",
        body: JSON.stringify({
          expectedGroupVersion: group.version,
          publicId: "modopt_qos215_oat",
          priceMinor: 300,
          translations: { en: { displayName: "Oat" }, ar: { displayName: "شوفان" } },
          costPolicy: { operation: "set_manual", amount: "0", currency: "AED", unit: "each", taxBasis: "gross", effectiveFrom: "2026-11-01" },
        }),
      }),
      { params: Promise.resolve({ tenantId, groupPublicId: group.publicId }) },
    );
    expect(createResponse.status).toBe(200);
    let view = ((await createResponse.json()) as { group: ModifierGroupEditorView }).group;
    expect(view.options[0]!.referenceCost.policy).toMatchObject({ method: "manual", amountMicros: "0", taxBasis: "gross" });

    // Generic option update without costPolicy keeps the override.
    const generic = await patchOption(
      new Request("http://localhost/option", {
        method: "PATCH",
        body: JSON.stringify({ expectedGroupVersion: view.version, priceMinor: 350 }),
      }),
      { params: Promise.resolve({ tenantId, groupPublicId: group.publicId, optionPublicId: "modopt_qos215_oat" }) },
    );
    expect(generic.status).toBe(200);
    as(ADMIN);
    const reloadResponse = await getGroup(new Request("http://localhost/group"), {
      params: Promise.resolve({ tenantId, groupPublicId: group.publicId }),
    });
    view = ((await reloadResponse.json()) as { group: ModifierGroupEditorView }).group;
    expect(view.options[0]).toMatchObject({ priceMinor: 350, referenceCost: { policy: { amountMicros: "0", revision: 1 } } });

    expect(await exportRow(tenantId, admin, "Modifier Options", "modopt_qos215_oat")).toMatchObject({
      cost_method: "manual",
      reference_cost_amount: "0",
      cost_currency: "AED",
      cost_tax_basis: "GROSS",
      cost_effective_date: "2026-11-01",
    });

    // A stale group version is a conflict and writes nothing.
    const stale = await patchOption(
      new Request("http://localhost/option", {
        method: "PATCH",
        body: JSON.stringify({ expectedGroupVersion: group.version, costPolicy: { operation: "clear" } }),
      }),
      { params: Promise.resolve({ tenantId, groupPublicId: group.publicId, optionPublicId: "modopt_qos215_oat" }) },
    );
    expect(stale.status).toBe(409);

    const recipe = await patchOption(
      new Request("http://localhost/option", {
        method: "PATCH",
        body: JSON.stringify({ expectedGroupVersion: view.version, costPolicy: { operation: "change_to_recipe_derived", effectiveFrom: "2026-11-15" } }),
      }),
      { params: Promise.resolve({ tenantId, groupPublicId: group.publicId, optionPublicId: "modopt_qos215_oat" }) },
    );
    expect(recipe.status).toBe(200);
    const history = await db
      .select()
      .from(catalogueModifierOptionReferenceCostPolicies)
      .orderBy(asc(catalogueModifierOptionReferenceCostPolicies.revision));
    expect(history.map((row) => [row.method, row.amountMicros, row.effectiveTo])).toEqual([
      ["manual", BigInt(0), "2026-11-15"],
      ["recipe_derived", null, null],
    ]);
    expect(await exportRow(tenantId, admin, "Modifier Options", "modopt_qos215_oat")).toMatchObject({
      cost_method: "recipe_derived",
      reference_cost_amount: "",
    });
  });

  it("returns 409 for a stale product version and leaves tax and cost untouched", async () => {
    const { tenantId, product } = await seed();
    const variantPublicId = product.defaultVariant.publicId;
    const first = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: product.version,
      priceTaxBasis: "inclusive",
    });
    expect(first.status).toBe(200);

    const stale = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
      expectedProductVersion: product.version,
      priceTaxBasis: "exclusive",
      costPolicy: { operation: "set_manual", amount: "1", currency: "AED", effectiveFrom: "2026-11-22" },
    });
    expect(stale.status).toBe(409);
    const row = await variantRow(tenantId, variantPublicId);
    expect(row.priceTaxBasis).toBe("inclusive");
    expect(await variantPolicyHistory(row.id)).toHaveLength(0);
  });

  it("returns 403 for a non-member and for a user changing tax or cost, and 404 for another tenant's record", async () => {
    const { tenantId, flowersTenantId, product, group } = await seed();
    const variantPublicId = product.defaultVariant.publicId;
    const body = {
      expectedProductVersion: product.version,
      priceTaxBasis: "inclusive",
      costPolicy: { operation: "set_manual", amount: "1", currency: "AED", effectiveFrom: "2026-11-22" },
    };

    expect((await patchVariantAs(OUTSIDER, tenantId, product.publicId, variantPublicId, body)).status).toBe(403);
    expect((await patchVariantAs(USER, tenantId, product.publicId, variantPublicId, body)).status).toBe(403);
    // Another tenant's admin addressing this record through their own tenant sees nothing.
    expect((await patchVariantAs(FLOWERS_ADMIN, flowersTenantId, product.publicId, variantPublicId, body)).status).toBe(404);
    // ...and cannot reach it through this tenant's path either.
    expect((await patchVariantAs(FLOWERS_ADMIN, tenantId, product.publicId, variantPublicId, body)).status).toBe(403);

    as(FLOWERS_ADMIN);
    const optionResponse = await postOption(
      new Request("http://localhost/options", {
        method: "POST",
        body: JSON.stringify({
          expectedGroupVersion: group.version,
          translations: { en: { displayName: "Oat" }, ar: { displayName: "شوفان" } },
          costPolicy: { operation: "set_manual", amount: "1", currency: "AED", effectiveFrom: "2026-11-22" },
        }),
      }),
      { params: Promise.resolve({ tenantId: flowersTenantId, groupPublicId: group.publicId }) },
    );
    expect(optionResponse.status).toBe(404);

    const row = await variantRow(tenantId, variantPublicId);
    expect(row).toMatchObject({ priceTaxBasis: null, taxRateBasisPoints: null, taxProvenance: null });
    expect(await variantPolicyHistory(row.id)).toHaveLength(0);
    expect(await db.select().from(catalogueModifierOptionReferenceCostPolicies)).toHaveLength(0);
  });

  it("rejects incomplete or over-precise cost requests without writing", async () => {
    const { tenantId, product } = await seed();
    const variantPublicId = product.defaultVariant.publicId;
    for (const costPolicy of [
      {},
      { operation: "set_manual", amount: "1.2345678", currency: "AED", effectiveFrom: "2026-11-22" },
      { operation: "set_manual", amount: "", currency: "AED", effectiveFrom: "2026-11-22" },
      { operation: "set_manual", amount: "1", effectiveFrom: "2026-11-22" },
      { operation: "change_to_recipe_derived", amount: "1" },
    ]) {
      const response = await patchVariantAs(ADMIN, tenantId, product.publicId, variantPublicId, {
        expectedProductVersion: product.version,
        costPolicy,
      });
      expect(response.status, JSON.stringify(costPolicy)).toBe(400);
    }
    const row = await variantRow(tenantId, variantPublicId);
    expect(await variantPolicyHistory(row.id)).toHaveLength(0);
  });
});
