import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { staffIdentities, staffMemberships } from "@/db/schema";
import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { StaffAuthError } from "@/lib/staff/session";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

import { PATCH as patchConversion } from "./items/[itemPublicId]/conversions/[conversionPublicId]/route";
import { POST as postConversion } from "./items/[itemPublicId]/conversions/route";
import { GET as getItem, PATCH as patchItem } from "./items/[itemPublicId]/route";
import { GET as listItems, POST as postItem } from "./items/route";
import { GET as getUnit, PATCH as patchUnit } from "./units/[unitPublicId]/route";
import { GET as listUnits, POST as postUnit } from "./units/route";

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
    await sqlClient`TRUNCATE TABLE qos.tenant_audit_events, qos.inventory_item_conversions, qos.inventory_items, qos.inventory_units, qos.staff_memberships, qos.staff_identities, qos.locations, qos.brands, qos.organizations, qos.tenants RESTART IDENTITY CASCADE`;
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
      usage: { itemDesignations: 1, currentRules: 0 },
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
    expect(Object.keys(withRule.body).sort()).toEqual(["history", "item", "preview", "rules", "units"]);
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
});
