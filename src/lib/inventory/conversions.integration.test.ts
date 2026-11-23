import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate, runAsRole } from "@/db/test-utils";
import { closeConversion, createConversion, reviseConversion, updateConversion } from "@/lib/inventory/conversions";
import { previewSentences } from "@/lib/inventory/conversion-preview";
import {
  ACTOR,
  ADMIN,
  auditActions,
  type IntegrationConnection,
  rejection,
  truncateInventory,
  USER,
} from "@/lib/inventory/integration-helpers";
import { createItem, getItem, type ItemDetailView, updateItem } from "@/lib/inventory/items";
import { createUnit } from "@/lib/inventory/units";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

type UnitCode = "kg" | "g" | "ml" | "piece" | "packet" | "box" | "batch";

integrationDescribe("inventory item conversions service", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
  let units: Record<UnitCode, string>;

  beforeAll(async () => {
    const connection = await resetAndMigrate();
    db = connection.db;
    sql = connection.sql;
    await grantRoleMembership(sql, "qos", "qos_app");
  }, 120_000);

  afterAll(async () => {
    await sql.end({ timeout: 5 });
  });

  async function seedUnits(target: string) {
    const result = {} as Record<UnitCode, string>;
    for (const code of ["kg", "g", "ml", "piece"] as const) {
      result[code] = (await createUnit(db, target, ADMIN, ACTOR, { source: "standard", standardCode: code })).publicId;
    }
    for (const code of ["packet", "box", "batch"] as const) {
      result[code] = (
        await createUnit(db, target, ADMIN, ACTOR, {
          source: "custom",
          code,
          nameEn: code,
          nameAr: { packet: "علبة", box: "صندوق", batch: "دفعة" }[code],
          quantityKind: "pack",
          decimalPlaces: 3,
        })
      ).publicId;
    }
    return result;
  }

  beforeEach(async () => {
    await truncateInventory(sql);
    tenantId = (await createTenantHierarchy(db, quotesTenantFixture())).tenant.id;
    units = await seedUnits(tenantId);
  });

  const newItem = (nameEn: string, extra: Record<string, unknown> = {}) =>
    createItem(db, tenantId, ADMIN, ACTOR, { nameEn, kind: "purchased", ...extra });
  const addRule = (item: ItemDetailView, from: UnitCode, to: UnitCode, factor: string, extra: Record<string, unknown> = {}) =>
    createConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, {
      fromUnitPublicId: units[from],
      toUnitPublicId: units[to],
      factor,
      ...extra,
    });

  it("creates a rule and reloads the exact factor and every value", async () => {
    const item = await newItem("Coffee beans", {
      storageUnitPublicId: units.kg,
      recipeUnitPublicId: units.g,
      purchaseUnitPublicId: units.packet,
    });
    const created = await addRule(item, "packet", "kg", "0.25", { effectiveFrom: "2026-11-01" });
    const reloaded = await getItem(db, tenantId, item.item.publicId);
    expect(reloaded).toEqual(created);
    expect(reloaded.rules).toEqual([
      expect.objectContaining({
        fromCode: "packet",
        toCode: "kg",
        factor: "0.25",
        factorMicros: "250000",
        justification: null,
        effectiveFrom: "2026-11-01",
        effectiveTo: null,
        revision: 1,
        current: true,
        provenance: "operator_entered",
      }),
    ]);
    expect(reloaded.rules[0]!.publicId).toMatch(/^conv_[0-9a-f]{20}$/);
    expect(reloaded.preview.status).toBe("complete");
    const receipt = reloaded.preview.pairs.find((pair) => pair.key === "purchase_storage")!;
    expect(previewSentences("en", receipt)?.example).toBe("A receipt of 2 packet adds 0.500 kg to stock.");
    const [row] = await sql<{ factor_micros: string }[]>`
      SELECT factor_micros::text FROM qos.inventory_item_conversions WHERE public_id = ${reloaded.rules[0]!.publicId}`;
    expect(row?.factor_micros).toBe("250000");
  });

  it("revises into a new dated version, keeps revision 1 readable and closed, and audits both", async () => {
    const item = await newItem("Buns", { storageUnitPublicId: units.piece, purchaseUnitPublicId: units.packet });
    const first = await addRule(item, "packet", "piece", "12", { effectiveFrom: "2026-11-01" });
    const ruleId = first.rules[0]!.publicId;
    const revised = await reviseConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, ruleId, {
      expectedRevision: 1,
      factor: "10",
      effectiveFrom: "2026-11-20",
    });
    expect(revised.rules).toEqual([
      expect.objectContaining({ factor: "10", revision: 2, effectiveFrom: "2026-11-20", effectiveTo: null, current: true }),
    ]);
    expect(revised.history.map((row) => [row.revision, row.factor, row.effectiveFrom, row.effectiveTo, row.current])).toEqual([
      [2, "10", "2026-11-20", null, true],
      [1, "12", "2026-11-01", "2026-11-20", false],
    ]);
    // The closed version row is the same row, unchanged apart from effective_to.
    expect(revised.history[1]!.publicId).toBe(ruleId);
    expect(await getItem(db, tenantId, item.item.publicId)).toEqual(revised);
    const audit = (await auditActions(sql, tenantId)).filter((row) => row.entity_type === "inventory_item_conversion");
    expect(audit.map((row) => row.action)).toEqual(["inventory.conversion.create", "inventory.conversion.revise"]);
    expect(audit[1]!.entity_public_id).toBe(item.item.publicId);
    expect(audit[1]!.change_summary).toMatchObject({
      before: { factor: "12", revision: 1, effectiveTo: "2026-11-20" },
      after: { factor: "10", revision: 2, effectiveFrom: "2026-11-20" },
    });
  });

  it("refuses a revision dated before the current version, a stale revision and a closed version", async () => {
    const item = await newItem("Buns");
    const first = await addRule(item, "packet", "piece", "12", { effectiveFrom: "2026-11-10" });
    const ruleId = first.rules[0]!.publicId;
    expect(
      await rejection(
        reviseConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, ruleId, { expectedRevision: 1, factor: "10", effectiveFrom: "2026-11-09" }),
      ),
    ).toEqual({ statusCode: 400, code: "effective_from_before_current", field: "effectiveFrom" });
    expect(
      await rejection(reviseConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, ruleId, { expectedRevision: 2, factor: "10" })),
    ).toMatchObject({ statusCode: 409, code: "expected_version_mismatch" });
    const revised = await reviseConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, ruleId, {
      expectedRevision: 1,
      factor: "10",
      effectiveFrom: "2026-11-12",
    });
    expect(
      await rejection(reviseConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, ruleId, { expectedRevision: 1, factor: "11" })),
    ).toMatchObject({ statusCode: 409, code: "conversion_not_current" });
    expect(
      await rejection(reviseConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, "conv_00000000000000000000", { expectedRevision: 1, factor: "11" })),
    ).toMatchObject({ statusCode: 404, code: "conversion_not_found" });
    expect(
      await rejection(
        reviseConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, revised.rules[0]!.publicId, { expectedRevision: 2, factor: "0" }),
      ),
    ).toMatchObject({ statusCode: 400, code: "factor_not_positive" });
    expect((await getItem(db, tenantId, item.item.publicId)).history.map((row) => row.factor)).toEqual(["10", "12"]);
  });

  it("closes a rule without a successor, keeps history, and lets the pair start again later", async () => {
    const item = await newItem("Buns");
    const first = await addRule(item, "packet", "piece", "12", { effectiveFrom: "2026-11-01" });
    const closed = await closeConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, first.rules[0]!.publicId, {
      expectedRevision: 1,
      effectiveFrom: "2026-11-15",
    });
    expect(closed.rules).toEqual([]);
    expect(closed.history).toEqual([expect.objectContaining({ revision: 1, factor: "12", effectiveTo: "2026-11-15", current: false })]);
    expect(await rejection(addRule(item, "packet", "piece", "10", { effectiveFrom: "2026-11-14" }))).toMatchObject({
      statusCode: 400,
      code: "effective_from_before_current",
    });
    const again = await addRule(item, "packet", "piece", "10", { effectiveFrom: "2026-11-15" });
    expect(again.rules).toEqual([expect.objectContaining({ revision: 2, factor: "10", current: true })]);
    expect(again.history).toHaveLength(2);
    expect((await auditActions(sql, tenantId)).map((row) => row.action)).toContain("inventory.conversion.close");
  });

  it("rejects zero, negative, same-unit, standard, circular, conflicting and unjustified mass-volume rules", async () => {
    const item = await newItem("Syrup");
    const cases: Array<[UnitCode, UnitCode, string, Record<string, unknown>, number, string]> = [
      ["packet", "piece", "0", {}, 400, "factor_not_positive"],
      ["packet", "piece", "-12", {}, 400, "factor_not_positive"],
      ["packet", "piece", "1e3", {}, 400, "factor_invalid"],
      ["packet", "piece", "1.0000001", {}, 400, "factor_too_precise"],
      ["packet", "packet", "1", {}, 400, "same_unit"],
      ["kg", "g", "1000", {}, 400, "standard_pair_not_overridable"],
      ["g", "ml", "1.4", {}, 400, "justification_required"],
    ];
    for (const [from, to, factor, extra, status, code] of cases) {
      expect(await rejection(addRule(item, from, to, factor, extra)), `${from}->${to} ${factor}`).toMatchObject({ statusCode: status, code });
    }
    await addRule(item, "packet", "box", "2");
    await addRule(item, "box", "piece", "6");
    expect(await rejection(addRule(item, "packet", "box", "3"))).toMatchObject({ statusCode: 409, code: "duplicate_pair" });
    expect(await rejection(addRule(item, "box", "packet", "0.5"))).toMatchObject({ statusCode: 409, code: "duplicate_pair" });
    // Circular: piece → packet would close packet → box → piece.
    expect(await rejection(addRule(item, "piece", "packet", "0.083333"))).toMatchObject({ statusCode: 409, code: "already_derivable" });
    // Conflicting: a different packet → piece factor is refused the same way.
    expect(await rejection(addRule(item, "packet", "piece", "10"))).toMatchObject({ statusCode: 409, code: "already_derivable" });
    const unchanged = await getItem(db, tenantId, item.item.publicId);
    expect(unchanged.rules.map((rule) => `${rule.fromCode}->${rule.toCode}=${rule.factor}`).sort()).toEqual([
      "box->piece=6",
      "packet->box=2",
    ]);
  });

  it("relates mass and volume only through an explicit, justified item rule", async () => {
    const honey = await newItem("Honey", { storageUnitPublicId: units.kg, recipeUnitPublicId: units.ml });
    expect(honey.preview.pairs[0]!.result).toEqual({ status: "missing", reason: "mass_volume_needs_item_rule" });
    // A similarly named item with a density rule does not lend it to honey.
    const honeySyrup = await newItem("Honey syrup", { storageUnitPublicId: units.kg, recipeUnitPublicId: units.ml });
    await addRule(honeySyrup, "ml", "g", "1.4", { justification: "Measured density 1.4 g/ml" });
    expect((await getItem(db, tenantId, honey.item.publicId)).preview.pairs[0]!.result).toEqual({
      status: "missing",
      reason: "mass_volume_needs_item_rule",
    });
    const withRule = await addRule(honey, "ml", "g", "1.42", { justification: "Measured density 1.42 g/ml" });
    expect(withRule.rules[0]).toMatchObject({ justification: "Measured density 1.42 g/ml" });
    const pair = withRule.preview.pairs[0]!;
    expect(previewSentences("en", pair)?.forward).toBe("1 kg = 704.225 ml");
    expect(pair.result).toMatchObject({
      status: "derived",
      path: [
        { fromCode: "kg", toCode: "g", source: "standard" },
        { fromCode: "g", toCode: "ml", source: "item_rule" },
      ],
    });
    // Revising a mass-volume rule still needs a justification.
    expect(
      await rejection(
        reviseConversion(db, tenantId, ADMIN, ACTOR, honey.item.publicId, withRule.rules[0]!.publicId, { expectedRevision: 1, factor: "1.43", justification: "" }),
      ),
    ).toMatchObject({ statusCode: 400, code: "justification_required" });
  });

  it("keeps pack factors independent: packet → piece = 12 for one item, batch → piece = 50 for a prepared item", async () => {
    const buns = await newItem("Buns", { storageUnitPublicId: units.piece, purchaseUnitPublicId: units.packet });
    const dough = await createItem(db, tenantId, ADMIN, ACTOR, {
      nameEn: "Dough balls",
      kind: "prepared",
      storageUnitPublicId: units.batch,
      recipeUnitPublicId: units.piece,
    });
    const third = await newItem("Rolls", { storageUnitPublicId: units.piece, purchaseUnitPublicId: units.packet });
    const bunsAfter = await addRule(buns, "packet", "piece", "12");
    const doughAfter = await createConversion(db, tenantId, ADMIN, ACTOR, dough.item.publicId, {
      fromUnitPublicId: units.batch,
      toUnitPublicId: units.piece,
      factor: "50",
    });
    expect(previewSentences("en", bunsAfter.preview.pairs.find((pair) => pair.key === "purchase_storage")!)?.forward).toBe(
      "1 packet = 12 piece",
    );
    expect(previewSentences("en", doughAfter.preview.pairs.find((pair) => pair.key === "storage_recipe")!)?.forward).toBe(
      "1 batch = 50 piece",
    );
    const rolls = await getItem(db, tenantId, third.item.publicId);
    expect(rolls.rules).toEqual([]);
    expect(rolls.preview.pairs.find((pair) => pair.key === "purchase_storage")!.result).toEqual({
      status: "missing",
      reason: "pack_needs_item_rule",
    });
    const rollsAfter = await addRule(third, "packet", "piece", "6");
    expect(previewSentences("en", rollsAfter.preview.pairs.find((pair) => pair.key === "purchase_storage")!)?.forward).toBe(
      "1 packet = 6 piece",
    );
    expect((await getItem(db, tenantId, buns.item.publicId)).rules[0]!.factor).toBe("12");
  });

  it("refuses conversion writes on an archived item and for a user-role member", async () => {
    const item = await newItem("Salt");
    await addRule(item, "packet", "g", "500");
    expect(
      await rejection(
        createConversion(db, tenantId, USER, ACTOR, item.item.publicId, { fromUnitPublicId: units.box, toUnitPublicId: units.g, factor: "2" }),
      ),
    ).toMatchObject({ statusCode: 403, code: "administrator_required" });
    const current = await getItem(db, tenantId, item.item.publicId);
    expect(
      await rejection(
        updateConversion(db, tenantId, USER, ACTOR, item.item.publicId, current.rules[0]!.publicId, { operation: "close", expectedRevision: 1 }),
      ),
    ).toMatchObject({ statusCode: 403, code: "administrator_required" });
    await updateItem(db, tenantId, ADMIN, ACTOR, item.item.publicId, { expectedVersion: 1, status: "archived" });
    expect(await rejection(addRule(item, "box", "g", "2"))).toMatchObject({ statusCode: 409, code: "item_archived" });
    expect((await getItem(db, tenantId, item.item.publicId)).history).toHaveLength(1);
  });

  it("isolates tenants and runs under the qos_app role with RLS and the effective_to-only grant", async () => {
    const item = await newItem("Buns");
    const created = await addRule(item, "packet", "piece", "12", { effectiveFrom: "2026-11-01" });
    const other = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    const otherUnits = await seedUnits(other);
    expect(await rejection(getItem(db, other, item.item.publicId))).toMatchObject({ statusCode: 404, code: "item_not_found" });
    expect(
      await rejection(
        reviseConversion(db, other, ADMIN, ACTOR, item.item.publicId, created.rules[0]!.publicId, { expectedRevision: 1, factor: "1" }),
      ),
    ).toMatchObject({ statusCode: 404 });
    // Tenant A's item cannot use tenant B's units.
    expect(
      await rejection(
        createConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, { fromUnitPublicId: otherUnits.box, toUnitPublicId: units.piece, factor: "2" }),
      ),
    ).toMatchObject({ statusCode: 404, code: "unit_not_found" });

    await runAsRole(sql, "qos_app", async () => {
      const revised = await reviseConversion(db, tenantId, ADMIN, ACTOR, item.item.publicId, created.rules[0]!.publicId, {
        expectedRevision: 1,
        factor: "10",
        effectiveFrom: "2026-11-20",
      });
      expect(revised.history.map((row) => row.factor)).toEqual(["10", "12"]);
      const otherItem = await createItem(db, other, ADMIN, ACTOR, { nameEn: "Buns", kind: "purchased" });
      const otherAfter = await createConversion(db, other, ADMIN, ACTOR, otherItem.item.publicId, {
        fromUnitPublicId: otherUnits.packet,
        toUnitPublicId: otherUnits.piece,
        factor: "20",
      });
      expect(otherAfter.rules[0]!.factor).toBe("20");
      expect(await rejection(getItem(db, other, item.item.publicId))).toMatchObject({ statusCode: 404 });
    });
    expect((await getItem(db, tenantId, item.item.publicId)).rules[0]!.factor).toBe("10");
  });
});
