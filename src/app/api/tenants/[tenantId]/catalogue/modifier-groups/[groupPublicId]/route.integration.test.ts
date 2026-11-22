import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import {
  attachModifierGroupToProduct,
  createModifierGroup,
  createModifierOption,
} from "@/lib/catalogue/modifiers";
import { createDraftProduct } from "@/lib/catalogue/products";
import { StaffAuthError } from "@/lib/staff/session";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { DELETE as deleteGroup, GET as getGroup } from "./route";

const staffMocks = vi.hoisted(() => ({ requireStaffIdentity: vi.fn() }));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return { ...actual, requireStaffIdentity: staffMocks.requireStaffIdentity };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const QUOTES_USER = "user.modgrp-delete.quotes@test";
const FLOWER_ADMIN = "admin.modgrp-delete.flower@test";

integrationDescribe("DELETE modifier group route", () => {
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
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.catalogue_product_modifier_groups, qos.catalogue_modifier_option_translations, qos.catalogue_modifier_options, qos.catalogue_modifier_group_translations, qos.catalogue_modifier_groups, qos.catalogue_variant_prices, qos.catalogue_variants, qos.catalogue_product_translations, qos.catalogue_products, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
  });

  function signIn(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }

  async function seedMember(tenantId: string, subject: string, role: "administrator" | "user") {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: subject, email: subject })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity.id, role })
      .returning();
    return { membershipId: membership.id, role, staffIdentityId: identity.id };
  }

  async function seed() {
    const quotes = await createTenantHierarchy(db, quotesTenantFixture());
    const user = await seedMember(quotes.tenant.id, QUOTES_USER, "user");
    const admin = await seedMember(quotes.tenant.id, "admin.modgrp-delete.quotes@test", "administrator");
    const group = await createModifierGroup(
      db,
      quotes.tenant.id,
      {
        internalName: "extras",
        publicId: "modgrp_extras",
        translations: { en: { displayName: "Extras" }, ar: { displayName: "إضافات" } },
      },
      QUOTES_USER,
      user,
    );
    const withOption = await createModifierOption(
      db,
      quotes.tenant.id,
      group.publicId,
      {
        expectedGroupVersion: group.version,
        publicId: "modopt_cheese",
        translations: { en: { displayName: "Cheese" }, ar: { displayName: "جبن" } },
        priceMinor: 200,
      },
      "admin.modgrp-delete.quotes@test",
      admin,
    );
    return { quotes, user, admin, group: withOption };
  }

  const params = (tenantId: string, groupPublicId: string) => ({
    params: Promise.resolve({ tenantId, groupPublicId }),
  });

  const deleteRequest = (body: string) =>
    new Request("http://localhost/modifier-group", { method: "DELETE", body });

  it("lets an active non-administrator member delete an unassigned group", async () => {
    const { quotes, group } = await seed();
    signIn(QUOTES_USER);

    const response = await deleteGroup(
      deleteRequest(JSON.stringify({ expectedVersion: group.version })),
      params(quotes.tenant.id, group.publicId),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      deleted: {
        publicId: "modgrp_extras",
        version: group.version,
        optionPublicIds: ["modopt_cheese"],
      },
    });

    const reread = await getGroup(
      new Request("http://localhost/modifier-group"),
      params(quotes.tenant.id, group.publicId),
    );
    expect(reread.status).toBe(404);
  });

  it("answers 409 modifier_group_assigned while a product uses the group", async () => {
    const { quotes, admin, group } = await seed();
    const product = await createDraftProduct(db, quotes.tenant.id, admin, {
      internalName: "burger",
      translations: {
        en: { displayName: "Burger", description: null },
        ar: { displayName: "برغر", description: null },
      },
      defaultVariant: { amountMinor: 3000, currency: "AED" },
    });
    await attachModifierGroupToProduct(
      db,
      quotes.tenant.id,
      product.publicId,
      { expectedProductVersion: product.version, modifierGroupPublicId: group.publicId },
      "admin.modgrp-delete.quotes@test",
      admin,
    );
    signIn(QUOTES_USER);

    const response = await deleteGroup(
      deleteRequest(JSON.stringify({ expectedVersion: group.version })),
      params(quotes.tenant.id, group.publicId),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      field: "affectedProductCount",
      code: "modifier_group_assigned",
    });
  });

  it("answers 400 for a missing expectedVersion or a body that is not JSON", async () => {
    const { quotes, group } = await seed();
    signIn(QUOTES_USER);

    const missing = await deleteGroup(deleteRequest("{}"), params(quotes.tenant.id, group.publicId));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toMatchObject({ field: "expectedVersion" });

    const notJson = await deleteGroup(deleteRequest("not json"), params(quotes.tenant.id, group.publicId));
    expect(notJson.status).toBe(400);

    const stillThere = await getGroup(
      new Request("http://localhost/modifier-group"),
      params(quotes.tenant.id, group.publicId),
    );
    expect(stillThere.status).toBe(200);
  });

  it("answers 401 without a staff session and 403 to a member of another tenant", async () => {
    const { quotes, group } = await seed();
    const flower = await createTenantHierarchy(db, flowerTenantFixture());
    await seedMember(flower.tenant.id, FLOWER_ADMIN, "administrator");
    const body = JSON.stringify({ expectedVersion: group.version });

    staffMocks.requireStaffIdentity.mockRejectedValue(new StaffAuthError("Staff sign-in is required.", 401));
    const anonymous = await deleteGroup(deleteRequest(body), params(quotes.tenant.id, group.publicId));
    expect(anonymous.status).toBe(401);

    signIn(FLOWER_ADMIN);
    const foreign = await deleteGroup(deleteRequest(body), params(quotes.tenant.id, group.publicId));
    expect(foreign.status).toBe(403);

    signIn(QUOTES_USER);
    const stillThere = await getGroup(
      new Request("http://localhost/modifier-group"),
      params(quotes.tenant.id, group.publicId),
    );
    expect(stillThere.status).toBe(200);
  });
});
