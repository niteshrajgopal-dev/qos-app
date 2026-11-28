import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { listProductVariants, updateProductVariant } from "@/lib/catalogue/variants";
import { ACTOR, ADMIN, auditActions, truncateInventory } from "@/lib/inventory/integration-helpers";
import { seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { createSellableLink } from "@/lib/recipes/links";
import { createRecipe } from "@/lib/recipes/recipes";
import { StaffAuthError } from "@/lib/staff/session";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { POST } from "./route";
import { PATCH } from "../route";
import { GET } from "../../route";

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

const ADMIN_SUBJECT = "admin.variant-restore@test";
const USER_SUBJECT = "user.variant-restore@test";
const OTHER_ADMIN_SUBJECT = "admin.other-variant-restore@test";

integrationDescribe("POST /catalogue/products/[productPublicId]/variants/[variantPublicId]/restore (DB)", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sql: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tenantId: string;
  let otherTenantId: string;
  let fx: RecipeFixtures;
  let archivedVersion: number;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sql = connection.sql;
    await grantRoleMembership(sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function member(tenant: string, subject: string, role: "administrator" | "user") {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    await db.insert(staffMemberships).values({ tenantId: tenant, staffIdentityId: identity.id, role });
  }

  beforeEach(async () => {
    await truncateInventory(sql);
    staffMocks.requireStaffIdentity.mockReset();
    tenantId = (await createTenantHierarchy(db, quotesTenantFixture())).tenant.id;
    otherTenantId = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    await member(tenantId, ADMIN_SUBJECT, "administrator");
    await member(tenantId, USER_SUBJECT, "user");
    await member(otherTenantId, OTHER_ADMIN_SUBJECT, "administrator");
    fx = await seedRecipeFixtures(db, tenantId);
    const recipe = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable" });
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.large, kind: "recipe", recipePublicId: recipe.recipe.publicId });
    const view = await listProductVariants(db, tenantId, ADMIN, fx.latte.productPublicId);
    archivedVersion = (
      await updateProductVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.large, { expectedProductVersion: view.productVersion, status: "archived" }, ACTOR)
    ).productVersion;
  });

  function signIn(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }

  function post(body: unknown, params: { tenantId?: string; productPublicId?: string; variantPublicId?: string } = {}) {
    return POST(
      new Request("http://localhost/restore", { method: "POST", body: JSON.stringify(body) }),
      {
        params: Promise.resolve({
          tenantId: params.tenantId ?? tenantId,
          productPublicId: params.productPublicId ?? fx.latte.productPublicId,
          variantPublicId: params.variantPublicId ?? fx.latte.large,
        }),
      },
    );
  }

  async function largeStatus() {
    const view = await listProductVariants(db, tenantId, ADMIN, fx.latte.productPublicId);
    return view.variants.find((variant) => variant.publicId === fx.latte.large)!.status;
  }

  it("returns 401 without a staff session", async () => {
    staffMocks.requireStaffIdentity.mockRejectedValue(new StaffAuthError("Sign in required."));
    expect((await post({ expectedProductVersion: archivedVersion })).status).toBe(401);
    expect(await largeStatus()).toBe("archived");
  });

  it("returns 403 for staff users without administrator membership, and for an administrator of another tenant", async () => {
    signIn(USER_SUBJECT);
    expect((await post({ expectedProductVersion: archivedVersion })).status).toBe(403);
    signIn(OTHER_ADMIN_SUBJECT);
    expect((await post({ expectedProductVersion: archivedVersion })).status).toBe(403);
    expect(await largeStatus()).toBe("archived");
  });

  it("returns 404 for a missing variant and for a product that belongs to another tenant", async () => {
    signIn(ADMIN_SUBJECT);
    expect((await post({ expectedProductVersion: archivedVersion }, { variantPublicId: "var_missing" })).status).toBe(404);
    signIn(OTHER_ADMIN_SUBJECT);
    expect((await post({ expectedProductVersion: archivedVersion }, { tenantId: otherTenantId })).status).toBe(404);
    expect(await largeStatus()).toBe("archived");
  });

  it("returns 409 for a stale product version and for a variant that is not archived", async () => {
    signIn(ADMIN_SUBJECT);
    const stale = await post({ expectedProductVersion: archivedVersion - 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ field: "expectedProductVersion" });
    expect(await largeStatus()).toBe("archived");

    const active = await post({ expectedProductVersion: archivedVersion }, { variantPublicId: fx.latte.regular });
    expect(active.status).toBe(409);
    expect(await active.json()).toMatchObject({ code: "variant_not_archived" });
  });

  it("returns 400 when the product version is missing", async () => {
    signIn(ADMIN_SUBJECT);
    const response = await post({});
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ field: "expectedProductVersion" });
  });

  it("restores the variant for an administrator, keeps its link and records the restore", async () => {
    signIn(ADMIN_SUBJECT);
    const response = await post({ expectedProductVersion: archivedVersion });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Awaited<ReturnType<typeof listProductVariants>>;
    expect(body.productVersion).toBe(archivedVersion + 1);
    expect(body.variants.find((variant) => variant.publicId === fx.latte.large)).toMatchObject({
      status: "active",
      isDefault: false,
      sellableLinkKind: "recipe",
    });
    const [link] = await sql<{ effective_to: string | null; revision: number }[]>`
      SELECT l.effective_to::text, l.revision FROM qos.recipe_sellable_links l
      JOIN qos.catalogue_variants v ON v.id = l.variant_id WHERE v.public_id = ${fx.latte.large}`;
    expect(link).toEqual({ effective_to: null, revision: 1 });
    const restoreEvents = (await auditActions(sql, tenantId)).filter((event) => event.action === "catalogue.variant.restore");
    expect(restoreEvents).toEqual([expect.objectContaining({ entity_public_id: fx.latte.large })]);
  });

  it("refuses status active on the generic variant PATCH so restore stays on this route", async () => {
    signIn(ADMIN_SUBJECT);
    const response = await PATCH(
      new Request("http://localhost/variant", { method: "PATCH", body: JSON.stringify({ expectedProductVersion: archivedVersion, status: "active" }) }),
      { params: Promise.resolve({ tenantId, productPublicId: fx.latte.productPublicId, variantPublicId: fx.latte.large }) },
    );
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "variant_restore_required" });
    expect(await largeStatus()).toBe("archived");
  });

  it("keeps reads open to staff users, who see the archived variant and its link kind", async () => {
    signIn(USER_SUBJECT);
    const response = await GET(new Request("http://localhost/variants"), {
      params: Promise.resolve({ tenantId, productPublicId: fx.latte.productPublicId }),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Awaited<ReturnType<typeof listProductVariants>>;
    expect(body.canEditPrice).toBe(false);
    expect(body.variants.find((variant) => variant.publicId === fx.latte.large)).toMatchObject({ status: "archived", sellableLinkKind: "recipe" });
  });
});
