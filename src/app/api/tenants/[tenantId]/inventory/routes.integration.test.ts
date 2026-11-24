import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { StaffAuthError } from "@/lib/staff/session";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy, ensureSeedLocation } from "@/lib/tenant/repository";

import { GET as getCategory, PATCH as patchCategory } from "./categories/[categoryPublicId]/route";
import { GET as listCategories, POST as postCategory } from "./categories/route";
import { PATCH as patchConversion } from "./items/[itemPublicId]/conversions/[conversionPublicId]/route";
import { POST as postConversion } from "./items/[itemPublicId]/conversions/route";
import { GET as getItem, PATCH as patchItem } from "./items/[itemPublicId]/route";
import { PATCH as patchReferenceCost } from "./items/[itemPublicId]/reference-costs/[costPublicId]/route";
import { POST as postReferenceCost } from "./items/[itemPublicId]/reference-costs/route";
import { GET as listItems, POST as postItem } from "./items/route";
import { GET as getSupplier, PATCH as patchSupplier } from "./suppliers/[supplierPublicId]/route";
import { GET as listSuppliers, POST as postSupplier } from "./suppliers/route";
import { GET as getUnit, PATCH as patchUnit } from "./units/[unitPublicId]/route";
import { GET as listUnits, POST as postUnit } from "./units/route";
import { GET as getWarehouse, PATCH as patchWarehouse } from "./warehouses/[warehousePublicId]/route";
import { GET as listWarehouses, POST as postWarehouse } from "./warehouses/route";

const staffMocks = vi.hoisted(() => ({ requireStaffIdentity: vi.fn() }));

vi.mock("@/lib/staff/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/staff/auth")>();
  return { ...actual, requireStaffIdentity: staffMocks.requireStaffIdentity };
});

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

const ADMIN = "admin.qos195.quotes@test";
const USER = "user.qos195.quotes@test";
const OUTSIDER = "admin.qos195.flower@test";

type Json = Record<string, unknown>;

integrationDescribe("inventory routes", () => {
  let db: Awaited<ReturnType<typeof resetAndMigrate>>["db"];
  let sqlClient: Awaited<ReturnType<typeof resetAndMigrate>>["sql"];
  let tenantId: string;
  let otherTenantId: string;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sqlClient = connection.sql;
    await grantRoleMembership(sqlClient, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sqlClient.end({ timeout: 5 });
  });

  async function seedMember(target: string, subject: string, role: "administrator" | "user") {
    const [identity] = await db.insert(staffIdentities).values({ providerSubject: subject, email: subject }).returning();
    await db.insert(staffMemberships).values({ tenantId: target, staffIdentityId: identity!.id, role });
  }

  beforeEach(async () => {
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.inventory_item_reference_costs, qos.inventory_item_conversions, qos.inventory_items, qos.inventory_categories, qos.inventory_units, qos.inventory_warehouses, qos.inventory_suppliers, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
    staffMocks.requireStaffIdentity.mockReset();
    tenantId = (await createTenantHierarchy(db, quotesTenantFixture())).tenant.id;
    otherTenantId = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    await seedMember(tenantId, ADMIN, "administrator");
    await seedMember(tenantId, USER, "user");
    await seedMember(otherTenantId, OUTSIDER, "administrator");
  });

  function signIn(subject: string) {
    staffMocks.requireStaffIdentity.mockResolvedValue({ subject, email: subject });
  }

  const ctx = <T extends Json>(params: T) => ({ params: Promise.resolve({ tenantId, ...params }) });
  const request = (method: string, body?: unknown) =>
    new Request("http://localhost/api/inventory", {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    });
  async function call(response: Promise<Response>) {
    const resolved = await response;
    return { status: resolved.status, body: (await resolved.json()) as Json };
  }

  async function seedCatalogue() {
    signIn(ADMIN);
    const unit = async (body: Json) =>
      ((await call(postUnit(request("POST", body), ctx({})))).body.unit as { publicId: string; version: number });
    const piece = await unit({ source: "standard", standardCode: "piece" });
    const packet = await unit({ source: "custom", code: "packet", nameEn: "Packet", nameAr: "علبة", quantityKind: "pack", decimalPlaces: 0 });
    const box = await unit({ source: "custom", code: "box", nameEn: "Box", nameAr: "صندوق", quantityKind: "pack", decimalPlaces: 0 });
    const created = await call(
      postItem(request("POST", { nameEn: "Buns", nameAr: "خبز", kind: "purchased", storageUnitPublicId: piece.publicId, purchaseUnitPublicId: packet.publicId }), ctx({})),
    );
    const item = (created.body.item as { item: { publicId: string } }).item;
    return { piece, packet, box, item };
  }

  it("answers 401 without a staff session on every handler", async () => {
    staffMocks.requireStaffIdentity.mockRejectedValue(new StaffAuthError("Sign in required."));
    const responses = await Promise.all([
      listUnits(request("GET"), ctx({})),
      postUnit(request("POST", {}), ctx({})),
      getUnit(request("GET"), ctx({ unitPublicId: "unit_x" })),
      patchUnit(request("PATCH", {}), ctx({ unitPublicId: "unit_x" })),
      listItems(request("GET"), ctx({})),
      postItem(request("POST", {}), ctx({})),
      getItem(request("GET"), ctx({ itemPublicId: "item_x" })),
      patchItem(request("PATCH", {}), ctx({ itemPublicId: "item_x" })),
      postConversion(request("POST", {}), ctx({ itemPublicId: "item_x" })),
      patchConversion(request("PATCH", {}), ctx({ itemPublicId: "item_x", conversionPublicId: "conv_x" })),
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(10).fill(401));
  });

  it("answers 403 to a signed-in staff member of another business, for reads and writes", async () => {
    const { item } = await seedCatalogue();
    signIn(OUTSIDER);
    expect((await call(listUnits(request("GET"), ctx({})))).status).toBe(403);
    expect((await call(getItem(request("GET"), ctx({ itemPublicId: item.publicId })))).status).toBe(403);
    expect((await call(postUnit(request("POST", { source: "standard", standardCode: "g" }), ctx({})))).status).toBe(403);
  });

  it("lets a user-role member read but answers 403 administrator_required on every write", async () => {
    const { packet, piece, item } = await seedCatalogue();
    signIn(USER);
    expect((await call(listUnits(request("GET"), ctx({})))).status).toBe(200);
    expect((await call(listItems(request("GET"), ctx({})))).status).toBe(200);
    const writes = await Promise.all([
      call(postUnit(request("POST", { source: "standard", standardCode: "g" }), ctx({}))),
      call(patchUnit(request("PATCH", { expectedVersion: 1, nameEn: "Pack" }), ctx({ unitPublicId: packet.publicId }))),
      call(postItem(request("POST", { nameEn: "Tea", kind: "purchased" }), ctx({}))),
      call(patchItem(request("PATCH", { expectedVersion: 1, nameEn: "Rolls" }), ctx({ itemPublicId: item.publicId }))),
      call(
        postConversion(
          request("POST", { fromUnitPublicId: packet.publicId, toUnitPublicId: piece.publicId, factor: "12" }),
          ctx({ itemPublicId: item.publicId }),
        ),
      ),
    ]);
    for (const write of writes) {
      expect(write).toEqual({ status: 403, body: expect.objectContaining({ code: "administrator_required" }) });
    }
  });

  it("returns the documented 200 shapes and round-trips every value", async () => {
    const { piece, packet, item } = await seedCatalogue();
    const units = await call(listUnits(request("GET"), ctx({})));
    expect(units.status).toBe(200);
    expect(Object.keys(units.body).sort()).toEqual(["standardUnits", "units"]);
    const unit = await call(getUnit(request("GET"), ctx({ unitPublicId: packet.publicId })));
    expect(unit.body).toEqual({
      unit: expect.objectContaining({ publicId: packet.publicId, code: "packet", nameAr: "علبة", decimalPlaces: 0 }),
      usage: { itemDesignations: 1, currentRules: 0, currentCosts: 0 },
    });
    const renamed = await call(
      patchUnit(request("PATCH", { expectedVersion: 1, nameEn: "Sealed packet", decimalPlaces: 2 }), ctx({ unitPublicId: packet.publicId })),
    );
    expect(renamed.body.unit).toMatchObject({ publicId: packet.publicId, code: "packet", nameEn: "Sealed packet", decimalPlaces: 2, version: 2 });

    const withRule = await call(
      postConversion(
        request("POST", { fromUnitPublicId: packet.publicId, toUnitPublicId: piece.publicId, factor: "12", effectiveFrom: "2026-11-01" }),
        ctx({ itemPublicId: item.publicId }),
      ),
    );
    expect(withRule.status).toBe(200);
    expect(Object.keys(withRule.body).sort()).toEqual(["categories", "costHistory", "history", "item", "preview", "referenceCost", "rules", "suppliers", "units"]);
    const rule = (withRule.body.rules as Array<Json>)[0]!;
    expect(rule).toMatchObject({ factor: "12", factorMicros: "12000000", revision: 1, effectiveFrom: "2026-11-01" });
    expect(typeof rule.factor).toBe("string");

    const revised = await call(
      patchConversion(
        request("PATCH", { operation: "revise", expectedRevision: 1, factor: "10", effectiveFrom: "2026-11-20" }),
        ctx({ itemPublicId: item.publicId, conversionPublicId: rule.publicId as string }),
      ),
    );
    expect(revised.status).toBe(200);
    expect((revised.body.history as Array<Json>).map((row) => [row.revision, row.factor, row.effectiveTo])).toEqual([
      [2, "10", null],
      [1, "12", "2026-11-20"],
    ]);
    const reread = await call(getItem(request("GET"), ctx({ itemPublicId: item.publicId })));
    expect(reread.body).toEqual(revised.body);
    const itemPatch = await call(patchItem(request("PATCH", { expectedVersion: 1, nameEn: "Brioche buns" }), ctx({ itemPublicId: item.publicId })));
    expect((itemPatch.body.item as Json).publicId).toBe(item.publicId);
    const listed = await call(listItems(request("GET"), ctx({})));
    expect(listed.body.items).toEqual([expect.objectContaining({ publicId: item.publicId, nameEn: "Brioche buns", currentRuleCount: 1, previewStatus: "complete" })]);
    const closed = await call(
      patchConversion(
        request("PATCH", { operation: "close", expectedRevision: 2, effectiveFrom: "2026-11-21" }),
        ctx({ itemPublicId: item.publicId, conversionPublicId: (revised.body.rules as Array<Json>)[0]!.publicId as string }),
      ),
    );
    expect(closed.body.rules).toEqual([]);
    expect(closed.body.history).toHaveLength(2);
  });

  it("answers 404 for unknown or another business's public ids", async () => {
    const { packet, item } = await seedCatalogue();
    signIn(OUTSIDER);
    const foreign = <T extends Json>(params: T) => ({ params: Promise.resolve({ tenantId: otherTenantId, ...params }) });
    expect((await call(getItem(request("GET"), foreign({ itemPublicId: item.publicId })))).body).toMatchObject({ code: "item_not_found" });
    expect((await call(getItem(request("GET"), foreign({ itemPublicId: item.publicId })))).status).toBe(404);
    expect((await call(getUnit(request("GET"), foreign({ unitPublicId: packet.publicId })))).status).toBe(404);
    expect(
      (await call(patchUnit(request("PATCH", { expectedVersion: 1, nameEn: "Hijack" }), foreign({ unitPublicId: packet.publicId })))).status,
    ).toBe(404);
    expect(
      (await call(postConversion(request("POST", { fromUnitPublicId: packet.publicId, toUnitPublicId: packet.publicId, factor: "1" }), foreign({ itemPublicId: item.publicId })))).status,
    ).toBe(404);
    signIn(ADMIN);
    const [packetRow] = await sqlClient<{ name_en: string }[]>`SELECT name_en FROM qos.inventory_units WHERE public_id = ${packet.publicId}`;
    expect(packetRow?.name_en).toBe("Packet");
  });

  it("answers 409 for duplicate, derivable and stale writes and 400 for invalid input", async () => {
    const { piece, packet, box, item } = await seedCatalogue();
    const add = (from: string, to: string, factor: string) =>
      call(postConversion(request("POST", { fromUnitPublicId: from, toUnitPublicId: to, factor }), ctx({ itemPublicId: item.publicId })));
    expect((await add(packet.publicId, box.publicId, "2")).status).toBe(200);
    expect((await add(box.publicId, piece.publicId, "6")).status).toBe(200);
    expect(await add(box.publicId, packet.publicId, "0.5")).toEqual({
      status: 409,
      body: expect.objectContaining({ code: "duplicate_pair", field: "toUnitPublicId" }),
    });
    const derivable = await add(packet.publicId, piece.publicId, "12");
    expect(derivable.status).toBe(409);
    expect(derivable.body).toMatchObject({ code: "already_derivable" });
    expect(derivable.body.error).toContain("packet → box → piece");
    expect(await add(packet.publicId, piece.publicId, "-1")).toEqual({ status: 400, body: expect.objectContaining({ code: "factor_not_positive", field: "factor" }) });
    expect(
      await call(postUnit(request("POST", { source: "custom", code: "packet", nameEn: "P", nameAr: "ع", quantityKind: "pack", decimalPlaces: 0 }), ctx({}))),
    ).toEqual({ status: 409, body: expect.objectContaining({ code: "unit_code_taken" }) });
    expect(
      await call(patchItem(request("PATCH", { expectedVersion: 7, nameEn: "Stale" }), ctx({ itemPublicId: item.publicId }))),
    ).toEqual({ status: 409, body: expect.objectContaining({ code: "expected_version_mismatch" }) });
    expect(
      await call(patchUnit(request("PATCH", { expectedVersion: 1, status: "archived" }), ctx({ unitPublicId: packet.publicId }))),
    ).toEqual({ status: 409, body: expect.objectContaining({ code: "unit_in_use" }) });
    expect(
      await call(patchConversion(request("PATCH", { operation: "delete", expectedRevision: 1 }), ctx({ itemPublicId: item.publicId, conversionPublicId: "conv_x" }))),
    ).toEqual({ status: 400, body: expect.objectContaining({ code: "operation_invalid" }) });
  });

  /* QOS-196 suppliers and warehouses. */

  async function secondLocation() {
    const [brand] = await sqlClient<{ id: string }[]>`SELECT id FROM qos.brands WHERE tenant_id = ${tenantId}`;
    return ensureSeedLocation(db, {
      tenantId,
      brandId: brand!.id,
      publicId: "loc_quotes_hct",
      name: "HCT Academic City",
      slug: "hct-academic-city",
      timezone: "Asia/Dubai",
    });
  }

  it("answers 401 without a staff session on every supplier and warehouse handler", async () => {
    staffMocks.requireStaffIdentity.mockRejectedValue(new StaffAuthError("Sign in required."));
    const responses = await Promise.all([
      listSuppliers(request("GET"), ctx({})),
      postSupplier(request("POST", {}), ctx({})),
      getSupplier(request("GET"), ctx({ supplierPublicId: "sup_x" })),
      patchSupplier(request("PATCH", {}), ctx({ supplierPublicId: "sup_x" })),
      listWarehouses(request("GET"), ctx({})),
      postWarehouse(request("POST", {}), ctx({})),
      getWarehouse(request("GET"), ctx({ warehousePublicId: "wh_x" })),
      patchWarehouse(request("PATCH", {}), ctx({ warehousePublicId: "wh_x" })),
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(8).fill(401));
  });

  it("round-trips a supplier and a warehouse through the routes with the documented shapes", async () => {
    signIn(ADMIN);
    const full = {
      nameEn: "Gulf Supply",
      nameAr: "الخليج للتوريد",
      code: "GS-1",
      contactName: "Sara",
      phone: "+971 4 555 0101",
      email: "orders@gulf.ae",
      address: "Al Quoz, Dubai",
      notes: "Mornings only.",
    };
    const created = await call(postSupplier(request("POST", full), ctx({})));
    expect(created.status).toBe(200);
    const detail = created.body.supplier as { supplier: Json; items: unknown[]; dependencies: unknown[] };
    expect(Object.keys(detail).sort()).toEqual(["dependencies", "items", "supplier"]);
    expect(detail.supplier).toMatchObject({ ...full, status: "active", version: 1 });
    const supplierPublicId = detail.supplier.publicId as string;
    const twin = await call(postSupplier(request("POST", { nameEn: "Gulf Supply" }), ctx({})));
    expect((twin.body.supplier as { supplier: Json }).supplier.publicId).not.toBe(supplierPublicId);
    const listed = await call(listSuppliers(request("GET"), ctx({})));
    expect(Object.keys(listed.body)).toEqual(["suppliers"]);
    expect(listed.body.suppliers).toHaveLength(2);
    const reread = await call(getSupplier(request("GET"), ctx({ supplierPublicId })));
    expect(reread.body).toEqual(detail);
    const patched = await call(patchSupplier(request("PATCH", { expectedVersion: 1, email: null }), ctx({ supplierPublicId })));
    expect(patched.body.supplier).toMatchObject({ email: null, phone: full.phone, version: 2 });

    const posted = await call(
      postWarehouse(request("POST", { locationPublicId: "loc_quotes_hbz", code: "HBZ", nameEn: "HBZ store", notes: "Back room." }), ctx({})),
    );
    expect(posted.status).toBe(200);
    const warehouse = posted.body.warehouse as { warehouse: Json; dependencies: unknown[] };
    expect(Object.keys(warehouse).sort()).toEqual(["dependencies", "warehouse"]);
    expect(warehouse.warehouse).toMatchObject({
      code: "HBZ",
      nameEn: "HBZ store",
      notes: "Back room.",
      branch: { publicId: "loc_quotes_hbz", name: "HBZ Stadium", status: "active", timezone: "Asia/Dubai" },
    });
    const warehousePublicId = warehouse.warehouse.publicId as string;
    expect((await call(getWarehouse(request("GET"), ctx({ warehousePublicId })))).body).toEqual(warehouse);
    expect((await call(listWarehouses(request("GET"), ctx({})))).body).toEqual({ warehouses: [warehouse.warehouse] });

    // Items accept and return the default supplier.
    const item = await call(postItem(request("POST", { nameEn: "Milk", kind: "purchased", defaultSupplierPublicId: supplierPublicId }), ctx({})));
    const itemDetail = item.body.item as { item: Json; suppliers: Json[] };
    expect(itemDetail.item.defaultSupplierPublicId).toBe(supplierPublicId);
    expect(itemDetail.suppliers.map((supplier) => supplier.publicId)).toContain(supplierPublicId);
    const cleared = await call(
      patchItem(request("PATCH", { expectedVersion: 1, defaultSupplierPublicId: null }), ctx({ itemPublicId: itemDetail.item.publicId as string })),
    );
    expect((cleared.body.item as Json).defaultSupplierPublicId).toBeNull();
  });

  it("lets a user read suppliers and scoped warehouses but answers 403 on writes and out-of-scope warehouses", async () => {
    signIn(ADMIN);
    const hct = await secondLocation();
    const supplier = ((await call(postSupplier(request("POST", { nameEn: "Gulf Supply" }), ctx({})))).body.supplier as { supplier: Json })
      .supplier;
    const hbzWarehouse = (
      (await call(postWarehouse(request("POST", { locationPublicId: "loc_quotes_hbz", code: "HBZ", nameEn: "HBZ" }), ctx({})))).body
        .warehouse as { warehouse: Json }
    ).warehouse;
    const hctWarehouse = (
      (await call(postWarehouse(request("POST", { locationPublicId: hct.publicId, code: "HCT", nameEn: "HCT" }), ctx({})))).body
        .warehouse as { warehouse: Json }
    ).warehouse;
    await sqlClient`
      INSERT INTO qos.staff_location_scopes (tenant_id, staff_membership_id, location_id)
      SELECT m.tenant_id, m.id, l.id FROM qos.staff_memberships m
      JOIN qos.staff_identities i ON i.id = m.staff_identity_id
      JOIN qos.locations l ON l.tenant_id = m.tenant_id AND l.public_id = 'loc_quotes_hbz'
      WHERE i.provider_subject = ${USER} AND m.tenant_id = ${tenantId}`;

    signIn(USER);
    expect((await call(listSuppliers(request("GET"), ctx({})))).body.suppliers).toHaveLength(1);
    expect((await call(getSupplier(request("GET"), ctx({ supplierPublicId: supplier.publicId as string })))).status).toBe(200);
    const visible = await call(listWarehouses(request("GET"), ctx({})));
    expect((visible.body.warehouses as Json[]).map((warehouse) => warehouse.publicId)).toEqual([hbzWarehouse.publicId]);
    expect((await call(getWarehouse(request("GET"), ctx({ warehousePublicId: hbzWarehouse.publicId as string })))).status).toBe(200);
    expect(await call(getWarehouse(request("GET"), ctx({ warehousePublicId: hctWarehouse.publicId as string })))).toEqual({
      status: 403,
      body: expect.objectContaining({ code: "branch_not_permitted" }),
    });
    const writes = await Promise.all([
      call(postSupplier(request("POST", { nameEn: "Sneaky" }), ctx({}))),
      call(patchSupplier(request("PATCH", { expectedVersion: 1, nameEn: "Hijack" }), ctx({ supplierPublicId: supplier.publicId as string }))),
      call(postWarehouse(request("POST", { locationPublicId: "loc_quotes_hbz", code: "U1", nameEn: "U" }), ctx({}))),
      call(
        patchWarehouse(request("PATCH", { expectedVersion: 1, status: "archived" }), ctx({ warehousePublicId: hbzWarehouse.publicId as string })),
      ),
    ]);
    for (const write of writes) {
      expect(write).toEqual({ status: 403, body: expect.objectContaining({ code: "administrator_required" }) });
    }
    const [counts] = await sqlClient<{ suppliers: number; warehouses: number }[]>`
      SELECT (SELECT count(*)::int FROM qos.inventory_suppliers) AS suppliers,
             (SELECT count(*)::int FROM qos.inventory_warehouses WHERE status = 'active') AS warehouses`;
    expect(counts).toEqual({ suppliers: 1, warehouses: 2 });

    signIn(OUTSIDER);
    expect((await call(listSuppliers(request("GET"), ctx({})))).status).toBe(403);
    expect((await call(listWarehouses(request("GET"), ctx({})))).status).toBe(403);
    expect((await call(postWarehouse(request("POST", { locationPublicId: "loc_quotes_hbz", code: "X", nameEn: "X" }), ctx({})))).status).toBe(403);
  });

  it("answers 404 for unknown or another business's supplier, warehouse and location ids", async () => {
    signIn(ADMIN);
    const supplier = ((await call(postSupplier(request("POST", { nameEn: "Gulf Supply" }), ctx({})))).body.supplier as { supplier: Json })
      .supplier;
    const warehouse = (
      (await call(postWarehouse(request("POST", { locationPublicId: "loc_quotes_hbz", code: "HBZ", nameEn: "HBZ" }), ctx({})))).body
        .warehouse as { warehouse: Json }
    ).warehouse;
    expect(await call(getSupplier(request("GET"), ctx({ supplierPublicId: "sup_nope" })))).toEqual({
      status: 404,
      body: expect.objectContaining({ code: "supplier_not_found" }),
    });
    expect((await call(getWarehouse(request("GET"), ctx({ warehousePublicId: "wh_nope" })))).status).toBe(404);
    expect(
      await call(postWarehouse(request("POST", { locationPublicId: "loc_flowers_main", code: "F1", nameEn: "F" }), ctx({}))),
    ).toEqual({ status: 404, body: expect.objectContaining({ code: "location_not_found", field: "locationPublicId" }) });
    expect(await call(postWarehouse(request("POST", { locationPublicId: "all", code: "F1", nameEn: "F" }), ctx({})))).toEqual({
      status: 400,
      body: expect.objectContaining({ code: "location_required" }),
    });
    signIn(OUTSIDER);
    const foreign = <T extends Json>(params: T) => ({ params: Promise.resolve({ tenantId: otherTenantId, ...params }) });
    expect((await call(getSupplier(request("GET"), foreign({ supplierPublicId: supplier.publicId as string })))).status).toBe(404);
    expect((await call(getWarehouse(request("GET"), foreign({ warehousePublicId: warehouse.publicId as string })))).status).toBe(404);
    expect(
      (await call(patchWarehouse(request("PATCH", { expectedVersion: 1, nameEn: "Hijack" }), foreign({ warehousePublicId: warehouse.publicId as string })))).status,
    ).toBe(404);
    expect(
      (await call(postWarehouse(request("POST", { locationPublicId: "loc_quotes_hbz", code: "HIJACK", nameEn: "Hijack" }), foreign({})))).body,
    ).toMatchObject({ code: "location_not_found" });
    signIn(ADMIN);
    expect((await call(getWarehouse(request("GET"), ctx({ warehousePublicId: warehouse.publicId as string })))).body.warehouse).toMatchObject({
      nameEn: "HBZ",
      version: 1,
    });
  });

  it("answers 409 with the dependencies for a supplier in use, a reassignment and a duplicate branch warehouse", async () => {
    signIn(ADMIN);
    const hct = await secondLocation();
    const supplier = ((await call(postSupplier(request("POST", { nameEn: "Gulf Supply", code: "GS-1" }), ctx({})))).body.supplier as {
      supplier: Json;
    }).supplier;
    await call(postItem(request("POST", { nameEn: "Milk", kind: "purchased", defaultSupplierPublicId: supplier.publicId }), ctx({})));
    expect(
      await call(patchSupplier(request("PATCH", { expectedVersion: 1, status: "archived" }), ctx({ supplierPublicId: supplier.publicId as string }))),
    ).toEqual({
      status: 409,
      body: expect.objectContaining({ code: "supplier_in_use", field: "status", dependencies: [{ kind: "inventory_items", count: 1 }] }),
    });
    expect(await call(postSupplier(request("POST", { nameEn: "Other", code: "gs-1" }), ctx({})))).toEqual({
      status: 409,
      body: expect.objectContaining({ code: "supplier_code_taken" }),
    });
    const warehouse = (
      (await call(postWarehouse(request("POST", { locationPublicId: "loc_quotes_hbz", code: "HBZ", nameEn: "HBZ" }), ctx({})))).body
        .warehouse as { warehouse: Json }
    ).warehouse;
    expect(
      await call(
        patchWarehouse(
          request("PATCH", { expectedVersion: 1, locationPublicId: hct.publicId }),
          ctx({ warehousePublicId: warehouse.publicId as string }),
        ),
      ),
    ).toEqual({ status: 409, body: expect.objectContaining({ code: "location_immutable", field: "locationPublicId", dependencies: [] }) });
    expect(await call(postWarehouse(request("POST", { locationPublicId: "loc_quotes_hbz", code: "HBZ2", nameEn: "Again" }), ctx({})))).toEqual({
      status: 409,
      body: expect.objectContaining({ code: "warehouse_branch_taken", field: "locationPublicId" }),
    });
    expect(
      await call(patchWarehouse(request("PATCH", { expectedVersion: 9, nameEn: "Stale" }), ctx({ warehousePublicId: warehouse.publicId as string }))),
    ).toEqual({ status: 409, body: expect.objectContaining({ code: "expected_version_mismatch" }) });
    const [location] = await sqlClient<{ name: string; status: string }[]>`
      SELECT name, status::text FROM qos.locations WHERE public_id = 'loc_quotes_hbz'`;
    expect(location).toEqual({ name: "HBZ Stadium", status: "active" });
  });
  /* QOS-197 categories, item category and notes, and reference costs. */

  it("answers 401 without a staff session on every category and reference cost handler", async () => {
    staffMocks.requireStaffIdentity.mockRejectedValue(new StaffAuthError("Sign in required."));
    const responses = await Promise.all([
      listCategories(request("GET"), ctx({})),
      postCategory(request("POST", {}), ctx({})),
      getCategory(request("GET"), ctx({ categoryPublicId: "invcat_x" })),
      patchCategory(request("PATCH", {}), ctx({ categoryPublicId: "invcat_x" })),
      postReferenceCost(request("POST", {}), ctx({ itemPublicId: "item_x" })),
      patchReferenceCost(request("PATCH", {}), ctx({ itemPublicId: "item_x", costPublicId: "cost_x" })),
    ]);
    expect(responses.map((response) => response.status)).toEqual(Array(6).fill(401));
  });

  it("round-trips a category, an item's category and notes, and a reference cost through the routes", async () => {
    const { piece, packet, item } = await seedCatalogue();
    const created = await call(postCategory(request("POST", { nameEn: "Bakery", nameAr: "مخبوزات" }), ctx({})));
    expect(created.status).toBe(200);
    const category = created.body.category as { category: Json; items: unknown[]; dependencies: unknown[] };
    expect(Object.keys(category).sort()).toEqual(["category", "dependencies", "items"]);
    expect(category.category).toMatchObject({ nameEn: "Bakery", nameAr: "مخبوزات", status: "active", version: 1 });
    const categoryPublicId = category.category.publicId as string;
    expect((await call(getCategory(request("GET"), ctx({ categoryPublicId })))).body).toEqual(category);
    const listed = await call(listCategories(request("GET"), ctx({})));
    expect(listed.body).toEqual({ categories: [{ ...category.category, itemCount: 0, activeItemCount: 0 }] });

    const patched = await call(
      patchItem(
        request("PATCH", { expectedVersion: 1, categoryPublicId, notes: "Order two days ahead." }),
        ctx({ itemPublicId: item.publicId }),
      ),
    );
    expect(patched.status).toBe(200);
    expect(patched.body.item).toMatchObject({ publicId: item.publicId, categoryPublicId, notes: "Order two days ahead." });
    expect(patched.body.referenceCost).toEqual({ status: "unknown" });
    const renamed = await call(patchCategory(request("PATCH", { expectedVersion: 1, nameEn: "Bread" }), ctx({ categoryPublicId })));
    expect(renamed.body).toMatchObject({ category: { publicId: categoryPublicId, nameEn: "Bread", version: 2 }, items: [{ publicId: item.publicId }] });

    const costed = await call(
      postReferenceCost(
        request("POST", {
          amount: "18.123456",
          unitPublicId: packet.publicId,
          taxBasis: "unconfirmed",
          source: "invoice",
          sourceReference: "INV-0042",
          effectiveFrom: "2026-11-01",
          expectedRevision: null,
        }),
        ctx({ itemPublicId: item.publicId }),
      ),
    );
    expect(costed.status).toBe(200);
    expect(costed.body.referenceCost).toMatchObject({
      status: "known_not_convertible",
      amount: "18.123456",
      amountMicros: "18123456",
      currency: "AED",
      taxBasis: "unconfirmed",
      source: "invoice",
      sourceReference: "INV-0042",
      effectiveFrom: "2026-11-01",
      revision: 1,
      unit: { publicId: packet.publicId, code: "packet" },
    });
    const withRule = await call(
      postConversion(
        request("POST", { fromUnitPublicId: packet.publicId, toUnitPublicId: piece.publicId, factor: "12" }),
        ctx({ itemPublicId: item.publicId }),
      ),
    );
    expect(withRule.body.referenceCost).toMatchObject({
      status: "known",
      perStorageUnit: { status: "derived", text: "1.510288", rounded: false, unit: { code: "piece" } },
    });
    const costPublicId = (costed.body.costHistory as Json[])[0]!.publicId as string;
    const cleared = await call(
      patchReferenceCost(
        request("PATCH", { operation: "close", expectedRevision: 1, effectiveFrom: "2026-11-10" }),
        ctx({ itemPublicId: item.publicId, costPublicId }),
      ),
    );
    expect(cleared.status).toBe(200);
    expect(cleared.body.referenceCost).toEqual({ status: "unknown" });
    expect((cleared.body.costHistory as Json[]).map((row) => [row.revision, row.amount, row.effectiveTo])).toEqual([[1, "18.123456", "2026-11-10"]]);
    expect((await call(getItem(request("GET"), ctx({ itemPublicId: item.publicId })))).body).toEqual(cleared.body);
    const items = await call(listItems(request("GET"), ctx({})));
    expect(items.body.items).toEqual([
      expect.objectContaining({ publicId: item.publicId, categoryPublicId, costStatus: "unknown", costSummary: null }),
    ]);
  });

  it("lets a user read categories and costs but answers 403 on every category and cost write; other businesses get 403", async () => {
    const { item } = await seedCatalogue();
    const category = ((await call(postCategory(request("POST", { nameEn: "Bakery" }), ctx({})))).body.category as { category: Json }).category;
    const costed = await call(
      postReferenceCost(request("POST", { amount: "2", taxBasis: "net", source: "manual", expectedRevision: null }), ctx({ itemPublicId: item.publicId })),
    );
    const costPublicId = (costed.body.costHistory as Json[])[0]!.publicId as string;
    signIn(USER);
    expect((await call(listCategories(request("GET"), ctx({})))).status).toBe(200);
    expect((await call(getCategory(request("GET"), ctx({ categoryPublicId: category.publicId as string })))).status).toBe(200);
    expect((await call(getItem(request("GET"), ctx({ itemPublicId: item.publicId })))).body.referenceCost).toMatchObject({ amount: "2" });
    const writes = await Promise.all([
      call(postCategory(request("POST", { nameEn: "Sneaky" }), ctx({}))),
      call(patchCategory(request("PATCH", { expectedVersion: 1, status: "archived" }), ctx({ categoryPublicId: category.publicId as string }))),
      call(
        postReferenceCost(request("POST", { amount: "3", taxBasis: "net", source: "manual", expectedRevision: 1 }), ctx({ itemPublicId: item.publicId })),
      ),
      call(
        patchReferenceCost(request("PATCH", { operation: "close", expectedRevision: 1 }), ctx({ itemPublicId: item.publicId, costPublicId })),
      ),
      call(patchItem(request("PATCH", { expectedVersion: 1, categoryPublicId: category.publicId }), ctx({ itemPublicId: item.publicId }))),
    ]);
    for (const write of writes) {
      expect(write).toEqual({ status: 403, body: expect.objectContaining({ code: "administrator_required" }) });
    }
    const [counts] = await sqlClient<{ categories: number; costs: number; current: number }[]>`
      SELECT (SELECT count(*)::int FROM qos.inventory_categories WHERE status = 'active') AS categories,
             (SELECT count(*)::int FROM qos.inventory_item_reference_costs) AS costs,
             (SELECT count(*)::int FROM qos.inventory_item_reference_costs WHERE effective_to IS NULL) AS current`;
    expect(counts).toEqual({ categories: 1, costs: 1, current: 1 });

    signIn(OUTSIDER);
    expect((await call(listCategories(request("GET"), ctx({})))).status).toBe(403);
    expect((await call(getCategory(request("GET"), ctx({ categoryPublicId: category.publicId as string })))).status).toBe(403);
    expect((await call(postCategory(request("POST", { nameEn: "Hijack" }), ctx({})))).status).toBe(403);
    expect(
      (await call(postReferenceCost(request("POST", { amount: "1", taxBasis: "net", source: "manual", expectedRevision: 1 }), ctx({ itemPublicId: item.publicId }))))
        .status,
    ).toBe(403);
  });

  it("answers 404 for unknown or another business's category, item and cost ids", async () => {
    const { item } = await seedCatalogue();
    const category = ((await call(postCategory(request("POST", { nameEn: "Bakery" }), ctx({})))).body.category as { category: Json }).category;
    const costed = await call(
      postReferenceCost(request("POST", { amount: "2", taxBasis: "net", source: "manual", expectedRevision: null }), ctx({ itemPublicId: item.publicId })),
    );
    const costPublicId = (costed.body.costHistory as Json[])[0]!.publicId as string;
    expect(await call(getCategory(request("GET"), ctx({ categoryPublicId: "invcat_nope" })))).toEqual({
      status: 404,
      body: expect.objectContaining({ code: "category_not_found" }),
    });
    expect(
      await call(patchReferenceCost(request("PATCH", { operation: "close", expectedRevision: 1 }), ctx({ itemPublicId: item.publicId, costPublicId: "cost_nope" }))),
    ).toEqual({ status: 404, body: expect.objectContaining({ code: "reference_cost_not_found" }) });
    expect(
      await call(postReferenceCost(request("POST", { amount: "1", taxBasis: "net", source: "manual", expectedRevision: null }), ctx({ itemPublicId: "item_nope" }))),
    ).toEqual({ status: 404, body: expect.objectContaining({ code: "item_not_found" }) });
    signIn(OUTSIDER);
    const foreign = <T extends Json>(params: T) => ({ params: Promise.resolve({ tenantId: otherTenantId, ...params }) });
    expect((await call(getCategory(request("GET"), foreign({ categoryPublicId: category.publicId as string })))).status).toBe(404);
    expect(
      (await call(patchCategory(request("PATCH", { expectedVersion: 1, nameEn: "Hijack" }), foreign({ categoryPublicId: category.publicId as string })))).status,
    ).toBe(404);
    expect(
      (await call(postReferenceCost(request("POST", { amount: "1", taxBasis: "net", source: "manual", expectedRevision: 1 }), foreign({ itemPublicId: item.publicId }))))
        .status,
    ).toBe(404);
    expect(
      (await call(patchReferenceCost(request("PATCH", { operation: "close", expectedRevision: 1 }), foreign({ itemPublicId: item.publicId, costPublicId })))).status,
    ).toBe(404);
    expect(
      (await call(postItem(request("POST", { nameEn: "Hijack", kind: "purchased", categoryPublicId: category.publicId }), foreign({})))).body,
    ).toMatchObject({ code: "category_not_found" });
    signIn(ADMIN);
    expect((await call(getCategory(request("GET"), ctx({ categoryPublicId: category.publicId as string })))).body.category).toMatchObject({
      nameEn: "Bakery",
      version: 1,
    });
    expect((await call(getItem(request("GET"), ctx({ itemPublicId: item.publicId })))).body.referenceCost).toMatchObject({ amount: "2", revision: 1 });
  });

  it("answers 409 with the dependencies for a category in use, and 400/409 for invalid or stale cost writes", async () => {
    const { item } = await seedCatalogue();
    const category = ((await call(postCategory(request("POST", { nameEn: "Bakery" }), ctx({})))).body.category as { category: Json }).category;
    await call(patchItem(request("PATCH", { expectedVersion: 1, categoryPublicId: category.publicId }), ctx({ itemPublicId: item.publicId })));
    expect(
      await call(patchCategory(request("PATCH", { expectedVersion: 1, status: "archived" }), ctx({ categoryPublicId: category.publicId as string }))),
    ).toEqual({
      status: 409,
      body: expect.objectContaining({ code: "category_in_use", field: "status", dependencies: [{ kind: "inventory_items", count: 1 }] }),
    });
    expect(await call(postCategory(request("POST", { nameEn: "bakery" }), ctx({})))).toEqual({
      status: 409,
      body: expect.objectContaining({ code: "category_name_taken", field: "nameEn" }),
    });
    const cost = (body: Json) => call(postReferenceCost(request("POST", body), ctx({ itemPublicId: item.publicId })));
    expect(await cost({ amount: "", taxBasis: "net", source: "manual", expectedRevision: null })).toEqual({
      status: 400,
      body: expect.objectContaining({ code: "amount_required", field: "amount" }),
    });
    expect(await cost({ amount: "1.0000001", taxBasis: "net", source: "manual", expectedRevision: null })).toEqual({
      status: 400,
      body: expect.objectContaining({ code: "amount_too_precise" }),
    });
    expect(await cost({ amount: "1", taxBasis: "NET", source: "manual", expectedRevision: null })).toEqual({
      status: 400,
      body: expect.objectContaining({ code: "tax_basis_invalid" }),
    });
    expect((await cost({ amount: "1", taxBasis: "net", source: "manual", expectedRevision: null })).status).toBe(200);
    expect(await cost({ amount: "2", taxBasis: "net", source: "manual", expectedRevision: null })).toEqual({
      status: 409,
      body: expect.objectContaining({ code: "expected_version_mismatch", field: "expectedRevision" }),
    });
    const [{ count }] = await sqlClient<{ count: number }[]>`SELECT count(*)::int AS count FROM qos.inventory_item_reference_costs`;
    expect(count).toBe(1);
  });
});
