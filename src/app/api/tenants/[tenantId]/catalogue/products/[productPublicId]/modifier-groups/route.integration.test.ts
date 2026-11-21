import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  catalogueMenuLiveRevisions,
  catalogueModifierGroups,
  catalogueProductModifierGroups,
  staffIdentities,
  staffMemberships,
  tenantAuditEvents,
} from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { loadMenuFacts } from "@/lib/catalogue/menu-facts";
import { publishDraftMenuToLocations } from "@/lib/catalogue/menu-publish";
import { createDraftMenu } from "@/lib/catalogue/menus";
import { validateModifierGroupSelections } from "@/lib/catalogue/modifier-selection";
import {
  createModifierGroup,
  createModifierOption,
  selectionRulesForAssignment,
  updateModifierGroup,
  updateModifierOption,
  type ProductModifierGroupsView,
} from "@/lib/catalogue/modifiers";
import { createDraftProduct } from "@/lib/catalogue/products";
import { approveProductTranslation } from "@/lib/catalogue/translation-approval";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import { StaffAuthError } from "@/lib/staff/session";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";
import { withTenantContext } from "@/lib/tenant/context";

import { PATCH as patchAssignment } from "./[groupPublicId]/route";
import { GET as getAssignments, POST as attachGroup } from "./route";

const staffMocks = vi.hoisted(() => ({ requireStaffIdentity: vi.fn() }));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return { ...actual, requireStaffIdentity: staffMocks.requireStaffIdentity };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const QUOTES_ADMIN = "admin.qos212.quotes@test";
const FLOWER_ADMIN = "admin.qos212.flower@test";

integrationDescribe("product modifier assignment policy routes (QOS-212)", () => {
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
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_menu_publish_operations, qos.catalogue_menu_live_revisions, qos.catalogue_menu_section_products, qos.catalogue_menu_section_translations, qos.catalogue_menu_sections, qos.catalogue_menu_locations, qos.catalogue_menu_translations, qos.catalogue_menus, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  function signIn(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }

  async function seedAdmin(tenantId: string, subject: string) {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role: "administrator" })
      .returning();
    return { membershipId: membership.id, role: "administrator" as const, staffIdentityId: identity.id };
  }

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const admin = await seedAdmin(quotes.tenant.id, QUOTES_ADMIN);

    const product = (internalName: string, en: string, ar: string) =>
      createDraftProduct(db, quotes.tenant.id, admin, {
        internalName,
        translations: {
          en: { displayName: en, description: null },
          ar: { displayName: ar, description: null },
        },
        defaultVariant: { amountMinor: 3000, currency: "AED" },
      });
    const burger = await product("burger", "Burger", "برغر");
    const fries = await product("fries", "Fries", "بطاطس");
    const salad = await product("salad", "Salad", "سلطة");

    let extras = await createModifierGroup(
      db,
      quotes.tenant.id,
      {
        internalName: "extras",
        publicId: "modgrp_extras",
        minSelections: 0,
        maxSelections: 2,
        translations: { en: { displayName: "Extras" }, ar: { displayName: "إضافات" } },
      },
      QUOTES_ADMIN,
      admin,
    );
    for (const option of [
      { publicId: "modopt_cheese", en: "Cheese", ar: "جبن", allowsQuantity: true, maxQuantity: 3, priceMinor: 200 },
      { publicId: "modopt_sauce", en: "Sauce", ar: "صلصة", allowsQuantity: false, maxQuantity: 1, priceMinor: 150 },
    ]) {
      extras = await createModifierOption(
        db,
        quotes.tenant.id,
        extras.publicId,
        {
          expectedGroupVersion: extras.version,
          publicId: option.publicId,
          allowsQuantity: option.allowsQuantity,
          maxQuantity: option.maxQuantity,
          priceMinor: option.priceMinor,
          translations: { en: { displayName: option.en }, ar: { displayName: option.ar } },
        },
        QUOTES_ADMIN,
        admin,
      );
    }

    return { quotes, admin, burger, fries, salad, extras };
  }

  const params = (tenantId: string, productPublicId: string, groupPublicId?: string) => ({
    params: Promise.resolve({ tenantId, productPublicId, groupPublicId: groupPublicId ?? "" }),
  });

  async function attach(tenantId: string, productPublicId: string, productVersion: number) {
    const response = await attachGroup(
      new Request("http://localhost/attach", {
        method: "POST",
        body: JSON.stringify({ expectedProductVersion: productVersion, modifierGroupPublicId: "modgrp_extras" }),
      }),
      params(tenantId, productPublicId),
    );
    expect(response.status).toBe(200);
    return (await response.json()) as ProductModifierGroupsView;
  }

  async function patch(tenantId: string, productPublicId: string, body: Record<string, unknown>) {
    return patchAssignment(
      new Request("http://localhost/policy", { method: "PATCH", body: JSON.stringify(body) }),
      params(tenantId, productPublicId, "modgrp_extras"),
    );
  }

  async function reload(tenantId: string, productPublicId: string) {
    const response = await getAssignments(new Request("http://localhost/list"), params(tenantId, productPublicId));
    expect(response.status).toBe(200);
    return (await response.json()) as ProductModifierGroupsView;
  }

  it("keeps one shared group while two products save and reload different policies", async () => {
    const { quotes, burger, fries } = await seed();
    signIn(QUOTES_ADMIN);
    const tenantId = quotes.tenant.id;

    const burgerAttached = await attach(tenantId, burger.publicId, burger.version);
    const friesAttached = await attach(tenantId, fries.publicId, fries.version);
    const burgerAssignment = burgerAttached.modifierGroups[0]!;
    expect(burgerAssignment).toMatchObject({
      assignmentVersion: 1,
      groupMinSelections: 0,
      groupMaxSelections: 2,
      overrides: { minSelections: null, maxSelections: null, repeatAllowed: null, selectionCountMode: null },
      effectivePolicy: { effectiveMinSelections: 0, effectiveMaxSelections: 2, selectionCountMode: "distinct_options" },
    });

    const burgerResponse = await patch(tenantId, burger.publicId, {
      expectedProductVersion: burgerAttached.productVersion,
      expectedAssignmentVersion: burgerAssignment.assignmentVersion,
      minSelections: 1,
      maxSelections: 1,
      repeatAllowed: false,
    });
    expect(burgerResponse.status).toBe(200);
    const friesResponse = await patch(tenantId, fries.publicId, {
      expectedProductVersion: friesAttached.productVersion,
      expectedAssignmentVersion: friesAttached.modifierGroups[0]!.assignmentVersion,
      maxSelections: 3,
      repeatAllowed: true,
    });
    expect(friesResponse.status).toBe(200);

    const burgerView = await reload(tenantId, burger.publicId);
    const friesView = await reload(tenantId, fries.publicId);
    const burgerGroup = burgerView.modifierGroups[0]!;
    const friesGroup = friesView.modifierGroups[0]!;

    expect(burgerView.productVersion).toBe(burgerAttached.productVersion + 1);
    expect(burgerGroup).toMatchObject({
      assignmentId: burgerAssignment.assignmentId,
      assignmentVersion: 2,
      overrides: { minSelections: 1, maxSelections: 1, repeatAllowed: false, selectionCountMode: null },
      effectivePolicy: {
        effectiveMinSelections: 1,
        effectiveMaxSelections: 1,
        minSelectionsSource: "overridden",
        repeatSource: "overridden",
      },
    });
    expect(burgerGroup.effectivePolicy.options.map((option) => [option.publicId, option.effectiveMaxQuantity])).toEqual([
      ["modopt_cheese", 1],
      ["modopt_sauce", 1],
    ]);
    expect(friesGroup).toMatchObject({
      assignmentVersion: 2,
      overrides: { minSelections: null, maxSelections: 3, repeatAllowed: true, selectionCountMode: null },
      effectivePolicy: { effectiveMinSelections: 0, effectiveMaxSelections: 3, minSelectionsSource: "inherited" },
    });
    // Repeat allowed never raises the shared caps.
    expect(friesGroup.effectivePolicy.options.map((option) => [option.publicId, option.effectiveMaxQuantity])).toEqual([
      ["modopt_cheese", 3],
      ["modopt_sauce", 1],
    ]);

    // One group row, two links pointing at it, and the group itself unchanged.
    const groups = await db.select().from(catalogueModifierGroups).where(eq(catalogueModifierGroups.tenantId, tenantId));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ minSelections: 0, maxSelections: 2 });
    const links = await db
      .select()
      .from(catalogueProductModifierGroups)
      .where(eq(catalogueProductModifierGroups.tenantId, tenantId));
    expect(links).toHaveLength(2);
    expect(new Set(links.map((link) => link.modifierGroupId))).toEqual(new Set([groups[0]!.id]));

    // Selection on each product uses its own effective policy.
    const cheeseTwice = [{ optionPublicId: "modopt_cheese", quantity: 2 }];
    expect(() => validateModifierGroupSelections(selectionRulesForAssignment(burgerGroup), cheeseTwice)).toThrow(
      CatalogueValidationError,
    );
    const friesResult = validateModifierGroupSelections(selectionRulesForAssignment(friesGroup), [
      ...cheeseTwice,
      { optionPublicId: "modopt_sauce", quantity: 1 },
    ]);
    expect(friesResult.selections.map((selection) => selection.quantity)).toEqual([2, 1]);
    expect(friesResult.totalPriceMinor).toBe(2 * 200 + 150);

    const audits = await db
      .select()
      .from(tenantAuditEvents)
      .where(eq(tenantAuditEvents.action, "catalogue.modifier_group.assignment_update"));
    expect(audits).toHaveLength(2);
    expect(audits.find((event) => event.entityPublicId === burger.publicId)).toMatchObject({
      entityVersion: 2,
      changeSummary: {
        modifierGroupPublicId: "modgrp_extras",
        before: { minSelections: null, maxSelections: null, repeatAllowed: null, selectionCountMode: null },
        after: { minSelections: 1, maxSelections: 1, repeatAllowed: false, selectionCountMode: null },
      },
    });

    // Reset to default: explicit nulls clear the overrides.
    const resetResponse = await patch(tenantId, burger.publicId, {
      expectedProductVersion: burgerView.productVersion,
      expectedAssignmentVersion: 2,
      minSelections: null,
      maxSelections: null,
      repeatAllowed: null,
      selectionCountMode: null,
    });
    expect(resetResponse.status).toBe(200);
    const reset = ((await resetResponse.json()) as ProductModifierGroupsView).modifierGroups[0]!;
    expect(reset).toMatchObject({
      assignmentVersion: 3,
      overrides: { minSelections: null, maxSelections: null, repeatAllowed: null, selectionCountMode: null },
      effectivePolicy: { effectiveMinSelections: 0, effectiveMaxSelections: 2, repeatSource: "inherited" },
    });
  });

  it("fails stale assignment or product versions without writing", async () => {
    const { quotes, burger, fries } = await seed();
    signIn(QUOTES_ADMIN);
    const tenantId = quotes.tenant.id;
    const attached = await attach(tenantId, burger.publicId, burger.version);
    await attach(tenantId, fries.publicId, fries.version);

    const first = await patch(tenantId, burger.publicId, {
      expectedProductVersion: attached.productVersion,
      expectedAssignmentVersion: 1,
      maxSelections: 1,
    });
    expect(first.status).toBe(200);
    const afterFirst = (await first.json()) as ProductModifierGroupsView;

    const staleAssignment = await patch(tenantId, burger.publicId, {
      expectedProductVersion: afterFirst.productVersion,
      expectedAssignmentVersion: 1,
      maxSelections: 2,
    });
    expect(staleAssignment.status).toBe(409);
    expect(await staleAssignment.json()).toMatchObject({ field: "expectedAssignmentVersion" });

    const staleProduct = await patch(tenantId, burger.publicId, {
      expectedProductVersion: attached.productVersion,
      expectedAssignmentVersion: 2,
      maxSelections: 2,
    });
    expect(staleProduct.status).toBe(409);
    expect(await staleProduct.json()).toMatchObject({ field: "expectedProductVersion" });

    const missingVersion = await patch(tenantId, burger.publicId, {
      expectedProductVersion: afterFirst.productVersion,
      maxSelections: 2,
    });
    expect(missingVersion.status).toBe(400);

    const view = await reload(tenantId, burger.publicId);
    expect(view.productVersion).toBe(afterFirst.productVersion);
    expect(view.modifierGroups[0]).toMatchObject({ assignmentVersion: 2, overrides: { maxSelections: 1 } });
  });

  it("refuses invalid policies with reviewed-correction codes", async () => {
    const { quotes, admin, burger } = await seed();
    signIn(QUOTES_ADMIN);
    const tenantId = quotes.tenant.id;
    const attached = await attach(tenantId, burger.publicId, burger.version);
    const base = { expectedProductVersion: attached.productVersion, expectedAssignmentVersion: 1 };

    const inverted = await patch(tenantId, burger.publicId, { ...base, minSelections: 2, maxSelections: 1 });
    expect(inverted.status).toBe(400);
    expect(await inverted.json()).toMatchObject({ code: "modifier_assignment_invalid_bounds" });

    const unknownMode = await patch(tenantId, burger.publicId, { ...base, selectionCountMode: "foodics" });
    expect(unknownMode.status).toBe(400);
    expect(await unknownMode.json()).toMatchObject({ field: "selectionCountMode" });

    const infeasible = await patch(tenantId, burger.publicId, { ...base, minSelections: 3, maxSelections: 3 });
    expect(infeasible.status).toBe(400);
    expect(await infeasible.json()).toMatchObject({ code: "modifier_assignment_infeasible" });

    // Make cheese non-repeatable on the shared group: no active option can repeat now.
    const group = await db
      .select({ version: catalogueModifierGroups.version })
      .from(catalogueModifierGroups)
      .where(eq(catalogueModifierGroups.tenantId, tenantId));
    await updateModifierOption(
      db,
      tenantId,
      "modgrp_extras",
      "modopt_cheese",
      { expectedGroupVersion: group[0]!.version, allowsQuantity: false },
      QUOTES_ADMIN,
      admin,
    );
    const repeatConflict = await patch(tenantId, burger.publicId, { ...base, repeatAllowed: true });
    expect(repeatConflict.status).toBe(400);
    expect(await repeatConflict.json()).toMatchObject({ code: "modifier_assignment_repeat_conflict", field: "repeatAllowed" });

    const view = await reload(tenantId, burger.publicId);
    expect(view.modifierGroups[0]).toMatchObject({
      assignmentVersion: 1,
      overrides: { minSelections: null, maxSelections: null, repeatAllowed: null, selectionCountMode: null },
    });
  });

  it("blocks a shared-group change that would break a product's override", async () => {
    const { quotes, admin, burger } = await seed();
    signIn(QUOTES_ADMIN);
    const tenantId = quotes.tenant.id;
    const attached = await attach(tenantId, burger.publicId, burger.version);
    expect(
      (
        await patch(tenantId, burger.publicId, {
          expectedProductVersion: attached.productVersion,
          expectedAssignmentVersion: 1,
          maxSelections: 1,
        })
      ).status,
    ).toBe(200);

    const [group] = await db
      .select({ version: catalogueModifierGroups.version })
      .from(catalogueModifierGroups)
      .where(eq(catalogueModifierGroups.tenantId, tenantId));
    await expect(
      updateModifierGroup(
        db,
        tenantId,
        "modgrp_extras",
        { expectedVersion: group!.version, minSelections: 2, maxSelections: 2 },
        QUOTES_ADMIN,
        admin,
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: "modifier_assignment_invalid_bounds" });
  });

  it("does not let another tenant read or mutate the assignment", async () => {
    const { quotes, burger } = await seed();
    signIn(QUOTES_ADMIN);
    const attached = await attach(quotes.tenant.id, burger.publicId, burger.version);

    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    await seedAdmin(flowers.tenant.id, FLOWER_ADMIN);
    signIn(FLOWER_ADMIN);

    const body = { expectedProductVersion: attached.productVersion, expectedAssignmentVersion: 1, maxSelections: 1 };

    // Through their own tenant: the product and group do not exist there.
    const crossTenant = await patch(flowers.tenant.id, burger.publicId, body);
    expect(crossTenant.status).toBe(404);
    // Through the victim tenant path: no membership (shared staff auth helper).
    const foreignPath = await patch(quotes.tenant.id, burger.publicId, body);
    expect(foreignPath.status).toBe(403);
    const foreignRead = await getAssignments(new Request("http://localhost/list"), params(quotes.tenant.id, burger.publicId));
    expect(foreignRead.status).toBe(403);

    staffMocks.requireStaffIdentity.mockRejectedValue(new StaffAuthError("Staff sign-in is required.", 401));
    const anonymous = await patch(quotes.tenant.id, burger.publicId, body);
    expect(anonymous.status).toBe(401);

    signIn(QUOTES_ADMIN);
    const view = await reload(quotes.tenant.id, burger.publicId);
    expect(view.modifierGroups[0]).toMatchObject({ assignmentVersion: 1, overrides: { maxSelections: null } });
  });

  it("returns 404 when the group is not attached to the product", async () => {
    const { quotes, burger } = await seed();
    signIn(QUOTES_ADMIN);
    const response = await patch(quotes.tenant.id, burger.publicId, {
      expectedProductVersion: burger.version,
      expectedAssignmentVersion: 1,
      maxSelections: 1,
    });
    expect(response.status).toBe(404);
  });

  it("feeds effective bounds to menu facts and keeps published payloads untouched", async () => {
    const { quotes, admin, burger, fries, salad } = await seed();
    signIn(QUOTES_ADMIN);
    const tenantId = quotes.tenant.id;
    const burgerAttached = await attach(tenantId, burger.publicId, burger.version);
    await attach(tenantId, fries.publicId, fries.version);
    await attach(tenantId, salad.publicId, salad.version);

    for (const product of [burger, fries, salad]) {
      for (const locale of ["en", "ar"] as const) {
        await approveProductTranslation(db, tenantId, QUOTES_ADMIN, product.publicId, locale, {
          expectedTranslationVersion: product.translations[locale].translationVersion,
        });
      }
    }
    const menu = await createDraftMenu(db, tenantId, admin, {
      internalName: "lunch",
      locationIds: [quotes.location.id],
      translations: { en: { displayName: "Lunch" }, ar: { displayName: "غداء" } },
      sections: [
        {
          internalName: "mains",
          sortOrder: 0,
          translations: { en: { displayName: "Mains" }, ar: { displayName: "أطباق رئيسية" } },
          products: [
            { productPublicId: burger.publicId, sortOrder: 0 },
            { productPublicId: fries.publicId, sortOrder: 1 },
            { productPublicId: salad.publicId, sortOrder: 2 },
          ],
        },
      ],
    });
    await publishDraftMenuToLocations(db, tenantId, QUOTES_ADMIN, menu.publicId, { locationIds: [quotes.location.id] });
    const liveBefore = await db.select().from(catalogueMenuLiveRevisions).where(eq(catalogueMenuLiveRevisions.tenantId, tenantId));
    expect(liveBefore.length).toBeGreaterThan(0);
    expect(JSON.stringify(liveBefore.map((row) => row.payload))).not.toContain("modgrp_extras");

    const burgerNow = await reload(tenantId, burger.publicId);
    expect(
      (
        await patch(tenantId, burger.publicId, {
          expectedProductVersion: burgerNow.productVersion,
          expectedAssignmentVersion: burgerAttached.modifierGroups[0]!.assignmentVersion,
          minSelections: 1,
          maxSelections: 1,
          repeatAllowed: false,
          selectionCountMode: "total_quantity",
        })
      ).status,
    ).toBe(200);

    const facts = await runAsRole(sqlClient, "qos_app", () =>
      withTenantContext(db, tenantId, (tx) => loadMenuFacts(tx, tenantId, menu.publicId)),
    );
    const groupFor = (productPublicId: string) =>
      facts!.products.find((product) => product.productPublicId === productPublicId)!.modifierGroups[0]!;
    expect(groupFor(burger.publicId)).toMatchObject({
      publicId: "modgrp_extras",
      minSelections: 1,
      maxSelections: 1,
      selectionCountMode: "total_quantity",
    });
    expect(groupFor(burger.publicId).options.every((option) => option.maxQuantity === 1 && !option.allowsQuantity)).toBe(true);
    // The untouched product keeps the group's own rules and distinct counting.
    expect(groupFor(salad.publicId)).toMatchObject({ minSelections: 0, maxSelections: 2, selectionCountMode: "distinct_options" });
    expect(groupFor(salad.publicId).options.find((option) => option.publicId === "modopt_cheese")).toMatchObject({
      allowsQuantity: true,
      maxQuantity: 3,
    });

    const liveAfter = await db.select().from(catalogueMenuLiveRevisions).where(eq(catalogueMenuLiveRevisions.tenantId, tenantId));
    expect(liveAfter).toEqual(liveBefore);
  });
});
