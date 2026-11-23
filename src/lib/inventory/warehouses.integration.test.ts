import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { staffIdentities, staffLocationScopes, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import {
  ACTOR,
  ADMIN,
  auditActions,
  type IntegrationConnection,
  rejection,
  truncateInventory,
  USER,
} from "@/lib/inventory/integration-helpers";
import { createWarehouse, getWarehouse, listWarehouses, updateWarehouse } from "@/lib/inventory/warehouses";
import type { ActiveStaffMembership } from "@/lib/staff/auth";
import { ALL_BRANCHES, REQUESTED_BUSINESS_BRANCH_LABELS } from "@/lib/staff/branch-selection";
import { createQuotesTwoLocationTenant } from "@/lib/tenant/fixtures-two-locations";
import { flowerTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

type Location = { id: string; publicId: string; name: string };

integrationDescribe("inventory warehouses service", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
  let locationA: Location;
  let locationB: Location;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sql = connection.sql;
    await grantRoleMembership(sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  beforeEach(async () => {
    await truncateInventory(sql);
    const quotes = await createQuotesTwoLocationTenant(db);
    tenantId = quotes.tenant.id;
    locationA = quotes.locationA;
    locationB = quotes.locationB;
  });

  async function locationRows() {
    return sql<Record<string, unknown>[]>`
      SELECT public_id, name, slug, status::text, timezone, brand_id::text, created_at::text, updated_at::text
      FROM qos.locations WHERE tenant_id = ${tenantId} ORDER BY public_id`;
  }

  async function scopedUser(locationIds: string[]): Promise<ActiveStaffMembership> {
    const [identity] = await db
      .insert(staffIdentities)
      .values({ providerSubject: "user.qos196@test", email: "user.qos196@test" })
      .returning();
    const [membership] = await db
      .insert(staffMemberships)
      .values({ tenantId, staffIdentityId: identity!.id, role: "user" })
      .returning();
    for (const locationId of locationIds) {
      await db.insert(staffLocationScopes).values({ tenantId, staffMembershipId: membership!.id, locationId });
    }
    return { membershipId: membership!.id, role: "user", staffIdentityId: identity!.id };
  }

  it("creates a warehouse at an active branch and reads every field back, without touching the location", async () => {
    const before = await locationRows();
    const created = await createWarehouse(db, tenantId, ADMIN, ACTOR, {
      locationPublicId: locationA.publicId,
      code: "HBZ-MAIN",
      nameEn: "HBZ main store",
      nameAr: "المخزن الرئيسي",
      notes: "Cold room on the left.",
    });
    expect(created.warehouse.publicId).toMatch(/^wh_hbz-main_[0-9a-f]{8}$/);
    expect(created.warehouse).toMatchObject({
      code: "HBZ-MAIN",
      nameEn: "HBZ main store",
      nameAr: "المخزن الرئيسي",
      notes: "Cold room on the left.",
      status: "active",
      version: 1,
      provenance: "operator_entered",
      branch: { publicId: locationA.publicId, name: locationA.name, status: "active", timezone: "Asia/Dubai" },
    });
    expect(created.dependencies).toEqual([]);
    expect(await getWarehouse(db, tenantId, ADMIN, created.warehouse.publicId)).toEqual(created);
    expect((await listWarehouses(db, tenantId, ADMIN)).warehouses).toEqual([created.warehouse]);
    // The warehouse name is its own value: the branch keeps its name, slug, status and timestamps.
    expect(await locationRows()).toEqual(before);
    const audit = await auditActions(sql, tenantId);
    expect(audit.map((row) => [row.action, row.entity_type, row.location_id])).toEqual([
      ["inventory.warehouse.create", "inventory_warehouse", locationA.id],
    ]);
    expect(audit[0]!.change_summary).toMatchObject({ after: { code: "HBZ-MAIN", branch: locationA.publicId } });
  });

  it("allows one active warehouse per branch and answers 409 for a second one", async () => {
    await createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationA.publicId, code: "A1", nameEn: "A store" });
    expect(
      await rejection(
        createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationA.publicId, code: "A2", nameEn: "A second store" }),
      ),
    ).toEqual({ statusCode: 409, code: "warehouse_branch_taken", field: "locationPublicId" });
    expect(
      await rejection(createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationB.publicId, code: "a1", nameEn: "B" })),
    ).toEqual({ statusCode: 409, code: "warehouse_code_taken", field: "code" });
    const b = await createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationB.publicId, code: "B1", nameEn: "B store" });
    expect(b.warehouse.branch.publicId).toBe(locationB.publicId);
    expect((await listWarehouses(db, tenantId, ADMIN)).warehouses.map((warehouse) => warehouse.code)).toEqual(["A1", "B1"]);
  });

  it("rejects All branches, business labels, blank, unknown, another tenant's and suspended branches", async () => {
    const before = await locationRows();
    const attempt = (locationPublicId: unknown) =>
      rejection(createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId, code: "X1", nameEn: "Store" }));
    for (const value of [ALL_BRANCHES, "", "   ", undefined, null, 42]) {
      expect(await attempt(value), String(value)).toEqual({ statusCode: 400, code: "location_required", field: "locationPublicId" });
    }
    for (const label of REQUESTED_BUSINESS_BRANCH_LABELS) {
      // A business label is a name, never a location id, so it cannot hold a warehouse.
      expect(await attempt(label.label), label.label).toEqual({ statusCode: 404, code: "location_not_found", field: "locationPublicId" });
      expect(await attempt(label.key), label.key).toMatchObject({ statusCode: 404, code: "location_not_found" });
    }
    expect(await attempt("loc_nowhere")).toMatchObject({ statusCode: 404, code: "location_not_found" });
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    expect(await attempt(flowers.location.publicId)).toMatchObject({ statusCode: 404, code: "location_not_found" });
    await sql`UPDATE qos.locations SET status = 'suspended' WHERE id = ${locationB.id}`;
    expect(await attempt(locationB.publicId)).toEqual({ statusCode: 400, code: "location_suspended", field: "locationPublicId" });
    expect((await listWarehouses(db, tenantId, ADMIN)).warehouses).toEqual([]);
    await sql`UPDATE qos.locations SET status = 'active' WHERE id = ${locationB.id}`;
    // The test itself suspended and reactivated B directly; the service calls changed nothing.
    expect(await locationRows()).toEqual(before);
  });

  it("refuses to move a warehouse to another branch, explaining its dependencies, and keeps its code fixed", async () => {
    const created = await createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationA.publicId, code: "A1", nameEn: "A" });
    const before = await locationRows();
    let refused: unknown;
    try {
      await updateWarehouse(db, tenantId, ADMIN, ACTOR, created.warehouse.publicId, {
        expectedVersion: 1,
        locationPublicId: locationB.publicId,
      });
    } catch (error) {
      refused = error;
    }
    expect(refused).toMatchObject({ statusCode: 409, code: "location_immutable", field: "locationPublicId", dependencies: [] });
    expect(
      await rejection(updateWarehouse(db, tenantId, ADMIN, ACTOR, created.warehouse.publicId, { expectedVersion: 1, locationPublicId: ALL_BRANCHES })),
    ).toMatchObject({ statusCode: 409, code: "location_immutable" });
    expect(
      await rejection(updateWarehouse(db, tenantId, ADMIN, ACTOR, created.warehouse.publicId, { expectedVersion: 1, code: "A2" })),
    ).toEqual({ statusCode: 400, code: "warehouse_code_immutable", field: "code" });
    // Sending the unchanged branch and code alongside a rename is fine.
    const renamed = await updateWarehouse(db, tenantId, ADMIN, ACTOR, created.warehouse.publicId, {
      expectedVersion: 1,
      locationPublicId: locationA.publicId,
      code: "A1",
      nameEn: "A renamed",
      nameAr: "المخزن",
      notes: "Moved shelves.",
    });
    expect(renamed.warehouse).toMatchObject({
      publicId: created.warehouse.publicId,
      code: "A1",
      nameEn: "A renamed",
      nameAr: "المخزن",
      notes: "Moved shelves.",
      version: 2,
      branch: { publicId: locationA.publicId },
    });
    const cleared = await updateWarehouse(db, tenantId, ADMIN, ACTOR, created.warehouse.publicId, {
      expectedVersion: 2,
      nameAr: "",
      notes: null,
    });
    expect(cleared.warehouse).toMatchObject({ nameEn: "A renamed", nameAr: null, notes: null, version: 3 });
    expect(await getWarehouse(db, tenantId, ADMIN, created.warehouse.publicId)).toEqual(cleared);
    expect(await locationRows()).toEqual(before);
  });

  it("archives with no dependencies, lets the branch take a new warehouse and blocks restoring the old one", async () => {
    const first = await createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationA.publicId, code: "A1", nameEn: "A" });
    const before = await locationRows();
    const archived = await updateWarehouse(db, tenantId, ADMIN, ACTOR, first.warehouse.publicId, { expectedVersion: 1, status: "archived" });
    expect(archived.warehouse).toMatchObject({ status: "archived", branch: { publicId: locationA.publicId } });
    const second = await createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationA.publicId, code: "A2", nameEn: "A2" });
    expect(
      await rejection(updateWarehouse(db, tenantId, ADMIN, ACTOR, first.warehouse.publicId, { expectedVersion: 2, status: "active" })),
    ).toEqual({ statusCode: 409, code: "warehouse_branch_taken", field: "locationPublicId" });
    await updateWarehouse(db, tenantId, ADMIN, ACTOR, second.warehouse.publicId, { expectedVersion: 1, status: "archived" });
    const restored = await updateWarehouse(db, tenantId, ADMIN, ACTOR, first.warehouse.publicId, { expectedVersion: 2, status: "active" });
    expect(restored.warehouse).toMatchObject({ status: "active", version: 3 });
    expect(await locationRows()).toEqual(before);
    const audit = (await auditActions(sql, tenantId)).filter((row) => row.entity_public_id === first.warehouse.publicId);
    expect(audit.map((row) => [row.action, row.location_id])).toEqual([
      ["inventory.warehouse.create", locationA.id],
      ["inventory.warehouse.archive", locationA.id],
      ["inventory.warehouse.restore", locationA.id],
    ]);
    expect(audit[1]!.change_summary).toMatchObject({ before: { status: "active" }, after: { status: "archived" } });
  });

  it("validates input, answers 409 on a stale version and 403 to a user-role member", async () => {
    const base = { locationPublicId: locationA.publicId, code: "A1", nameEn: "A" };
    expect(await rejection(createWarehouse(db, tenantId, ADMIN, ACTOR, { ...base, code: "" }))).toMatchObject({ statusCode: 400, code: "code_invalid" });
    expect(await rejection(createWarehouse(db, tenantId, ADMIN, ACTOR, { ...base, code: "a b" }))).toMatchObject({ code: "code_invalid" });
    expect(await rejection(createWarehouse(db, tenantId, ADMIN, ACTOR, { ...base, nameEn: "" }))).toMatchObject({ code: "name_required" });
    expect(await rejection(createWarehouse(db, tenantId, ADMIN, ACTOR, { ...base, notes: "x".repeat(401) }))).toEqual({
      statusCode: 400,
      code: "text_too_long",
      field: "notes",
    });
    expect(await rejection(createWarehouse(db, tenantId, USER, ACTOR, base))).toMatchObject({ statusCode: 403, code: "administrator_required" });
    expect((await listWarehouses(db, tenantId, ADMIN)).warehouses).toEqual([]);
    const created = await createWarehouse(db, tenantId, ADMIN, ACTOR, base);
    await updateWarehouse(db, tenantId, ADMIN, ACTOR, created.warehouse.publicId, { expectedVersion: 1, nameEn: "B" });
    expect(
      await rejection(updateWarehouse(db, tenantId, ADMIN, ACTOR, created.warehouse.publicId, { expectedVersion: 1, nameEn: "C" })),
    ).toMatchObject({ statusCode: 409, code: "expected_version_mismatch" });
    expect(
      await rejection(updateWarehouse(db, tenantId, USER, ACTOR, created.warehouse.publicId, { expectedVersion: 2, status: "archived" })),
    ).toMatchObject({ statusCode: 403, code: "administrator_required" });
    expect((await getWarehouse(db, tenantId, ADMIN, created.warehouse.publicId)).warehouse).toMatchObject({
      nameEn: "B",
      status: "active",
      version: 2,
    });
  });

  it("shows a user only the warehouses of branches in their scope and answers 403 for the others", async () => {
    const a = await createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationA.publicId, code: "A1", nameEn: "A" });
    const b = await createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationB.publicId, code: "B1", nameEn: "B" });
    const user = await scopedUser([locationA.id]);
    expect((await listWarehouses(db, tenantId, user)).warehouses.map((warehouse) => warehouse.publicId)).toEqual([a.warehouse.publicId]);
    expect((await getWarehouse(db, tenantId, user, a.warehouse.publicId)).warehouse.publicId).toBe(a.warehouse.publicId);
    expect(await rejection(getWarehouse(db, tenantId, user, b.warehouse.publicId))).toEqual({
      statusCode: 403,
      code: "branch_not_permitted",
      field: "warehousePublicId",
    });
    expect((await listWarehouses(db, tenantId, ADMIN)).warehouses).toHaveLength(2);
  });

  it("isolates tenants: another tenant's warehouse is 404 and never listed", async () => {
    const created = await createWarehouse(db, tenantId, ADMIN, ACTOR, { locationPublicId: locationA.publicId, code: "A1", nameEn: "A" });
    const flowers = await createTenantHierarchy(db, flowerTenantFixture());
    expect(await rejection(getWarehouse(db, flowers.tenant.id, ADMIN, created.warehouse.publicId))).toEqual({
      statusCode: 404,
      code: "warehouse_not_found",
      field: "warehousePublicId",
    });
    expect(
      await rejection(updateWarehouse(db, flowers.tenant.id, ADMIN, ACTOR, created.warehouse.publicId, { expectedVersion: 1, nameEn: "X" })),
    ).toMatchObject({ statusCode: 404, code: "warehouse_not_found" });
    expect((await listWarehouses(db, flowers.tenant.id, ADMIN)).warehouses).toEqual([]);
    // The same code is free in another tenant, at that tenant's own location.
    const theirs = await createWarehouse(db, flowers.tenant.id, ADMIN, ACTOR, {
      locationPublicId: flowers.location.publicId,
      code: "A1",
      nameEn: "Flowers store",
    });
    expect(theirs.warehouse.branch.publicId).toBe(flowers.location.publicId);
    expect((await getWarehouse(db, tenantId, ADMIN, created.warehouse.publicId)).warehouse.nameEn).toBe("A");
  });
});
