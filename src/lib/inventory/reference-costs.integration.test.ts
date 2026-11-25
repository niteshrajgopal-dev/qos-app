import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { createConversion } from "@/lib/inventory/conversions";
import {
  ACTOR,
  ADMIN,
  auditActions,
  type IntegrationConnection,
  rejection,
  truncateInventory,
  USER,
} from "@/lib/inventory/integration-helpers";
import { createItem, getItem, type ItemDetailView, listItems, updateItem } from "@/lib/inventory/items";
import { closeReferenceCost, setReferenceCost, updateReferenceCost } from "@/lib/inventory/reference-costs";
import { createUnit, getUnit, updateUnit } from "@/lib/inventory/units";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

// 10:00 in Dubai on 2026-11-24.
const NOW = new Date("2026-11-24T06:00:00Z");

integrationDescribe("inventory item reference costs service", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
  let units: Record<"kg" | "g" | "ml" | "packet", string>;

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
    const ml = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "ml" });
    const packet = await createUnit(db, tenantId, ADMIN, ACTOR, {
      source: "custom",
      code: "packet",
      nameEn: "Packet",
      nameAr: "علبة",
      quantityKind: "pack",
      decimalPlaces: 0,
    });
    units = { kg: kg.publicId, g: g.publicId, ml: ml.publicId, packet: packet.publicId };
  });

  async function flour(overrides: Record<string, unknown> = {}) {
    return createItem(db, tenantId, ADMIN, ACTOR, {
      nameEn: "Flour",
      kind: "purchased",
      storageUnitPublicId: units.kg,
      recipeUnitPublicId: units.g,
      purchaseUnitPublicId: units.packet,
      ...overrides,
    });
  }

  const set = (itemPublicId: string, body: Record<string, unknown>, now = NOW) =>
    setReferenceCost(db, tenantId, ADMIN, ACTOR, itemPublicId, body, now);

  async function costRows(itemPublicId: string) {
    return sql<
      {
        public_id: string;
        amount_micros: string;
        currency: string;
        unit_code: string;
        tax_basis: string;
        source: string;
        source_reference: string | null;
        effective_from: string;
        effective_to: string | null;
        revision: number;
        created_by_subject: string;
      }[]
    >`
      SELECT c.public_id, c.amount_micros::text, c.currency, u.code AS unit_code, c.tax_basis, c.source, c.source_reference,
             c.effective_from::text, c.effective_to::text, c.revision, c.created_by_subject
      FROM qos.inventory_item_reference_costs c
      JOIN qos.inventory_items i ON i.id = c.item_id
      JOIN qos.inventory_units u ON u.id = c.unit_id
      WHERE i.public_id = ${itemPublicId} ORDER BY c.revision`;
  }

  it("stores an exact amount beyond cents with currency, unit, basis, source, reference and date, and reloads it", async () => {
    const item = await flour();
    const detail = await set(item.item.publicId, {
      amount: "12.345678",
      taxBasis: "gross",
      source: "supplier_quote",
      sourceReference: "Q-2026-117",
      effectiveFrom: "2026-11-20",
      expectedRevision: null,
    });
    expect(detail.referenceCost).toMatchObject({
      status: "known",
      amount: "12.345678",
      amountMicros: "12345678",
      currency: "AED",
      taxBasis: "gross",
      source: "supplier_quote",
      sourceReference: "Q-2026-117",
      effectiveFrom: "2026-11-20",
      revision: 1,
      unit: { publicId: units.kg, code: "kg" },
      perStorageUnit: { status: "derived", text: "12.345678", rounded: false },
      // 12.345678 AED per kg is exactly 0.012345678 per g: rounded for display to 6 places, and flagged.
      perRecipeUnit: { status: "derived", text: "0.012346", rounded: true, places: 6 },
    });
    expect(detail.costHistory).toEqual([
      expect.objectContaining({
        amount: "12.345678",
        amountMicros: "12345678",
        currency: "AED",
        unitPublicId: units.kg,
        unitCode: "kg",
        effectiveFrom: "2026-11-20",
        effectiveTo: null,
        revision: 1,
        current: true,
        provenance: "operator_entered",
      }),
    ]);
    expect(await getItem(db, tenantId, item.item.publicId)).toEqual(detail);
    expect(await costRows(item.item.publicId)).toEqual([
      expect.objectContaining({
        amount_micros: "12345678",
        currency: "AED",
        unit_code: "kg",
        tax_basis: "gross",
        source: "supplier_quote",
        source_reference: "Q-2026-117",
        effective_from: "2026-11-20",
        effective_to: null,
        revision: 1,
        created_by_subject: ACTOR,
      }),
    ]);
    const [summary] = (await listItems(db, tenantId)).items;
    expect(summary).toMatchObject({ costStatus: "known", costSummary: { amount: "12.345678", currency: "AED", unitCode: "kg" } });
    const audit = (await auditActions(sql, tenantId)).filter((row) => row.entity_type === "inventory_item_reference_cost");
    expect(audit).toEqual([
      expect.objectContaining({
        action: "inventory.reference_cost.create",
        entity_public_id: item.item.publicId,
        change_summary: {
          costPublicId: detail.costHistory[0]!.publicId,
          before: null,
          after: {
            costPublicId: detail.costHistory[0]!.publicId,
            amount: "12.345678",
            amountMicros: "12345678",
            currency: "AED",
            unit: "kg",
            taxBasis: "gross",
            source: "supplier_quote",
            sourceReference: "Q-2026-117",
            effectiveFrom: "2026-11-20",
            effectiveTo: null,
            revision: 1,
          },
        },
      }),
    ]);
  });

  it("defaults the unit to the storage unit, the currency to the business currency and the date to today in the business time zone", async () => {
    const item = await flour();
    const detail = await set(item.item.publicId, { amount: "3", taxBasis: "unconfirmed", source: "manual", expectedRevision: null });
    expect(detail.referenceCost).toMatchObject({
      status: "known",
      currency: "AED",
      unit: { code: "kg" },
      effectiveFrom: "2026-11-24",
      taxBasis: "unconfirmed",
    });
    const lowerCase = await set(item.item.publicId, {
      amount: "4",
      currency: "aed",
      taxBasis: "net",
      source: "manual",
      expectedRevision: 1,
    });
    expect(lowerCase.referenceCost).toMatchObject({ currency: "AED", amount: "4", revision: 2 });
  });

  it("keeps an explicit zero as a known zero and never stores a blank as zero", async () => {
    const item = await flour();
    expect(await rejection(set(item.item.publicId, { amount: "", taxBasis: "net", source: "manual", expectedRevision: null }))).toEqual({
      statusCode: 400,
      code: "amount_required",
      field: "amount",
    });
    expect(await rejection(set(item.item.publicId, { taxBasis: "net", source: "manual", expectedRevision: null }))).toMatchObject({
      code: "amount_required",
    });
    expect(await rejection(set(item.item.publicId, { amount: "1.2345678", taxBasis: "net", source: "manual", expectedRevision: null }))).toMatchObject({
      statusCode: 400,
      code: "amount_too_precise",
    });
    expect(await costRows(item.item.publicId)).toEqual([]);
    expect((await getItem(db, tenantId, item.item.publicId)).referenceCost).toEqual({ status: "unknown" });

    const zero = await set(item.item.publicId, { amount: "0", taxBasis: "net", source: "manual", expectedRevision: null });
    expect(zero.referenceCost).toMatchObject({
      status: "known",
      amount: "0",
      amountMicros: "0",
      perStorageUnit: { status: "derived", text: "0" },
      perRecipeUnit: { status: "derived", text: "0" },
    });
    expect((await listItems(db, tenantId)).items[0]).toMatchObject({ costStatus: "known", costSummary: { amount: "0" } });
  });

  it("revises by closing the current row and inserting the next revision, leaving the old row's values untouched", async () => {
    const item = await flour();
    const first = await set(item.item.publicId, {
      amount: "10.5",
      taxBasis: "net",
      source: "invoice",
      sourceReference: "INV-1",
      effectiveFrom: "2026-11-01",
      expectedRevision: null,
    });
    const before = (await costRows(item.item.publicId))[0]!;
    const revised = await set(item.item.publicId, {
      amount: "11.25",
      unitPublicId: units.packet,
      taxBasis: "gross",
      source: "supplier_quote",
      effectiveFrom: "2026-11-15",
      expectedRevision: 1,
    });
    expect(revised.costHistory.map((row) => [row.revision, row.amount, row.unitCode, row.effectiveFrom, row.effectiveTo, row.current])).toEqual([
      [2, "11.25", "packet", "2026-11-15", null, true],
      [1, "10.5", "kg", "2026-11-01", "2026-11-15", false],
    ]);
    const rows = await costRows(item.item.publicId);
    expect(rows[0]).toEqual({ ...before, effective_to: "2026-11-15" });
    expect(rows[0]!.public_id).toBe(first.costHistory[0]!.publicId);
    // The current cost is per packet; without a packet rule it cannot be expressed per kg or g.
    expect(revised.referenceCost).toMatchObject({ status: "known_not_convertible", amount: "11.25", revision: 2 });

    // The application role cannot rewrite a stored amount, even on its own tenant's row.
    await expect(
      sql.begin(async (tx) => {
        await tx.unsafe("SET LOCAL ROLE qos_app");
        await tx`SELECT set_config('qos.current_tenant_id', ${tenantId}, true)`;
        await tx`UPDATE qos.inventory_item_reference_costs SET amount_micros = 1 WHERE public_id = ${before.public_id}`;
      }),
    ).rejects.toThrow(/permission denied/);
    expect((await costRows(item.item.publicId))[0]!.amount_micros).toBe("10500000");

    const audit = (await auditActions(sql, tenantId)).filter((row) => row.entity_type === "inventory_item_reference_cost");
    expect(audit.map((row) => row.action)).toEqual(["inventory.reference_cost.create", "inventory.reference_cost.revise"]);
    expect(audit[1]!.change_summary).toMatchObject({
      before: { amount: "10.5", revision: 1, effectiveTo: "2026-11-15" },
      after: { amount: "11.25", unit: "packet", revision: 2, effectiveTo: null },
    });
  });

  it("refuses an earlier date than the current version and a stale expected revision, writing nothing", async () => {
    const item = await flour();
    await set(item.item.publicId, { amount: "5", taxBasis: "net", source: "manual", effectiveFrom: "2026-11-10", expectedRevision: null });
    expect(
      await rejection(set(item.item.publicId, { amount: "6", taxBasis: "net", source: "manual", effectiveFrom: "2026-11-09", expectedRevision: 1 })),
    ).toEqual({ statusCode: 400, code: "effective_from_before_current", field: "effectiveFrom" });
    expect(await rejection(set(item.item.publicId, { amount: "6", taxBasis: "net", source: "manual", expectedRevision: null }))).toEqual({
      statusCode: 409,
      code: "expected_version_mismatch",
      field: "expectedRevision",
    });
    expect(await rejection(set(item.item.publicId, { amount: "6", taxBasis: "net", source: "manual", expectedRevision: 3 }))).toMatchObject({
      statusCode: 409,
      code: "expected_version_mismatch",
    });
    const fresh = await flour({ nameEn: "Sugar" });
    expect(await rejection(set(fresh.item.publicId, { amount: "6", taxBasis: "net", source: "manual", expectedRevision: 1 }))).toMatchObject({
      statusCode: 409,
      code: "expected_version_mismatch",
    });
    expect((await costRows(item.item.publicId)).map((row) => [row.revision, row.amount_micros, row.effective_to])).toEqual([[1, "5000000", null]]);
    expect(await costRows(fresh.item.publicId)).toEqual([]);
  });

  it("clears a cost back to unknown, keeps the history and starts the next set at the following revision", async () => {
    const item = await flour();
    const first = await set(item.item.publicId, { amount: "8", taxBasis: "net", source: "manual", effectiveFrom: "2026-11-01", expectedRevision: null });
    const second = await set(item.item.publicId, { amount: "9", taxBasis: "net", source: "manual", effectiveFrom: "2026-11-10", expectedRevision: 1 });
    const currentId = second.costHistory[0]!.publicId;
    expect(
      await rejection(
        closeReferenceCost(db, tenantId, ADMIN, ACTOR, item.item.publicId, first.costHistory[0]!.publicId, { expectedRevision: 1 }, NOW),
      ),
    ).toEqual({ statusCode: 409, code: "reference_cost_not_current", field: "costPublicId" });
    expect(
      await rejection(closeReferenceCost(db, tenantId, ADMIN, ACTOR, item.item.publicId, currentId, { expectedRevision: 1 }, NOW)),
    ).toMatchObject({ statusCode: 409, code: "expected_version_mismatch" });
    expect(
      await rejection(
        closeReferenceCost(db, tenantId, ADMIN, ACTOR, item.item.publicId, currentId, { expectedRevision: 2, effectiveFrom: "2026-11-05" }, NOW),
      ),
    ).toMatchObject({ statusCode: 400, code: "effective_from_before_current" });
    expect(
      await rejection(updateReferenceCost(db, tenantId, ADMIN, ACTOR, item.item.publicId, currentId, { operation: "revise", expectedRevision: 2 })),
    ).toEqual({ statusCode: 400, code: "operation_invalid", field: "operation" });

    const cleared = await updateReferenceCost(db, tenantId, ADMIN, ACTOR, item.item.publicId, currentId, {
      operation: "close",
      expectedRevision: 2,
      effectiveFrom: "2026-11-20",
    });
    expect(cleared.referenceCost).toEqual({ status: "unknown" });
    expect(cleared.costHistory.map((row) => [row.revision, row.amount, row.effectiveTo, row.current])).toEqual([
      [2, "9", "2026-11-20", false],
      [1, "8", "2026-11-10", false],
    ]);
    expect((await listItems(db, tenantId)).items[0]).toMatchObject({ costStatus: "unknown", costSummary: null });
    expect(
      await rejection(closeReferenceCost(db, tenantId, ADMIN, ACTOR, item.item.publicId, currentId, { expectedRevision: 2 }, NOW)),
    ).toMatchObject({ statusCode: 409, code: "reference_cost_not_current" });
    // Without a date the next cost starts today; never before the cleared version ended.
    expect(
      await rejection(set(item.item.publicId, { amount: "7", taxBasis: "net", source: "manual", effectiveFrom: "2026-11-19", expectedRevision: null })),
    ).toMatchObject({ code: "effective_from_before_current" });
    const third = await set(item.item.publicId, { amount: "7", taxBasis: "net", source: "manual", expectedRevision: null });
    expect(third.referenceCost).toMatchObject({ status: "known", amount: "7", revision: 3, effectiveFrom: "2026-11-24" });
    expect(third.costHistory).toHaveLength(3);
    const actions = (await auditActions(sql, tenantId))
      .filter((row) => row.entity_type === "inventory_item_reference_cost")
      .map((row) => row.action);
    expect(actions).toEqual([
      "inventory.reference_cost.create",
      "inventory.reference_cost.revise",
      "inventory.reference_cost.close",
      "inventory.reference_cost.create",
    ]);
  });

  it("refuses cost writes on an archived item and keeps its current cost readable", async () => {
    const item = await flour();
    const costed = await set(item.item.publicId, { amount: "2", taxBasis: "net", source: "manual", expectedRevision: null });
    const archived = await updateItem(db, tenantId, ADMIN, ACTOR, item.item.publicId, { expectedVersion: 1, status: "archived" });
    expect(archived.referenceCost).toEqual(costed.referenceCost);
    expect(await rejection(set(item.item.publicId, { amount: "3", taxBasis: "net", source: "manual", expectedRevision: 1 }))).toEqual({
      statusCode: 409,
      code: "item_archived",
      field: "itemPublicId",
    });
    expect(
      await rejection(
        closeReferenceCost(db, tenantId, ADMIN, ACTOR, item.item.publicId, costed.costHistory[0]!.publicId, { expectedRevision: 1 }, NOW),
      ),
    ).toMatchObject({ statusCode: 409, code: "item_archived" });
    expect((await costRows(item.item.publicId)).map((row) => row.effective_to)).toEqual([null]);
  });

  it("accepts only the item's designated, active units and the business currency", async () => {
    const item = await flour();
    expect(
      await rejection(set(item.item.publicId, { amount: "1", unitPublicId: units.ml, taxBasis: "net", source: "manual", expectedRevision: null })),
    ).toEqual({ statusCode: 400, code: "cost_unit_not_designated", field: "unitPublicId" });
    const bare = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Salt", kind: "purchased" });
    expect(await rejection(set(bare.item.publicId, { amount: "1", taxBasis: "net", source: "manual", expectedRevision: null }))).toMatchObject({
      statusCode: 400,
      code: "cost_unit_not_designated",
    });
    expect(
      await rejection(set(item.item.publicId, { amount: "1", currency: "USD", taxBasis: "net", source: "manual", expectedRevision: null })),
    ).toEqual({ statusCode: 400, code: "currency_not_supported", field: "currency" });

    // A designated unit that has since been archived is refused.
    const jar = await createUnit(db, tenantId, ADMIN, ACTOR, {
      source: "custom",
      code: "jar",
      nameEn: "Jar",
      nameAr: "برطمان",
      quantityKind: "pack",
      decimalPlaces: 0,
    });
    const honey = await createItem(db, tenantId, ADMIN, ACTOR, {
      nameEn: "Honey",
      kind: "purchased",
      storageUnitPublicId: units.kg,
      purchaseUnitPublicId: jar.publicId,
    });
    await updateItem(db, tenantId, ADMIN, ACTOR, honey.item.publicId, { expectedVersion: 1, status: "archived" });
    await updateUnit(db, tenantId, ADMIN, ACTOR, jar.publicId, { expectedVersion: 1, status: "archived" });
    await updateItem(db, tenantId, ADMIN, ACTOR, honey.item.publicId, { expectedVersion: 2, status: "active" });
    expect(
      await rejection(set(honey.item.publicId, { amount: "1", unitPublicId: jar.publicId, taxBasis: "net", source: "manual", expectedRevision: null })),
    ).toEqual({ statusCode: 400, code: "unit_archived", field: "unitPublicId" });
    expect(await costRows(item.item.publicId)).toEqual([]);
    expect(await costRows(honey.item.publicId)).toEqual([]);
  });

  it("refuses another business's item, unit and cost ids with 404", async () => {
    const otherTenantId = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    const theirUnit = await createUnit(db, otherTenantId, ADMIN, ACTOR, { source: "standard", standardCode: "kg" });
    const theirItem = await createItem(db, otherTenantId, ADMIN, ACTOR, {
      nameEn: "Roses",
      kind: "purchased",
      storageUnitPublicId: theirUnit.publicId,
    });
    const theirCost = await setReferenceCost(db, otherTenantId, ADMIN, ACTOR, theirItem.item.publicId, {
      amount: "4",
      taxBasis: "net",
      source: "manual",
      expectedRevision: null,
    });
    expect(await rejection(set(theirItem.item.publicId, { amount: "1", taxBasis: "net", source: "manual", expectedRevision: null }))).toEqual({
      statusCode: 404,
      code: "item_not_found",
      field: "itemPublicId",
    });
    const item = await flour();
    expect(
      await rejection(set(item.item.publicId, { amount: "1", unitPublicId: theirUnit.publicId, taxBasis: "net", source: "manual", expectedRevision: null })),
    ).toEqual({ statusCode: 404, code: "unit_not_found", field: "unitPublicId" });
    expect(
      await rejection(
        closeReferenceCost(db, tenantId, ADMIN, ACTOR, item.item.publicId, theirCost.costHistory[0]!.publicId, { expectedRevision: 1 }, NOW),
      ),
    ).toEqual({ statusCode: 404, code: "reference_cost_not_found", field: "costPublicId" });
    expect(await costRows(item.item.publicId)).toEqual([]);
    expect((await getItem(db, otherTenantId, theirItem.item.publicId)).referenceCost).toMatchObject({ status: "known", amount: "4" });
  });

  it("answers 403 to a user-role member on set and clear", async () => {
    const item = await flour();
    const costed = await set(item.item.publicId, { amount: "2", taxBasis: "net", source: "manual", expectedRevision: null });
    expect(
      await rejection(setReferenceCost(db, tenantId, USER, ACTOR, item.item.publicId, { amount: "3", taxBasis: "net", source: "manual", expectedRevision: 1 })),
    ).toEqual({ statusCode: 403, code: "administrator_required", field: undefined });
    expect(
      await rejection(
        updateReferenceCost(db, tenantId, USER, ACTOR, item.item.publicId, costed.costHistory[0]!.publicId, { operation: "close", expectedRevision: 1 }),
      ),
    ).toMatchObject({ statusCode: 403, code: "administrator_required" });
    expect(await costRows(item.item.publicId)).toHaveLength(1);
  });

  it("refuses to archive a unit that a current cost is priced in, until the cost is cleared", async () => {
    const item = await flour();
    const costed = await set(item.item.publicId, {
      amount: "6",
      unitPublicId: units.packet,
      taxBasis: "net",
      source: "manual",
      expectedRevision: null,
    });
    // The item no longer designates the packet, but its current cost is still per packet.
    await updateItem(db, tenantId, ADMIN, ACTOR, item.item.publicId, { expectedVersion: 1, purchaseUnitPublicId: null });
    expect((await getUnit(db, tenantId, units.packet)).usage).toEqual({ itemDesignations: 0, currentRules: 0, currentCosts: 1 });
    expect(await rejection(updateUnit(db, tenantId, ADMIN, ACTOR, units.packet, { expectedVersion: 1, status: "archived" }))).toEqual({
      statusCode: 409,
      code: "unit_in_use",
      field: "status",
    });
    await closeReferenceCost(db, tenantId, ADMIN, ACTOR, item.item.publicId, costed.costHistory[0]!.publicId, { expectedRevision: 1 }, NOW);
    expect((await getUnit(db, tenantId, units.packet)).usage.currentCosts).toBe(0);
    const archived = await updateUnit(db, tenantId, ADMIN, ACTOR, units.packet, { expectedVersion: 1, status: "archived" });
    expect(archived.status).toBe("archived");
    // History still names the archived unit.
    expect((await getItem(db, tenantId, item.item.publicId)).costHistory[0]).toMatchObject({ unitCode: "packet", current: false });
  });

  it("expresses the cost per storage and recipe unit through the item's own rules only", async () => {
    const item = await flour();
    await createConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, {
      fromUnitPublicId: units.packet,
      toUnitPublicId: units.kg,
      factor: "0.5",
    });
    const detail: ItemDetailView = await set(item.item.publicId, {
      amount: "6",
      unitPublicId: units.packet,
      taxBasis: "net",
      source: "manual",
      expectedRevision: null,
    });
    expect(detail.referenceCost).toMatchObject({
      status: "known",
      perStorageUnit: { status: "derived", text: "12", rounded: false, path: [{ fromCode: "packet", toCode: "kg", source: "item_rule" }] },
      perRecipeUnit: { status: "derived", text: "0.012", rounded: false },
    });
    // Another item priced per packet does not borrow the first item's packet rule.
    const sugar = await flour({ nameEn: "Sugar" });
    const other = await set(sugar.item.publicId, {
      amount: "6",
      unitPublicId: units.packet,
      taxBasis: "net",
      source: "manual",
      expectedRevision: null,
    });
    expect(other.referenceCost).toMatchObject({
      status: "known_not_convertible",
      amount: "6",
      perStorageUnit: { status: "missing", reason: "pack_needs_item_rule" },
      perRecipeUnit: { status: "missing", reason: "pack_needs_item_rule" },
    });
    const statuses = (await listItems(db, tenantId)).items.map((entry) => [entry.nameEn, entry.costStatus]);
    expect(statuses).toEqual([
      ["Flour", "known"],
      ["Sugar", "known_not_convertible"],
    ]);
  });
});
