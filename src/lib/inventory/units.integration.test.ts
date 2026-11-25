import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { closeConversion, createConversion } from "@/lib/inventory/conversions";
import {
  ACTOR,
  ADMIN,
  auditActions,
  type IntegrationConnection,
  rejection,
  truncateInventory,
  USER,
} from "@/lib/inventory/integration-helpers";
import { createItem, updateItem } from "@/lib/inventory/items";
import { createUnit, getUnit, listUnits, updateUnit } from "@/lib/inventory/units";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("inventory units service", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;

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
    tenantId = (await createTenantHierarchy(db, quotesTenantFixture())).tenant.id;
  });

  it("creates a standard unit from the constants and reloads every value", async () => {
    const kg = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "kg" });
    expect(kg).toMatchObject({
      code: "kg",
      nameEn: "Kilogram",
      nameAr: "كيلوغرام",
      quantityKind: "mass",
      standardCode: "kg",
      decimalPlaces: 3,
      status: "active",
      version: 1,
      provenance: "operator_entered",
    });
    expect(kg.publicId).toMatch(/^unit_kg_[0-9a-f]{8}$/);
    const listed = await listUnits(db, tenantId);
    expect(listed.units).toEqual([kg]);
    expect(listed.standardUnits.find((unit) => unit.code === "kg")?.alreadyAdded).toBe(kg.publicId);
    expect(listed.standardUnits.find((unit) => unit.code === "g")?.alreadyAdded).toBeNull();
  });

  it("creates a custom unit with every editable value preserved on reload", async () => {
    const packet = await createUnit(db, tenantId, ADMIN, ACTOR, {
      source: "custom",
      code: "Packet",
      nameEn: "Packet",
      nameAr: "علبة",
      quantityKind: "pack",
      decimalPlaces: 2,
    });
    const reloaded = await getUnit(db, tenantId, packet.publicId);
    expect(reloaded.unit).toEqual(packet);
    expect(reloaded.unit).toMatchObject({ code: "packet", nameEn: "Packet", nameAr: "علبة", quantityKind: "pack", standardCode: null, decimalPlaces: 2 });
    expect(reloaded.usage).toEqual({ itemDesignations: 0, currentRules: 0, currentCosts: 0, recipeUsages: 0 });
    const audit = await auditActions(sql, tenantId);
    expect(audit.map((row) => [row.action, row.entity_type, row.entity_public_id])).toEqual([
      ["inventory.unit.create", "inventory_unit", packet.publicId],
    ]);
  });

  it("renames and changes precision without changing identity or code", async () => {
    const packet = await createUnit(db, tenantId, ADMIN, ACTOR, {
      source: "custom",
      code: "packet",
      nameEn: "Packet",
      nameAr: "علبة",
      quantityKind: "pack",
      decimalPlaces: 0,
    });
    const renamed = await updateUnit(db, tenantId, ADMIN, ACTOR, packet.publicId, {
      expectedVersion: 1,
      nameEn: "Sealed packet",
      nameAr: "علبة مغلقة",
      decimalPlaces: 3,
    });
    expect(renamed).toMatchObject({ publicId: packet.publicId, code: "packet", nameEn: "Sealed packet", nameAr: "علبة مغلقة", decimalPlaces: 3, version: 2 });
    expect((await getUnit(db, tenantId, packet.publicId)).unit).toEqual(renamed);
    expect(await rejection(updateUnit(db, tenantId, ADMIN, ACTOR, packet.publicId, { expectedVersion: 2, code: "pkt" }))).toEqual({
      statusCode: 400,
      code: "immutable_field",
      field: "code",
    });
    expect(
      await rejection(updateUnit(db, tenantId, ADMIN, ACTOR, packet.publicId, { expectedVersion: 2, quantityKind: "count" })),
    ).toMatchObject({ statusCode: 400, code: "immutable_field" });
    const audit = await auditActions(sql, tenantId);
    expect(audit.at(-1)).toMatchObject({
      action: "inventory.unit.update",
      change_summary: { before: { nameEn: "Packet", decimalPlaces: 0 }, after: { nameEn: "Sealed packet", decimalPlaces: 3 } },
    });
  });

  it("refuses duplicate codes and a second copy of a standard unit with 409", async () => {
    await createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "kg" });
    expect(await rejection(createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "kg" }))).toEqual({
      statusCode: 409,
      code: "standard_code_taken",
      field: "standardCode",
    });
    await createUnit(db, tenantId, ADMIN, ACTOR, { source: "custom", code: "box", nameEn: "Box", nameAr: "صندوق", quantityKind: "pack", decimalPlaces: 0 });
    expect(
      await rejection(
        createUnit(db, tenantId, ADMIN, ACTOR, { source: "custom", code: "box", nameEn: "Box 2", nameAr: "صندوق 2", quantityKind: "pack", decimalPlaces: 0 }),
      ),
    ).toEqual({ statusCode: 409, code: "unit_code_taken", field: "code" });
    expect(
      await rejection(
        createUnit(db, tenantId, ADMIN, ACTOR, { source: "custom", code: "g", nameEn: "Gram", nameAr: "غرام", quantityKind: "mass", decimalPlaces: 0 }),
      ),
    ).toMatchObject({ statusCode: 400, code: "code_reserved_for_standard" });
  });

  it("validates input with typed 400 errors", async () => {
    const base = { source: "custom", code: "cup", nameEn: "Cup", nameAr: "كوب", quantityKind: "volume", decimalPlaces: 0 };
    expect(await rejection(createUnit(db, tenantId, ADMIN, ACTOR, { ...base, code: "a b" }))).toMatchObject({ code: "code_invalid" });
    expect(await rejection(createUnit(db, tenantId, ADMIN, ACTOR, { ...base, nameAr: " " }))).toMatchObject({ code: "name_required", field: "nameAr" });
    expect(await rejection(createUnit(db, tenantId, ADMIN, ACTOR, { ...base, quantityKind: "weight" }))).toMatchObject({ code: "quantity_kind_invalid" });
    expect(await rejection(createUnit(db, tenantId, ADMIN, ACTOR, { ...base, decimalPlaces: 7 }))).toMatchObject({ code: "decimal_places_out_of_range" });
    expect(await rejection(createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "oz" }))).toMatchObject({ code: "standard_code_unknown" });
    expect((await listUnits(db, tenantId)).units).toEqual([]);
  });

  it("refuses archive while an item or current rule uses the unit, then allows it", async () => {
    const packet = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "custom", code: "packet", nameEn: "Packet", nameAr: "علبة", quantityKind: "pack", decimalPlaces: 0 });
    const piece = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "piece" });
    const created = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Buns", kind: "purchased", purchaseUnitPublicId: packet.publicId });
    expect(await rejection(updateUnit(db, tenantId, ADMIN, ACTOR, packet.publicId, { expectedVersion: 1, status: "archived" }))).toEqual({
      statusCode: 409,
      code: "unit_in_use",
      field: "status",
    });
    const cleared = await updateItem(db, tenantId, ADMIN, ACTOR, created.item.publicId, { expectedVersion: 1, purchaseUnitPublicId: null });
    const withRule = await createConversion(db, tenantId, ADMIN, ACTOR, cleared.item.publicId, {
      fromUnitPublicId: packet.publicId,
      toUnitPublicId: piece.publicId,
      factor: "12",
    });
    expect((await getUnit(db, tenantId, packet.publicId)).usage).toEqual({ itemDesignations: 0, currentRules: 1, currentCosts: 0, recipeUsages: 0 });
    expect(await rejection(updateUnit(db, tenantId, ADMIN, ACTOR, packet.publicId, { expectedVersion: 1, status: "archived" }))).toMatchObject({
      code: "unit_in_use",
    });
    await closeConversion(db, tenantId, ADMIN, ACTOR, cleared.item.publicId, withRule.rules[0]!.publicId, { expectedRevision: 1 });
    const archived = await updateUnit(db, tenantId, ADMIN, ACTOR, packet.publicId, { expectedVersion: 1, status: "archived" });
    expect(archived).toMatchObject({ status: "archived", version: 2 });
    const restored = await updateUnit(db, tenantId, ADMIN, ACTOR, packet.publicId, { expectedVersion: 2, status: "active" });
    expect(restored.status).toBe("active");
    const actions = (await auditActions(sql, tenantId)).map((row) => row.action);
    expect(actions.slice(-2)).toEqual(["inventory.unit.archive", "inventory.unit.restore"]);
  });

  it("answers 409 on a stale version and 403 for a non-administrator, writing nothing", async () => {
    const cup = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "custom", code: "cup", nameEn: "Cup", nameAr: "كوب", quantityKind: "volume", decimalPlaces: 0 });
    await updateUnit(db, tenantId, ADMIN, ACTOR, cup.publicId, { expectedVersion: 1, nameEn: "Mug" });
    expect(await rejection(updateUnit(db, tenantId, ADMIN, ACTOR, cup.publicId, { expectedVersion: 1, nameEn: "Beaker" }))).toEqual({
      statusCode: 409,
      code: "expected_version_mismatch",
      field: "expectedVersion",
    });
    expect(await rejection(updateUnit(db, tenantId, USER, ACTOR, cup.publicId, { expectedVersion: 2, nameEn: "Beaker" }))).toMatchObject({
      statusCode: 403,
      code: "administrator_required",
    });
    expect(
      await rejection(createUnit(db, tenantId, USER, ACTOR, { source: "standard", standardCode: "g" })),
    ).toMatchObject({ statusCode: 403, code: "administrator_required" });
    expect((await getUnit(db, tenantId, cup.publicId)).unit).toMatchObject({ nameEn: "Mug", version: 2 });
    expect((await listUnits(db, tenantId)).units).toHaveLength(1);
  });

  it("isolates tenants: another tenant's unit is not found and not listed", async () => {
    const kg = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "kg" });
    const otherTenant = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    expect((await listUnits(db, otherTenant)).units).toEqual([]);
    expect(await rejection(getUnit(db, otherTenant, kg.publicId))).toMatchObject({ statusCode: 404, code: "unit_not_found" });
    expect(await rejection(updateUnit(db, otherTenant, ADMIN, ACTOR, kg.publicId, { expectedVersion: 1, nameEn: "Hijack" }))).toMatchObject({
      statusCode: 404,
    });
    // The other tenant can add its own kg; codes are unique per tenant only.
    const otherKg = await createUnit(db, otherTenant, ADMIN, ACTOR, { source: "standard", standardCode: "kg" });
    expect(otherKg.publicId).not.toBe(kg.publicId);
    expect((await getUnit(db, tenantId, kg.publicId)).unit.nameEn).toBe("Kilogram");
  });
});
