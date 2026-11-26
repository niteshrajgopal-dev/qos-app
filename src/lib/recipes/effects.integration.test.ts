import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { deleteModifierGroup, detachModifierGroupFromProduct, listProductModifierGroups } from "@/lib/catalogue/modifiers";
import { listProductVariants, updateProductVariant } from "@/lib/catalogue/variants";
import { createItem, updateItem } from "@/lib/inventory/items";
import { ACTOR, ADMIN, auditActions, type IntegrationConnection, rejection, truncateInventory, USER } from "@/lib/inventory/integration-helpers";
import { setReferenceCost } from "@/lib/inventory/reference-costs";
import { createUnit, updateUnit } from "@/lib/inventory/units";
import { getConfigurationPreview } from "@/lib/recipes/costing-service";
import { replaceDraftEffects } from "@/lib/recipes/effects-service";
import { type EffectFixtures, seedEffectFixtures, seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { createRecipe, getRecipe } from "@/lib/recipes/recipes";
import { approveVersion, createDraftFromVersion, replaceDraftLines } from "@/lib/recipes/versions";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;
const NOW = new Date("2026-11-10T08:00:00Z");

integrationDescribe("recipe modifier effects", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
  let otherTenantId: string;
  let fx: RecipeFixtures;
  let ef: EffectFixtures;

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
    otherTenantId = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    fx = await seedRecipeFixtures(db, tenantId);
    ef = await seedEffectFixtures(db, tenantId, fx, NOW);
  });

  const currentDraft = async () => {
    const detail = await getRecipe(db, tenantId, ef.recipePublicId);
    return detail.versions.find((version) => version.status === "draft")!;
  };

  const WORKED_EFFECTS = () => [
    { optionPublicId: ef.options.shot, effectType: "add", itemPublicId: fx.items.beans, unitPublicId: fx.units.g, quantity: "9" },
    { optionPublicId: ef.options.oat, effectType: "replace", targetLinePublicId: ef.milkLine, itemPublicId: ef.oat, unitPublicId: fx.units.ml, quantity: "200", notes: "Oat instead of milk" },
    { optionPublicId: ef.options.noMilk, effectType: "remove", targetLinePublicId: ef.milkLine },
  ];

  async function saveEffects(effects: unknown[], versionPublicId = ef.versionPublicId) {
    const detail = await getRecipe(db, tenantId, ef.recipePublicId);
    const version = detail.versions.find((entry) => entry.publicId === versionPublicId)!;
    return replaceDraftEffects(db, tenantId, ADMIN, ACTOR, ef.recipePublicId, versionPublicId, { expectedVersion: version.version, effects }, NOW);
  }

  async function approveDraft(effectiveFrom = "2026-11-01") {
    const draft = await currentDraft();
    return approveVersion(db, tenantId, ADMIN, ACTOR, ef.recipePublicId, draft.publicId, { expectedVersion: draft.version, effectiveFrom }, NOW);
  }

  const modifierRules = () => sql<Record<string, unknown>[]>`
    SELECT o.public_id, o.price_minor, o.currency, o.is_default, o.allows_quantity, o.max_quantity, o.status, o.sort_order
    FROM qos.catalogue_modifier_options o WHERE o.tenant_id = ${tenantId} ORDER BY o.public_id`;
  const assignmentRules = () => sql<Record<string, unknown>[]>`
    SELECT min_selections, max_selections, repeat_allowed, selection_count_mode, version, sort_order
    FROM qos.catalogue_product_modifier_groups WHERE tenant_id = ${tenantId}`;

  it("saves and reloads each effect with its exact option, version, base line, item, quantity and unit", async () => {
    const saved = await saveEffects(WORKED_EFFECTS());
    const reloaded = await getRecipe(db, tenantId, ef.recipePublicId);
    expect(reloaded.versions[0]!.effects).toEqual(saved.versions[0]!.effects);
    expect(
      reloaded.versions[0]!.effects.map((effect) => [
        effect.position,
        effect.option.publicId,
        effect.option.group.publicId,
        effect.effectType,
        effect.targetLine?.publicId ?? null,
        effect.item?.publicId ?? null,
        effect.quantity,
        effect.unit?.code ?? null,
        effect.notes,
        effect.states,
      ]),
    ).toEqual([
      [0, ef.options.shot, ef.groupPublicId, "add", null, fx.items.beans, "9", "g", null, []],
      [1, ef.options.oat, ef.groupPublicId, "replace", ef.milkLine, ef.oat, "200", "ml", "Oat instead of milk", []],
      [2, ef.options.noMilk, ef.groupPublicId, "remove", ef.milkLine, null, null, null, null, []],
    ]);
    const rows = await sql<Record<string, unknown>[]>`
      SELECT e.effect_type, v.public_id AS version, o.public_id AS option, l.public_id AS line, i.public_id AS item, u.code AS unit,
             e.quantity_micros::text AS quantity_micros, e.status
      FROM qos.recipe_version_modifier_effects e
      JOIN qos.recipe_versions v ON v.id = e.recipe_version_id
      JOIN qos.catalogue_modifier_options o ON o.id = e.modifier_option_id
      LEFT JOIN qos.recipe_version_lines l ON l.id = e.target_line_id
      LEFT JOIN qos.inventory_items i ON i.id = e.item_id
      LEFT JOIN qos.inventory_units u ON u.id = e.unit_id
      WHERE e.tenant_id = ${tenantId} ORDER BY e.position`;
    expect(rows).toEqual([
      { effect_type: "add", version: ef.versionPublicId, option: ef.options.shot, line: null, item: fx.items.beans, unit: "g", quantity_micros: "9000000", status: "active" },
      { effect_type: "replace", version: ef.versionPublicId, option: ef.options.oat, line: ef.milkLine, item: ef.oat, unit: "ml", quantity_micros: "200000000", status: "active" },
      { effect_type: "remove", version: ef.versionPublicId, option: ef.options.noMilk, line: ef.milkLine, item: null, unit: null, quantity_micros: null, status: "active" },
    ]);
    const audit = (await auditActions(sql, tenantId)).filter((row) => row.action === "recipe.version.effects.update");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entity_type: "recipe_version", entity_public_id: ef.versionPublicId, change_summary: { before: { effects: [] } } });
    expect((audit[0]!.change_summary.after as { effects: unknown[] }).effects).toHaveLength(3);

    // Whole-list replace: rows kept by public id are updated, rows left out are marked removed, never deleted.
    const kept = reloaded.versions[0]!.effects[0]!;
    const next = await saveEffects([{ effectPublicId: kept.publicId, optionPublicId: ef.options.shot, effectType: "add", itemPublicId: fx.items.beans, unitPublicId: fx.units.g, quantity: "10" }]);
    expect(next.versions[0]!.effects.map((effect) => [effect.publicId, effect.quantity])).toEqual([[kept.publicId, "10"]]);
    const statuses = await sql<{ status: string }[]>`SELECT status FROM qos.recipe_version_modifier_effects WHERE tenant_id = ${tenantId} ORDER BY status`;
    expect(statuses.map((row) => row.status)).toEqual(["active", "removed", "removed"]);
  });

  it("leaves option prices and selection rules exactly as they were", async () => {
    const options = await modifierRules();
    const assignments = await assignmentRules();
    await saveEffects(WORKED_EFFECTS());
    await getConfigurationPreview(db, tenantId, { variantPublicId: fx.latte.regular, date: null, quantity: "2", options: [`${ef.options.shot}:2`] }, NOW);
    await approveDraft();
    expect(await modifierRules()).toEqual(options);
    expect(await assignmentRules()).toEqual(assignments);
  });

  it("refuses invalid effects with typed errors", async () => {
    const one = (effect: Record<string, unknown>) => saveEffects([effect]);
    const base = { optionPublicId: ef.options.shot, effectType: "add", itemPublicId: fx.items.beans, unitPublicId: fx.units.g, quantity: "9" };
    expect(await rejection(saveEffects([base, base]))).toMatchObject({ statusCode: 400, code: "effect_duplicate" });
    expect(
      await rejection(saveEffects([
        { optionPublicId: ef.options.oat, effectType: "remove", targetLinePublicId: ef.milkLine },
        { optionPublicId: ef.options.oat, effectType: "replace", targetLinePublicId: ef.milkLine, itemPublicId: ef.oat, unitPublicId: fx.units.ml, quantity: "1" },
      ])),
    ).toMatchObject({ statusCode: 400, code: "effect_duplicate" });
    expect(await rejection(one({ ...base, effectType: "swap" }))).toMatchObject({ statusCode: 400, code: "effect_type_invalid" });
    expect(await rejection(one({ ...base, optionPublicId: "" }))).toMatchObject({ statusCode: 400, code: "effect_option_required" });
    expect(await rejection(one({ ...base, optionPublicId: "modopt_missing" }))).toMatchObject({ statusCode: 404, code: "option_not_found" });
    expect(await rejection(one({ ...base, targetLinePublicId: ef.milkLine }))).toMatchObject({ statusCode: 400, code: "target_line_not_allowed" });
    expect(await rejection(one({ optionPublicId: ef.options.noMilk, effectType: "remove" }))).toMatchObject({ statusCode: 400, code: "target_line_required" });
    expect(await rejection(one({ optionPublicId: ef.options.noMilk, effectType: "remove", targetLinePublicId: "recl_missing" }))).toMatchObject({
      statusCode: 404,
      code: "target_line_not_found",
    });
    expect(await rejection(one({ optionPublicId: ef.options.noMilk, effectType: "remove", targetLinePublicId: ef.milkLine, itemPublicId: fx.items.beans }))).toMatchObject({
      statusCode: 400,
      code: "effect_item_not_allowed",
    });
    expect(await rejection(one({ ...base, itemPublicId: null }))).toMatchObject({ statusCode: 400, code: "effect_item_required" });
    expect(await rejection(one({ ...base, quantity: "-1" }))).toMatchObject({ statusCode: 400, code: "quantity_not_positive" });
    expect(await rejection(one({ ...base, quantity: "0.5" }))).toMatchObject({ statusCode: 400, code: "quantity_too_precise" });
    expect(await rejection(one({ ...base, unitPublicId: fx.units.bottle }))).toMatchObject({ statusCode: 400, code: "effect_unit_not_convertible" });
    expect(await rejection(saveEffects(Array.from({ length: 101 }, () => base)))).toMatchObject({ statusCode: 400, code: "effects_too_many" });
    expect(await rejection(one({ ...base, effectPublicId: "eff_missing" }))).toMatchObject({ statusCode: 404, code: "effect_not_found" });
    // Nothing was written by any refused request.
    expect(await sql`SELECT 1 FROM qos.recipe_version_modifier_effects WHERE tenant_id = ${tenantId}`).toHaveLength(0);
  });

  it("only offers options assigned through a product linked to the recipe, and only on sellable recipes", async () => {
    const detail = await getRecipe(db, tenantId, ef.recipePublicId);
    expect(detail.pickers.modifierOptions.map((option) => [option.publicId, option.products.map((product) => product.publicId)])).toEqual([
      [ef.options.shot, [fx.latte.productPublicId]],
      [ef.options.oat, [fx.latte.productPublicId]],
      [ef.options.noMilk, [fx.latte.productPublicId]],
    ]);
    const product = await listProductModifierGroups(db, tenantId, fx.latte.productPublicId);
    await detachModifierGroupFromProduct(db, tenantId, fx.latte.productPublicId, ef.groupPublicId, product.productVersion, ACTOR, ADMIN);
    expect((await getRecipe(db, tenantId, ef.recipePublicId)).pickers.modifierOptions).toEqual([]);
    expect(await rejection(saveEffects([{ optionPublicId: ef.options.noMilk, effectType: "remove", targetLinePublicId: ef.milkLine }]))).toMatchObject({
      statusCode: 400,
      code: "option_not_assigned",
    });

    const prepared = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Syrup", kind: "prepared", outputItemPublicId: fx.items.syrup, yieldQuantity: "1", yieldUnitPublicId: fx.units.l }, NOW);
    expect(
      await rejection(
        replaceDraftEffects(db, tenantId, ADMIN, ACTOR, prepared.recipe.publicId, prepared.versions[0]!.publicId, { expectedVersion: prepared.versions[0]!.version, effects: [] }, NOW),
      ),
    ).toMatchObject({ statusCode: 400, code: "effects_sellable_only" });
  });

  it("is administrator-only, tenant-scoped and optimistic", async () => {
    const version = await currentDraft();
    const body = { expectedVersion: version.version, effects: WORKED_EFFECTS() };
    expect(await rejection(replaceDraftEffects(db, tenantId, USER, ACTOR, ef.recipePublicId, version.publicId, body, NOW))).toMatchObject({
      statusCode: 403,
      code: "administrator_required",
    });
    expect(await rejection(replaceDraftEffects(db, otherTenantId, ADMIN, ACTOR, ef.recipePublicId, version.publicId, body, NOW))).toMatchObject({
      statusCode: 404,
      code: "recipe_not_found",
    });
    expect(
      await rejection(replaceDraftEffects(db, tenantId, ADMIN, ACTOR, ef.recipePublicId, version.publicId, { ...body, expectedVersion: version.version + 1 }, NOW)),
    ).toMatchObject({ statusCode: 409, code: "expected_version_mismatch" });
    // Another business's option is not found here, even by its public id.
    const otherFx = await seedRecipeFixtures(db, otherTenantId);
    const otherEf = await seedEffectFixtures(db, otherTenantId, otherFx, NOW);
    expect(otherEf.options.shot).toBe(ef.options.shot);
    await sql`UPDATE qos.catalogue_modifier_options SET public_id = 'modopt_theirs' WHERE tenant_id = ${otherTenantId} AND public_id = ${ef.options.shot}`;
    expect(await rejection(saveEffects([{ optionPublicId: "modopt_theirs", effectType: "add", itemPublicId: fx.items.beans, unitPublicId: fx.units.g, quantity: "9" }]))).toMatchObject({
      statusCode: 404,
      code: "option_not_found",
    });
    expect(await rejection(saveEffects([{ optionPublicId: ef.options.shot, effectType: "add", itemPublicId: otherFx.items.beans, unitPublicId: fx.units.g, quantity: "9" }]))).toMatchObject({
      statusCode: 404,
      code: "item_not_found",
    });
  });

  it("freezes effects on approval: read-only, in a schema 2 snapshot, copied to the next draft against its own lines", async () => {
    await saveEffects(WORKED_EFFECTS());
    const approved = await approveDraft();
    const v1 = approved.versions[0]!;
    expect(await rejection(saveEffects([], v1.publicId))).toMatchObject({ statusCode: 409, code: "version_not_draft" });
    const [snapshot] = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT s.snapshot FROM qos.recipe_version_snapshots s JOIN qos.recipe_versions v ON v.id = s.recipe_version_id WHERE v.public_id = ${v1.publicId}`;
    expect(snapshot!.snapshot).toMatchObject({
      schema: 2,
      effects: [
        { effectType: "add", optionPublicId: ef.options.shot, optionNameEn: "Extra shot", optionNameAr: "جرعة إضافية", targetLinePublicId: null, itemPublicId: fx.items.beans, quantity: "9", unitCode: "g" },
        { effectType: "replace", optionPublicId: ef.options.oat, targetLinePublicId: ef.milkLine, itemPublicId: ef.oat, quantity: "200", unitCode: "ml" },
        { effectType: "remove", optionPublicId: ef.options.noMilk, targetLinePublicId: ef.milkLine, itemPublicId: null, quantity: null, unitCode: null },
      ],
    });
    const approveAudit = (await auditActions(sql, tenantId)).find((row) => row.action === "recipe.version.approve")!;
    expect(approveAudit.change_summary).toMatchObject({ after: { effectCount: 3 } });

    const draftDetail = await createDraftFromVersion(db, tenantId, ADMIN, ACTOR, ef.recipePublicId, { fromVersionPublicId: v1.publicId }, NOW);
    const v2 = draftDetail.versions[0]!;
    const v2Milk = v2.lines.find((line) => line.item.publicId === fx.items.milk)!.publicId;
    expect(v2Milk).not.toBe(ef.milkLine);
    expect(v2.effects.map((effect) => [effect.option.publicId, effect.effectType, effect.targetLine?.publicId ?? null])).toEqual([
      [ef.options.shot, "add", null],
      [ef.options.oat, "replace", v2Milk],
      [ef.options.noMilk, "remove", v2Milk],
    ]);
    expect(new Set(v2.effects.map((effect) => effect.publicId)).isDisjointFrom(new Set(v1.effects.map((effect) => effect.publicId)))).toBe(true);
    const createAudit = (await auditActions(sql, tenantId)).find((row) => row.action === "recipe.version.create")!;
    expect(createAudit.change_summary).toMatchObject({ copiedEffects: 3, copiedLines: 2 });
  });

  it("refuses to drop or re-point a base line an effect targets", async () => {
    await saveEffects(WORKED_EFFECTS());
    const draft = await currentDraft();
    const dropMilk = replaceDraftLines(db, tenantId, ADMIN, ACTOR, ef.recipePublicId, draft.publicId, {
      expectedVersion: draft.version,
      lines: [{ linePublicId: ef.beansLine, itemPublicId: fx.items.beans, quantity: "18", unitPublicId: fx.units.g }],
    }, NOW);
    expect(await rejection(dropMilk)).toMatchObject({ statusCode: 409, code: "line_targeted_by_effect", field: "lines" });
    const repoint = replaceDraftLines(db, tenantId, ADMIN, ACTOR, ef.recipePublicId, draft.publicId, {
      expectedVersion: draft.version,
      lines: [
        { linePublicId: ef.milkLine, itemPublicId: fx.items.sugar, quantity: "200", unitPublicId: fx.units.g },
        { linePublicId: ef.beansLine, itemPublicId: fx.items.beans, quantity: "18", unitPublicId: fx.units.g },
      ],
    }, NOW);
    expect(await rejection(repoint)).toMatchObject({ statusCode: 409, code: "line_targeted_by_effect" });
    // Changing the quantity of a targeted line is fine: the effect still removes that line.
    const resized = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, ef.recipePublicId, draft.publicId, {
      expectedVersion: draft.version,
      lines: [
        { linePublicId: ef.milkLine, itemPublicId: fx.items.milk, quantity: "250", unitPublicId: fx.units.ml },
        { linePublicId: ef.beansLine, itemPublicId: fx.items.beans, quantity: "18", unitPublicId: fx.units.g },
      ],
    }, NOW);
    expect(resized.versions[0]!.effects[1]!.targetLine).toMatchObject({ publicId: ef.milkLine, quantity: "250" });
  });

  it("keeps the approved snapshot and effects when costs change and a later version changes effects", async () => {
    await saveEffects(WORKED_EFFECTS());
    const v1 = (await approveDraft()).versions[0]!;
    const snapshotOf = async (publicId: string) =>
      (await sql<{ snapshot: unknown; created_at: Date }[]>`
        SELECT s.snapshot, s.created_at FROM qos.recipe_version_snapshots s JOIN qos.recipe_versions v ON v.id = s.recipe_version_id WHERE v.public_id = ${publicId}`)[0];
    const before = await snapshotOf(v1.publicId);
    const effectRows = () => sql`SELECT e.* FROM qos.recipe_version_modifier_effects e JOIN qos.recipe_versions v ON v.id = e.recipe_version_id WHERE v.public_id = ${v1.publicId} ORDER BY e.position`;
    const rowsBefore = await effectRows();

    await setReferenceCost(db, tenantId, ADMIN, ACTOR, fx.items.milk, { amount: "4", taxBasis: "net", source: "manual", expectedRevision: null }, NOW);
    const v2 = (await createDraftFromVersion(db, tenantId, ADMIN, ACTOR, ef.recipePublicId, { fromVersionPublicId: v1.publicId }, NOW)).versions[0]!;
    await saveEffects([{ optionPublicId: ef.options.shot, effectType: "add", itemPublicId: fx.items.beans, unitPublicId: fx.units.g, quantity: "12" }], v2.publicId);
    await approveDraft("2026-12-01");

    expect(await snapshotOf(v1.publicId)).toEqual(before);
    expect(await effectRows()).toEqual(rowsBefore);
    const detail = await getRecipe(db, tenantId, ef.recipePublicId);
    expect(detail.versions.find((version) => version.publicId === v1.publicId)!.effects.map((effect) => effect.quantity)).toEqual(["9", "200", null]);
    // The preview resolves each business date to its own version's effects.
    const preview = (date: string) =>
      getConfigurationPreview(db, tenantId, { variantPublicId: fx.latte.regular, date, quantity: "1", options: [ef.options.shot] }, NOW);
    expect((await preview("2026-11-20")).perItem.find((entry) => entry.item.publicId === fx.items.beans)!.perSale!.text).toBe("0.027");
    expect((await preview("2026-12-02")).perItem.find((entry) => entry.item.publicId === fx.items.beans)!.perSale!.text).toBe("0.030");
  });

  it("blocks archiving an item or unit an effect uses, and deleting a modifier group whose option an effect names", async () => {
    const cl = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: "cl" });
    await saveEffects([{ optionPublicId: ef.options.oat, effectType: "replace", targetLinePublicId: ef.milkLine, itemPublicId: ef.oat, unitPublicId: cl.publicId, quantity: "20" }]);
    const [oatRow] = await sql<{ version: number }[]>`SELECT version FROM qos.inventory_items WHERE tenant_id = ${tenantId} AND public_id = ${ef.oat}`;
    const archiveItem = await rejection(updateItem(db, tenantId, ADMIN, ACTOR, ef.oat, { expectedVersion: oatRow!.version, status: "archived" }));
    expect(archiveItem).toMatchObject({ statusCode: 409, code: "item_in_use" });
    try {
      await updateItem(db, tenantId, ADMIN, ACTOR, ef.oat, { expectedVersion: oatRow!.version, status: "archived" });
    } catch (error) {
      expect((error as { dependencies: unknown }).dependencies).toEqual([{ kind: "recipe_effects", count: 1 }]);
    }
    const archiveUnit = await rejection(updateUnit(db, tenantId, ADMIN, ACTOR, cl.publicId, { expectedVersion: cl.version, status: "archived" }));
    expect(archiveUnit).toMatchObject({ statusCode: 409, code: "unit_in_use" });

    const product = await listProductModifierGroups(db, tenantId, fx.latte.productPublicId);
    await detachModifierGroupFromProduct(db, tenantId, fx.latte.productPublicId, ef.groupPublicId, product.productVersion, ACTOR, ADMIN);
    const [group] = await sql<{ version: number }[]>`SELECT version FROM qos.catalogue_modifier_groups WHERE tenant_id = ${tenantId} AND public_id = ${ef.groupPublicId}`;
    expect(await rejection(deleteModifierGroup(db, tenantId, ef.groupPublicId, { expectedVersion: group!.version }, ACTOR, ADMIN))).toMatchObject({
      statusCode: 409,
      code: "modifier_options_in_recipe_effects",
    });
  });

  it("previews the worked example: usage, cost, price and ingredient margin, with nothing written", async () => {
    await saveEffects(WORKED_EFFECTS());
    await approveDraft();
    for (const [item, amount] of [[fx.items.milk, "4"], [fx.items.beans, "60"], [ef.oat, "9"]] as const) {
      await setReferenceCost(db, tenantId, ADMIN, ACTOR, item, { amount, taxBasis: "net", source: "manual", expectedRevision: null }, NOW);
    }
    const product = await listProductVariants(db, tenantId, ADMIN, fx.latte.productPublicId);
    await updateProductVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.regular, {
      expectedProductVersion: product.productVersion,
      priceTaxBasis: "exclusive",
      taxRateBasisPoints: 500,
    }, ACTOR);
    const counts = () => sql`SELECT (SELECT count(*) FROM qos.recipe_version_modifier_effects) AS effects, (SELECT count(*) FROM qos.tenant_audit_events) AS audits, (SELECT count(*) FROM qos.recipe_version_snapshots) AS snapshots`;
    const before = await counts();
    const result = await getConfigurationPreview(db, tenantId, {
      variantPublicId: fx.latte.regular,
      date: null,
      quantity: "3",
      options: [`${ef.options.shot}:2`, ef.options.oat],
    }, NOW);
    expect(await counts()).toEqual(before);
    expect(result.configurationStatus).toBe("resolved");
    expect(result.perItem.map((entry) => [entry.item.publicId, entry.perSale?.text, entry.total?.text])).toEqual([
      [fx.items.milk, "0.000", "0.000"],
      [fx.items.beans, "0.036", "0.108"],
      [ef.oat, "0.200", "0.600"],
    ]);
    expect(result.cost).toMatchObject({ status: "known", perSale: { text: "3.96" }, total: { text: "11.88" }, currency: "AED", taxBasis: "net" });
    expect(result.batchCost).toMatchObject({ status: "known", perBatch: { text: "1.88" }, perYieldUnit: { text: "1.88" } });
    expect(result.price).toMatchObject({ status: "available", base: "18.00", options: "8.00", total: "26.00", baseInheritance: "central" });
    expect(result.margin).toEqual({
      status: "available",
      basis: "net",
      currency: "AED",
      price: "26.00",
      cost: "3.96",
      margin: "22.04",
      marginMicros: "22040000",
      marginPercent: { text: "84.8", rounded: true },
      rounding: "none",
    });
    // The QOS-198 base usage is unchanged by the options.
    expect(result.lines.map((line) => [line.item.publicId, line.perSale?.text])).toEqual([
      [fx.items.milk, "0.200"],
      [fx.items.beans, "0.018"],
    ]);

    const rejected = await getConfigurationPreview(db, tenantId, { variantPublicId: fx.latte.regular, date: null, quantity: "1", options: [ef.options.oat, ef.options.noMilk] }, NOW);
    expect(rejected).toMatchObject({ configurationStatus: "rejected", cost: { status: "unavailable", reason: "rejected" }, margin: { status: "unavailable", reason: "cost_unavailable" } });
    expect(rejected.rejections.map((entry) => [entry.code, entry.options.map((option) => option.publicId)])).toEqual([
      ["conflicting_effects", [ef.options.oat, ef.options.noMilk]],
    ]);

    // A missing ingredient cost is never a zero: the total and the margin are unavailable.
    await sql`UPDATE qos.inventory_item_reference_costs SET effective_to = '2026-11-10' WHERE tenant_id = ${tenantId} AND item_id = (SELECT id FROM qos.inventory_items WHERE public_id = ${ef.oat} AND tenant_id = ${tenantId})`;
    const incomplete = await getConfigurationPreview(db, tenantId, { variantPublicId: fx.latte.regular, date: null, quantity: "1", options: [ef.options.oat] }, NOW);
    expect(incomplete.cost).toMatchObject({ status: "unavailable", reason: "incomplete", missingCount: 1 });
    expect(incomplete.margin).toEqual({ status: "unavailable", reason: "cost_unavailable" });
  });

  it("validates preview parameters and the sales channel", async () => {
    const run = (query: Record<string, unknown>) =>
      getConfigurationPreview(db, tenantId, { variantPublicId: fx.latte.regular, date: null, quantity: null, ...query }, NOW);
    expect(await rejection(run({ options: ["bad option"] }))).toMatchObject({ statusCode: 400, code: "option_param_invalid" });
    expect(await rejection(run({ options: [`${ef.options.shot}:0`] }))).toMatchObject({ statusCode: 400, code: "option_param_invalid" });
    expect(await rejection(run({ defaults: "always" }))).toMatchObject({ statusCode: 400, code: "defaults_invalid" });
    expect(await rejection(run({ channelPublicId: "schan_missing" }))).toMatchObject({ statusCode: 404, code: "channel_not_found" });
    expect(await rejection(getConfigurationPreview(db, otherTenantId, { variantPublicId: fx.latte.regular, date: null, quantity: null }, NOW))).toMatchObject({
      statusCode: 404,
      code: "variant_not_found",
    });
  });

  it("resolves a recipe-derived variant cost through the engine for the product editor", async () => {
    await approveDraft();
    for (const [item, amount] of [[fx.items.milk, "4"], [fx.items.beans, "60"]] as const) {
      await setReferenceCost(db, tenantId, ADMIN, ACTOR, item, { amount, taxBasis: "net", source: "manual", expectedRevision: null }, NOW);
    }
    let product = await listProductVariants(db, tenantId, ADMIN, fx.latte.productPublicId);
    product = await updateProductVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.regular, {
      expectedProductVersion: product.productVersion,
      priceTaxBasis: "exclusive",
      taxRateBasisPoints: 500,
      costPolicy: { operation: "change_to_recipe_derived", effectiveFrom: "2026-11-10" },
    }, ACTOR);
    const regular = product.variants.find((variant) => variant.publicId === fx.latte.regular)!;
    expect(regular.referenceCost.resolution).toMatchObject({
      status: "recipe_derived_computed",
      amountMicros: "1880000",
      amountMajor: "1.88",
      currency: "AED",
      taxBasis: "net",
      unit: "each",
      recipe: { publicId: ef.recipePublicId },
      versionNumber: 1,
      rounding: "none",
    });
    expect(regular.referenceMargin).toMatchObject({ status: "available", basis: "net", marginMicros: "16120000" });

    // The large variant has no link: the specific reason, never a zero.
    product = await updateProductVariant(db, tenantId, ADMIN, fx.latte.productPublicId, fx.latte.large, {
      expectedProductVersion: product.productVersion,
      priceTaxBasis: "exclusive",
      taxRateBasisPoints: 500,
      costPolicy: { operation: "change_to_recipe_derived", effectiveFrom: "2026-11-10" },
    }, ACTOR);
    const large = product.variants.find((variant) => variant.publicId === fx.latte.large)!;
    expect(large.referenceCost.resolution).toMatchObject({ status: "recipe_derived_reference", reason: "recipe_no_link" });
    expect(large.referenceMargin).toEqual({ status: "unavailable", reason: "recipe_no_link" });

    // An item cost recorded with an unconfirmed basis is shown as an amount but never compared with the price.
    await setReferenceCost(db, tenantId, ADMIN, ACTOR, fx.items.milk, { amount: "4", taxBasis: "unconfirmed", source: "manual", expectedRevision: 1 }, NOW);
    const unconfirmed = (await listProductVariants(db, tenantId, ADMIN, fx.latte.productPublicId)).variants.find((variant) => variant.publicId === fx.latte.regular)!;
    expect(unconfirmed.referenceCost.resolution).toMatchObject({ status: "recipe_derived_computed", taxBasis: "unconfirmed" });
    expect(unconfirmed.referenceMargin).toEqual({ status: "unavailable", reason: "unconfirmed_cost_tax_basis" });
  });

  it("uses an item of its own on the effect to check the unit, with a fresh item that has no storage path", async () => {
    const loose = await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Cinnamon", kind: "purchased", storageUnitPublicId: fx.units.kg });
    expect(
      await rejection(saveEffects([{ optionPublicId: ef.options.shot, effectType: "add", itemPublicId: loose.item.publicId, unitPublicId: fx.units.ml, quantity: "1" }])),
    ).toMatchObject({ statusCode: 400, code: "effect_unit_not_convertible" });
    const saved = await saveEffects([{ optionPublicId: ef.options.shot, effectType: "add", itemPublicId: loose.item.publicId, unitPublicId: fx.units.g, quantity: "1" }]);
    expect(saved.versions[0]!.effects[0]).toMatchObject({ item: { publicId: loose.item.publicId }, quantity: "1", unit: { code: "g" } });
  });
});
