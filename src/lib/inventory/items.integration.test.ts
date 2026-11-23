import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
import { createItem, getItem, listItems, updateItem } from "@/lib/inventory/items";
import { createUnit, updateUnit } from "@/lib/inventory/units";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

integrationDescribe("inventory items service", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
  let units: Record<"kg" | "g" | "packet", string>;

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
    const kg = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "kg" });
    const g = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "g" });
    const packet = await createUnit(db, tenantId, ADMIN, ACTOR, {
      source: "custom",
      code: "packet",
      nameEn: "Packet",
      nameAr: "علبة",
      quantityKind: "pack",
      decimalPlaces: 0,
    });
    units = { kg: kg.publicId, g: g.publicId, packet: packet.publicId };
  });

  it("creates an item and reloads every editable value", async () => {
    const created = await createItem(db, tenantId, ADMIN, ACTOR, {
      nameEn: "Coffee beans",
      nameAr: "حبوب القهوة",
      kind: "purchased",
      storageUnitPublicId: units.kg,
      recipeUnitPublicId: units.g,
      purchaseUnitPublicId: units.packet,
    });
    expect(created.item.publicId).toMatch(/^item_coffee-beans_[0-9a-f]{8}$/);
    const reloaded = await getItem(db, tenantId, created.item.publicId);
    expect(reloaded).toEqual(created);
    expect(reloaded.item).toMatchObject({
      nameEn: "Coffee beans",
      nameAr: "حبوب القهوة",
      kind: "purchased",
      status: "active",
      version: 1,
      storageUnitPublicId: units.kg,
      recipeUnitPublicId: units.g,
      purchaseUnitPublicId: units.packet,
    });
    // kg ↔ g resolves from the standard table; packet still needs an item rule.
    expect(reloaded.preview.status).toBe("incomplete");
    expect(reloaded.preview.pairs.map((pair) => [pair.key, pair.result.status])).toEqual([
      ["storage_recipe", "derived"],
      ["purchase_storage", "missing"],
      ["purchase_recipe", "missing"],
    ]);
    const listed = await listItems(db, tenantId);
    expect(listed.items).toEqual([
      expect.objectContaining({
        publicId: created.item.publicId,
        storageUnitCode: "kg",
        recipeUnitCode: "g",
        purchaseUnitCode: "packet",
        currentRuleCount: 0,
        previewStatus: "incomplete",
      }),
    ]);
  });

  it("edits names, kind and designations, keeps the public id on rename and clears with null", async () => {
    const created = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Bun", kind: "purchased", storageUnitPublicId: units.packet });
    const edited = await updateItem(db, tenantId, ADMIN, ACTOR, created.item.publicId, {
      expectedVersion: 1,
      nameEn: "Brioche bun",
      nameAr: "خبز بريوش",
      kind: "prepared",
      storageUnitPublicId: null,
      recipeUnitPublicId: units.g,
    });
    expect(edited.item).toMatchObject({
      publicId: created.item.publicId,
      nameEn: "Brioche bun",
      nameAr: "خبز بريوش",
      kind: "prepared",
      storageUnitPublicId: null,
      recipeUnitPublicId: units.g,
      purchaseUnitPublicId: null,
      version: 2,
    });
    expect(await getItem(db, tenantId, created.item.publicId)).toEqual(edited);
    const cleared = await updateItem(db, tenantId, ADMIN, ACTOR, created.item.publicId, { expectedVersion: 2, nameAr: "" });
    expect(cleared.item.nameAr).toBeNull();
    const audit = await auditActions(sql, tenantId);
    expect(audit.filter((row) => row.entity_type === "inventory_item").map((row) => row.action)).toEqual([
      "inventory.item.create",
      "inventory.item.update",
      "inventory.item.update",
    ]);
    expect(audit.find((row) => row.action === "inventory.item.update")?.change_summary).toMatchObject({
      before: { nameEn: "Bun", storageUnit: "packet" },
      after: { nameEn: "Brioche bun", storageUnit: null, recipeUnit: "g" },
    });
  });

  it("archives and restores an item with audit", async () => {
    const created = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Milk", kind: "purchased" });
    const archived = await updateItem(db, tenantId, ADMIN, ACTOR, created.item.publicId, { expectedVersion: 1, status: "archived" });
    expect(archived.item.status).toBe("archived");
    const restored = await updateItem(db, tenantId, ADMIN, ACTOR, created.item.publicId, { expectedVersion: 2, status: "active" });
    expect(restored.item.status).toBe("active");
    expect((await auditActions(sql, tenantId)).slice(-2).map((row) => row.action)).toEqual([
      "inventory.item.archive",
      "inventory.item.restore",
    ]);
  });

  it("validates input and refuses archived or unknown units", async () => {
    expect(await rejection(createItem(db, tenantId, ADMIN, ACTOR, { nameEn: " ", kind: "purchased" }))).toMatchObject({
      statusCode: 400,
      code: "name_required",
    });
    expect(await rejection(createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Salt", kind: "ingredient" }))).toMatchObject({
      statusCode: 400,
      code: "kind_invalid",
    });
    expect(
      await rejection(createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Salt", kind: "purchased", storageUnitPublicId: "unit_nope_00000000" })),
    ).toEqual({ statusCode: 404, code: "unit_not_found", field: "storageUnitPublicId" });
    await updateUnit(db, tenantId, ADMIN, ACTOR, units.g, { expectedVersion: 1, status: "archived" });
    expect(
      await rejection(createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Salt", kind: "purchased", recipeUnitPublicId: units.g })),
    ).toMatchObject({ statusCode: 400, code: "unit_archived", field: "recipeUnitPublicId" });
    expect((await listItems(db, tenantId)).items).toEqual([]);
  });

  it("answers 409 on a stale version and 403 for a user-role member", async () => {
    const created = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Sugar", kind: "purchased" });
    await updateItem(db, tenantId, ADMIN, ACTOR, created.item.publicId, { expectedVersion: 1, nameEn: "Cane sugar" });
    expect(await rejection(updateItem(db, tenantId, ADMIN, ACTOR, created.item.publicId, { expectedVersion: 1, nameEn: "Beet sugar" }))).toMatchObject({
      statusCode: 409,
      code: "expected_version_mismatch",
    });
    expect(await rejection(createItem(db, tenantId, USER, ACTOR, { nameEn: "Tea", kind: "purchased" }))).toMatchObject({
      statusCode: 403,
      code: "administrator_required",
    });
    expect((await getItem(db, tenantId, created.item.publicId)).item.nameEn).toBe("Cane sugar");
  });

  it("isolates tenants: another tenant's unit or item public id is 404", async () => {
    const created = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Flour", kind: "purchased" });
    const other = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    expect(await rejection(getItem(db, other, created.item.publicId))).toMatchObject({ statusCode: 404, code: "item_not_found" });
    expect(
      await rejection(createItem(db, other, ADMIN, ACTOR, { nameEn: "Flour", kind: "purchased", storageUnitPublicId: units.kg })),
    ).toMatchObject({ statusCode: 404, code: "unit_not_found" });
    expect((await listItems(db, other)).items).toEqual([]);
  });
});
