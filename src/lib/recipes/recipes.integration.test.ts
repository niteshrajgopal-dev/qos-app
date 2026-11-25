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
import { createSellableLink, updateSellableLink } from "@/lib/recipes/links";
import { seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { createRecipe, getRecipe, listRecipes, updateRecipe } from "@/lib/recipes/recipes";
import {
  approveVersion,
  createDraftFromVersion,
  getVersion,
  replaceDraftLines,
  replaceDraftSteps,
  updateDraftVersion,
} from "@/lib/recipes/versions";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;

// 2026-11-10 in Asia/Dubai (the fixture tenants' timezone) and in UTC.
const NOW = new Date("2026-11-10T08:00:00Z");

integrationDescribe("recipe families and versions", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
  let otherTenantId: string;
  let fx: RecipeFixtures;
  let other: RecipeFixtures;

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
    other = await seedRecipeFixtures(db, otherTenantId);
  });

  async function latteDraft() {
    const created = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", nameAr: "لاتيه", kind: "sellable" }, NOW);
    return { recipe: created.recipe, draft: created.versions[0]! };
  }

  const latteLines = (f: RecipeFixtures) => [
    { itemPublicId: f.items.milk, quantity: "1000", unitPublicId: f.units.ml, labelEn: "Steam the milk", labelAr: "بخّر الحليب" },
    { itemPublicId: f.items.beans, quantity: "72", unitPublicId: f.units.g },
    { itemPublicId: f.items.sugar, quantity: "0.02", unitPublicId: f.units.kg, labelEn: "Optional" },
  ];

  /** A latte with yield 4 portions, three lines and two steps, approved from `date`. */
  async function approvedLatte(date = "2026-11-01") {
    const { recipe, draft } = await latteDraft();
    let detail = await updateDraftVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: 1,
      yieldQuantity: "4",
      yieldUnitPublicId: fx.units.portion,
    }, NOW);
    detail = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: detail.versions[0]!.version,
      lines: latteLines(fx),
    }, NOW);
    detail = await replaceDraftSteps(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: detail.versions[0]!.version,
      steps: [{ textEn: "Pull two shots.", textAr: "استخرج جرعتين." }, { textEn: "Pour the milk." }],
    }, NOW);
    const approved = await approveVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: detail.versions[0]!.version,
      effectiveFrom: date,
    }, NOW);
    return { recipe: approved.recipe, v1: approved.versions[0]!, approved };
  }

  it("creates a family with a version 1 draft and reloads every edited field, line and step in order", async () => {
    const { recipe, draft } = await latteDraft();
    expect(recipe).toMatchObject({ nameEn: "Latte", nameAr: "لاتيه", kind: "sellable", status: "active", version: 1, outputItem: null });
    expect(recipe.publicId).toMatch(/^rec_latte_[0-9a-f]{8}$/);
    expect(draft).toMatchObject({ versionNumber: 1, status: "draft", phase: "draft", yieldQuantity: null, lines: [], steps: [] });
    expect(draft.states).toEqual(["no_lines", "yield_missing"]);

    await updateDraftVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: 1,
      yieldQuantity: "4",
      yieldUnitPublicId: fx.units.portion,
      notes: "Serve hot.",
    }, NOW);
    await replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 2, lines: latteLines(fx) }, NOW);
    await replaceDraftSteps(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: 3,
      steps: [{ textEn: "Pull two shots.", textAr: "استخرج جرعتين." }, { textEn: "Steam the milk." }, { textEn: "Pour." }],
    }, NOW);

    const reloaded = (await getRecipe(db, tenantId, recipe.publicId)).versions[0]!;
    expect(reloaded).toMatchObject({ yieldQuantity: "4", notes: "Serve hot.", version: 4 });
    expect(reloaded.yieldUnit).toMatchObject({ publicId: fx.units.portion, code: "portion" });
    expect(
      reloaded.lines.map((line) => [line.position, line.item.publicId, line.quantity, line.unit.code, line.labelEn, line.labelAr]),
    ).toEqual([
      [0, fx.items.milk, "1000", "ml", "Steam the milk", "بخّر الحليب"],
      [1, fx.items.beans, "72", "g", null, null],
      [2, fx.items.sugar, "0.02", "kg", "Optional", null],
    ]);
    // 1000 ml is 1 l of milk for the whole yield, through the standard table.
    expect(reloaded.lines[0]!.conversion).toMatchObject({ status: "ok", storageUnitCode: "l", inStorageUnit: { text: "1.000" } });
    expect(reloaded.steps.map((step) => [step.position, step.textEn, step.textAr])).toEqual([
      [0, "Pull two shots.", "استخرج جرعتين."],
      [1, "Steam the milk.", null],
      [2, "Pour.", null],
    ]);
    expect(reloaded.states).toEqual([]);

    // Reorder lines and steps, remove one of each, add a new one: public ids are kept, positions renumbered.
    const [milk, beans, sugar] = reloaded.lines;
    const [shots, steam, pour] = reloaded.steps;
    await replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: 4,
      lines: [
        { linePublicId: sugar!.publicId, itemPublicId: fx.items.sugar, quantity: "0.025", unitPublicId: fx.units.kg },
        { linePublicId: milk!.publicId, itemPublicId: fx.items.milk, quantity: "900", unitPublicId: fx.units.ml, labelEn: "Steam" },
        { itemPublicId: fx.items.syrup, quantity: "20", unitPublicId: fx.units.ml },
      ],
    }, NOW);
    await replaceDraftSteps(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: 5,
      steps: [{ stepPublicId: pour!.publicId, textEn: "Pour slowly." }, { stepPublicId: shots!.publicId, textEn: "Pull two shots.", textAr: "استخرج جرعتين." }],
    }, NOW);
    const again = (await getRecipe(db, tenantId, recipe.publicId)).versions[0]!;
    expect(again.lines.map((line) => [line.publicId, line.position, line.item.publicId, line.quantity, line.labelEn])).toEqual([
      [sugar!.publicId, 0, fx.items.sugar, "0.025", null],
      [milk!.publicId, 1, fx.items.milk, "900", "Steam"],
      [expect.stringMatching(/^recl_/), 2, fx.items.syrup, "20", null],
    ]);
    expect(again.steps.map((step) => [step.publicId, step.position, step.textEn])).toEqual([
      [pour!.publicId, 0, "Pour slowly."],
      [shots!.publicId, 1, "Pull two shots."],
    ]);
    // Nothing is deleted: the removed line and step stay as removed rows.
    const [{ removed_lines, removed_steps }] = await sql<{ removed_lines: number; removed_steps: number }[]>`
      SELECT (SELECT count(*)::int FROM qos.recipe_version_lines WHERE public_id = ${beans!.publicId} AND status = 'removed') AS removed_lines,
             (SELECT count(*)::int FROM qos.recipe_version_steps WHERE public_id = ${steam!.publicId} AND status = 'removed') AS removed_steps`;
    expect({ removed_lines, removed_steps }).toEqual({ removed_lines: 1, removed_steps: 1 });

    // Swapping the items of two existing lines does not trip the one-active-line-per-item rule.
    const swapped = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: 6,
      lines: [
        { linePublicId: sugar!.publicId, itemPublicId: fx.items.milk, quantity: "900", unitPublicId: fx.units.ml },
        { linePublicId: milk!.publicId, itemPublicId: fx.items.sugar, quantity: "0.025", unitPublicId: fx.units.kg },
      ],
    }, NOW);
    expect(swapped.versions[0]!.lines.map((line) => line.item.publicId)).toEqual([fx.items.milk, fx.items.sugar]);
  });

  it("validates lines, steps and yields with typed errors", async () => {
    const { recipe, draft } = await latteDraft();
    const lines = (list: unknown[]) =>
      rejection(replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 1, lines: list }, NOW));
    expect(await lines([{ quantity: "1", unitPublicId: fx.units.g }])).toMatchObject({ statusCode: 400, code: "line_item_required" });
    expect(
      await lines([
        { itemPublicId: fx.items.milk, quantity: "1", unitPublicId: fx.units.ml },
        { itemPublicId: fx.items.milk, quantity: "2", unitPublicId: fx.units.ml },
      ]),
    ).toMatchObject({ statusCode: 400, code: "duplicate_line_item", field: "lines.1.itemPublicId" });
    expect(await lines([{ itemPublicId: fx.items.milk, quantity: "0", unitPublicId: fx.units.ml }])).toMatchObject({
      code: "quantity_not_positive",
    });
    expect(await lines([{ itemPublicId: fx.items.milk, quantity: "1.5", unitPublicId: fx.units.ml }])).toMatchObject({
      code: "quantity_too_precise",
    });
    expect(await lines([{ itemPublicId: fx.items.milk, quantity: "1", unitPublicId: fx.units.ml, labelEn: "x".repeat(121) }])).toMatchObject({
      code: "label_too_long",
    });
    expect(await lines([{ linePublicId: "recl_missing", itemPublicId: fx.items.milk, quantity: "1", unitPublicId: fx.units.ml }])).toMatchObject({
      statusCode: 404,
      code: "line_not_found",
    });
    expect(await lines(Array.from({ length: 201 }, () => ({})))).toMatchObject({ code: "lines_too_many" });
    const steps = (list: unknown[]) =>
      rejection(replaceDraftSteps(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 1, steps: list }, NOW));
    expect(await steps([{ textAr: "فقط" }])).toMatchObject({ code: "step_text_required" });
    expect(await steps([{ textEn: "x".repeat(1001) }])).toMatchObject({ code: "step_text_too_long" });
    expect(await steps(Array.from({ length: 51 }, () => ({ textEn: "Step" })))).toMatchObject({ code: "steps_too_many" });
    const yieldOf = (body: Record<string, unknown>) =>
      rejection(updateDraftVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 1, ...body }, NOW));
    expect(await yieldOf({ yieldQuantity: "0", yieldUnitPublicId: fx.units.portion })).toMatchObject({ code: "yield_not_positive" });
    expect(await yieldOf({ yieldQuantity: "2.5", yieldUnitPublicId: fx.units.portion })).toMatchObject({ code: "yield_too_precise" });
    expect(await yieldOf({ yieldQuantity: "two" })).toMatchObject({ code: "yield_invalid" });
    expect(await yieldOf({ yieldQuantity: "2", expectedVersion: 7 })).toMatchObject({ statusCode: 409, code: "expected_version_mismatch" });
    // Approving needs a yield and at least one line.
    expect(await rejection(approveVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 1, effectiveFrom: "2026-11-10" }, NOW))).toMatchObject({
      statusCode: 400,
      code: "yield_required",
    });
    await updateDraftVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 1, yieldQuantity: "2", yieldUnitPublicId: fx.units.portion }, NOW);
    expect(await rejection(approveVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 2, effectiveFrom: "2026-11-10" }, NOW))).toMatchObject({
      code: "no_lines_to_approve",
    });
    expect(await rejection(approveVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 2 }, NOW))).toMatchObject({
      code: "effective_from_invalid",
    });
  });

  it("approves with a snapshot, makes the approved version read-only and keeps a controlled history", async () => {
    const { recipe, v1, approved } = await approvedLatte("2026-11-01");
    expect(v1).toMatchObject({ status: "approved", phase: "current", effectiveFrom: "2026-11-01", effectiveTo: null });
    expect(v1.approvedBySubject).toBe(ACTOR);
    expect(v1.snapshotAt).not.toBeNull();
    expect(approved.effect).toEqual({
      versionNumber: 1,
      effectiveFrom: "2026-11-01",
      supersededVersion: null,
      supersededCovers: null,
      resolvesFrom: "2026-11-01",
      scheduled: false,
      backdated: true,
      postedUsageAffected: 0,
    });
    const [snapshot] = await sql<{ snapshot: Record<string, unknown> }[]>`
      SELECT s.snapshot FROM qos.recipe_version_snapshots s JOIN qos.recipe_versions v ON v.id = s.recipe_version_id
      WHERE v.public_id = ${v1.publicId}`;
    expect(snapshot!.snapshot).toMatchObject({
      schema: 1,
      recipe: { publicId: recipe.publicId, kind: "sellable" },
      version: { versionNumber: 1, effectiveFrom: "2026-11-01", yield: { quantity: "4", unitCode: "portion" } },
      lines: [
        { itemPublicId: fx.items.milk, quantity: "1000", unit: "ml", labelEn: "Steam the milk" },
        { itemPublicId: fx.items.beans, quantity: "72", unit: "g" },
        { itemPublicId: fx.items.sugar, quantity: "0.02", unit: "kg" },
      ],
      steps: [{ textEn: "Pull two shots.", textAr: "استخرج جرعتين." }, { textEn: "Pour the milk." }],
    });

    // Approved versions are read-only through every write path.
    const v = v1.version;
    for (const attempt of [
      replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe.publicId, v1.publicId, { expectedVersion: v, lines: [] }, NOW),
      replaceDraftSteps(db, tenantId, ADMIN, ACTOR, recipe.publicId, v1.publicId, { expectedVersion: v, steps: [] }, NOW),
      updateDraftVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, v1.publicId, { expectedVersion: v, yieldQuantity: "8" }, NOW),
      updateDraftVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, v1.publicId, { expectedVersion: v, status: "discarded" }, NOW),
      approveVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, v1.publicId, { expectedVersion: v, effectiveFrom: "2026-12-01" }, NOW),
    ]) {
      expect(await rejection(attempt)).toMatchObject({ statusCode: 409, code: "version_not_draft" });
    }

    // Create a draft from v1: the lines and steps are copied into version 2.
    const withDraft = await createDraftFromVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, { fromVersionPublicId: v1.publicId }, NOW);
    const v2 = withDraft.versions[0]!;
    expect(v2).toMatchObject({ versionNumber: 2, status: "draft", yieldQuantity: "4" });
    expect(v2.lines.map((line) => [line.item.publicId, line.quantity, line.labelEn])).toEqual(
      v1.lines.map((line) => [line.item.publicId, line.quantity, line.labelEn]),
    );
    expect(v2.lines.every((line, index) => line.publicId !== v1.lines[index]!.publicId)).toBe(true);
    expect(v2.steps.map((step) => step.textEn)).toEqual(["Pull two shots.", "Pour the milk."]);
    expect(withDraft.states).toContain("draft_pending");
    expect(await rejection(createDraftFromVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, { fromVersionPublicId: v1.publicId }, NOW))).toMatchObject({
      statusCode: 409,
      code: "draft_exists",
    });

    // Editing the draft never touches v1.
    await replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe.publicId, v2.publicId, {
      expectedVersion: v2.version,
      lines: [{ itemPublicId: fx.items.milk, quantity: "1200", unitPublicId: fx.units.ml }],
    }, NOW);
    const stillV1 = (await getVersion(db, tenantId, recipe.publicId, v1.publicId, NOW)).version;
    expect(stillV1.lines.map((line) => line.quantity)).toEqual(["1000", "72", "0.02"]);

    // Approving v2 on or before v1's date is refused; a later date ends v1 there.
    expect(await rejection(approveVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, v2.publicId, { expectedVersion: v2.version + 1, effectiveFrom: "2026-11-01" }, NOW))).toMatchObject({
      statusCode: 409,
      code: "effective_from_before_current",
    });
    const second = await approveVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, v2.publicId, {
      expectedVersion: v2.version + 1,
      effectiveFrom: "2026-12-01",
    }, NOW);
    expect(second.effect).toEqual({
      versionNumber: 2,
      effectiveFrom: "2026-12-01",
      supersededVersion: 1,
      supersededCovers: { from: "2026-11-01", to: "2026-11-30" },
      resolvesFrom: "2026-12-01",
      scheduled: true,
      backdated: false,
      postedUsageAffected: 0,
    });
    const history = second.versions;
    expect(history.map((entry) => [entry.versionNumber, entry.status, entry.phase, entry.effectiveFrom, entry.effectiveTo])).toEqual([
      [2, "approved", "scheduled", "2026-12-01", null],
      [1, "approved", "current", "2026-11-01", "2026-12-01"],
    ]);

    // A third draft can be discarded; it stays in the history as discarded.
    const third = await createDraftFromVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, { fromVersionPublicId: v1.publicId }, NOW);
    const discarded = await updateDraftVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, third.versions[0]!.publicId, {
      expectedVersion: 1,
      status: "discarded",
    }, NOW);
    expect(discarded.versions.map((entry) => [entry.versionNumber, entry.status])).toEqual([
      [3, "discarded"],
      [2, "approved"],
      [1, "approved"],
    ]);

    expect((await auditActions(sql, tenantId)).filter((row) => row.action.startsWith("recipe.")).map((row) => row.action)).toEqual([
      "recipe.create",
      "recipe.version.update",
      "recipe.version.lines.update",
      "recipe.version.steps.update",
      "recipe.version.approve",
      "recipe.version.create",
      "recipe.version.lines.update",
      "recipe.version.approve",
      "recipe.version.create",
      "recipe.version.discard",
    ]);
  });

  it("allows a backdated approval only after the current version's date and states its effect", async () => {
    const { recipe, v1 } = await approvedLatte("2026-10-01");
    const draft = (await createDraftFromVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, { fromVersionPublicId: v1.publicId }, NOW)).versions[0]!;
    expect(await rejection(approveVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: draft.version, effectiveFrom: "2026-09-30" }, NOW))).toMatchObject({
      code: "effective_from_before_current",
    });
    const backdated = await approveVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
      expectedVersion: draft.version,
      effectiveFrom: "2026-11-05",
    }, NOW);
    expect(backdated.effect).toMatchObject({
      supersededVersion: 1,
      supersededCovers: { from: "2026-10-01", to: "2026-11-04" },
      resolvesFrom: "2026-11-05",
      backdated: true,
      scheduled: false,
      postedUsageAffected: 0,
    });
    expect(backdated.versions.map((entry) => entry.phase)).toEqual(["current", "ended"]);
  });

  it("refuses archiving while a sellable link is live, listing the dependency, and archives once the link has ended", async () => {
    const { recipe } = await approvedLatte();
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: recipe.publicId }, NOW);
    const links = await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.large, kind: "recipe", recipePublicId: recipe.publicId }, NOW);
    const refused = await updateRecipe(db, tenantId, ADMIN, ACTOR, recipe.publicId, { expectedVersion: recipe.version, status: "archived" }, NOW).catch(
      (error: { statusCode: number; code: string; dependencies: unknown }) => error,
    );
    expect(refused).toMatchObject({ statusCode: 409, code: "recipe_in_use", dependencies: [{ kind: "sellable_links", count: 2 }] });
    for (const row of links.variants.filter((entry) => entry.link?.recipe?.publicId === recipe.publicId)) {
      await updateSellableLink(db, tenantId, ADMIN, ACTOR, row.link!.publicId, { operation: "end" }, NOW);
    }
    const archived = await updateRecipe(db, tenantId, ADMIN, ACTOR, recipe.publicId, { expectedVersion: recipe.version, status: "archived" }, NOW);
    expect(archived.recipe.status).toBe("archived");
    // An archived family cannot take a new draft or a new link.
    expect(await rejection(createDraftFromVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, { fromVersionPublicId: archived.versions[0]!.publicId }, NOW))).toMatchObject({
      code: "recipe_archived",
    });
    const restored = await updateRecipe(db, tenantId, ADMIN, ACTOR, recipe.publicId, { expectedVersion: archived.recipe.version, status: "active", nameEn: "House latte" }, NOW);
    expect(restored.recipe).toMatchObject({ status: "active", nameEn: "House latte" });
    expect((await auditActions(sql, tenantId)).map((row) => row.action)).toEqual(
      expect.arrayContaining(["recipe.archive", "recipe.restore"]),
    );
  });

  it("refuses another business's items, units, recipes and versions as not found", async () => {
    const { recipe, draft } = await latteDraft();
    const foreignLine = await rejection(
      replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
        expectedVersion: 1,
        lines: [{ itemPublicId: other.items.milk, quantity: "1", unitPublicId: fx.units.ml }],
      }, NOW),
    );
    expect(foreignLine).toMatchObject({ statusCode: 404, code: "item_not_found" });
    const foreignUnit = await rejection(
      replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe.publicId, draft.publicId, {
        expectedVersion: 1,
        lines: [{ itemPublicId: fx.items.milk, quantity: "1", unitPublicId: other.units.ml }],
      }, NOW),
    );
    expect(foreignUnit).toMatchObject({ statusCode: 404, code: "unit_not_found" });
    expect(await rejection(getRecipe(db, otherTenantId, recipe.publicId))).toMatchObject({ statusCode: 404, code: "recipe_not_found" });
    const otherRecipe = await createRecipe(db, otherTenantId, ADMIN, ACTOR, { nameEn: "Other", kind: "sellable" }, NOW);
    expect(
      await rejection(updateDraftVersion(db, tenantId, ADMIN, ACTOR, recipe.publicId, otherRecipe.versions[0]!.publicId, { expectedVersion: 1, notes: "x" }, NOW)),
    ).toMatchObject({ statusCode: 404, code: "version_not_found" });
    expect((await listRecipes(db, otherTenantId, NOW)).recipes.map((entry) => entry.nameEn)).toEqual(["Other"]);
  });

  it("lets members read but only administrators write", async () => {
    const { recipe, draft } = await latteDraft();
    expect((await getRecipe(db, tenantId, recipe.publicId)).recipe.publicId).toBe(recipe.publicId);
    for (const attempt of [
      createRecipe(db, tenantId, USER, ACTOR, { nameEn: "Tea", kind: "sellable" }, NOW),
      updateRecipe(db, tenantId, USER, ACTOR, recipe.publicId, { expectedVersion: 1, nameEn: "X" }, NOW),
      updateDraftVersion(db, tenantId, USER, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 1, notes: "x" }, NOW),
      replaceDraftLines(db, tenantId, USER, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 1, lines: [] }, NOW),
      replaceDraftSteps(db, tenantId, USER, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 1, steps: [] }, NOW),
      approveVersion(db, tenantId, USER, ACTOR, recipe.publicId, draft.publicId, { expectedVersion: 1, effectiveFrom: "2026-11-10" }, NOW),
      createDraftFromVersion(db, tenantId, USER, ACTOR, recipe.publicId, { fromVersionPublicId: draft.publicId }, NOW),
    ]) {
      expect(await rejection(attempt)).toMatchObject({ statusCode: 403, code: "administrator_required" });
    }
    expect((await auditActions(sql, tenantId)).filter((row) => row.action.startsWith("recipe.")).map((row) => row.action)).toEqual(["recipe.create"]);
  });

  it("lists families with their current version, draft, shared assignment, states and an unknown-safe cost", async () => {
    const { recipe, v1 } = await approvedLatte();
    let list = (await listRecipes(db, tenantId, NOW)).recipes;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      publicId: recipe.publicId,
      current: { publicId: v1.publicId, versionNumber: 1, effectiveFrom: "2026-11-01", yieldQuantity: "4", yieldUnitCode: "portion" },
      draft: null,
      linkedVariantCount: 0,
      shared: false,
      cost: { status: "unavailable", linesWithoutCost: 3 },
    });
    expect(list[0]!.states).toEqual(expect.arrayContaining(["no_assignment", "cost_unknown"]));
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: recipe.publicId }, NOW);
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.large, kind: "recipe", recipePublicId: recipe.publicId }, NOW);
    list = (await listRecipes(db, tenantId, NOW)).recipes;
    expect(list[0]).toMatchObject({ linkedVariantCount: 2, shared: true });
    expect(list[0]!.states).not.toContain("no_assignment");
    // Sharing never copies a family.
    const [{ families }] = await sql<{ families: number }[]>`SELECT count(*)::int AS families FROM qos.recipes WHERE tenant_id = ${tenantId}`;
    expect(families).toBe(1);
  });
});
