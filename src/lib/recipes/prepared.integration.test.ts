import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { ACTOR, ADMIN, type IntegrationConnection, rejection, truncateInventory } from "@/lib/inventory/integration-helpers";
import { createSellableLink } from "@/lib/recipes/links";
import { seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { createRecipe, getRecipe, updateRecipe } from "@/lib/recipes/recipes";
import { approveVersion, createDraftFromVersion, replaceDraftLines } from "@/lib/recipes/versions";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;
const NOW = new Date("2026-11-10T08:00:00Z");

integrationDescribe("prepared recipes", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
  let fx: RecipeFixtures;

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
    fx = await seedRecipeFixtures(db, tenantId);
  });

  async function prepared(nameEn: string, outputItemPublicId: string, lines: Array<{ item: string; quantity: string; unit: string }>, approveOn?: string) {
    const created = await createRecipe(db, tenantId, ADMIN, ACTOR, {
      nameEn,
      kind: "prepared",
      outputItemPublicId,
      yieldQuantity: "2",
      yieldUnitPublicId: fx.units.l,
    }, NOW);
    const draft = created.versions[0]!;
    const withLines = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, created.recipe.publicId, draft.publicId, {
      expectedVersion: draft.version,
      lines: lines.map((line) => ({ itemPublicId: line.item, quantity: line.quantity, unitPublicId: line.unit })),
    }, NOW);
    if (!approveOn) return withLines;
    return approveVersion(db, tenantId, ADMIN, ACTOR, created.recipe.publicId, draft.publicId, {
      expectedVersion: withLines.versions[0]!.version,
      effectiveFrom: approveOn,
    }, NOW);
  }

  it("names an explicit prepared output item and yield unit, and keeps one active family per output item", async () => {
    const syrup = await prepared("Vanilla syrup", fx.items.syrup, [{ item: fx.items.sugar, quantity: "1", unit: fx.units.kg }], "2026-11-01");
    expect(syrup.recipe).toMatchObject({ kind: "prepared", outputItem: { publicId: fx.items.syrup, kind: "prepared", storageUnitCode: "l" } });
    expect(syrup.versions[0]).toMatchObject({ status: "approved", yieldQuantity: "2", yieldUnit: { code: "l" } });
    expect(await rejection(createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Syrup 2", kind: "prepared", outputItemPublicId: fx.items.syrup }, NOW))).toMatchObject({
      statusCode: 409,
      code: "output_item_taken",
    });
    expect(await rejection(createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Milk", kind: "prepared", outputItemPublicId: fx.items.milk }, NOW))).toMatchObject({
      statusCode: 400,
      code: "output_item_not_prepared",
    });
    expect(await rejection(createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Sauce", kind: "prepared" }, NOW))).toMatchObject({
      code: "output_item_required",
    });
    expect(await rejection(createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable", outputItemPublicId: fx.items.syrup }, NOW))).toMatchObject({
      code: "output_item_not_allowed",
    });
    expect(await rejection(createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "bundle" }, NOW))).toMatchObject({
      code: "recipe_kind_invalid",
    });
    // Kind and output are fixed once a version is approved.
    expect(
      await rejection(updateRecipe(db, tenantId, ADMIN, ACTOR, syrup.recipe.publicId, { expectedVersion: 1, kind: "sellable" }, NOW)),
    ).toMatchObject({ statusCode: 409, code: "recipe_kind_immutable" });
  });

  it("refuses a recipe that uses its own output item", async () => {
    const error = await prepared("Vanilla syrup", fx.items.syrup, [{ item: fx.items.syrup, quantity: "0.1", unit: fx.units.l }]).catch(
      (caught: { statusCode: number; code: string; detail: unknown }) => caught,
    );
    expect(error).toMatchObject({
      statusCode: 409,
      code: "recipe_cycle",
      detail: { path: [{ itemPublicId: fx.items.syrup, nameEn: "Vanilla syrup" }, { itemPublicId: fx.items.syrup }] },
    });
  });

  it("refuses an indirect cycle through another prepared recipe on save", async () => {
    // Sauce base uses vanilla syrup (approved); vanilla syrup may not use sauce base.
    await prepared("Vanilla syrup", fx.items.syrup, [{ item: fx.items.sugar, quantity: "1", unit: fx.units.kg }], "2026-11-01");
    await prepared("Sauce base", fx.items.base, [{ item: fx.items.syrup, quantity: "0.5", unit: fx.units.l }], "2026-11-01");
    const syrup = (await getRecipeByName("Vanilla syrup"))!;
    const draft = (await createDraftFromVersion(db, tenantId, ADMIN, ACTOR, syrup, { fromVersionPublicId: (await getRecipe(db, tenantId, syrup)).versions[0]!.publicId }, NOW)).versions[0]!;
    const error = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, syrup, draft.publicId, {
      expectedVersion: draft.version,
      lines: [
        { itemPublicId: fx.items.sugar, quantity: "1", unitPublicId: fx.units.kg },
        { itemPublicId: fx.items.base, quantity: "0.1", unitPublicId: fx.units.l },
      ],
    }, NOW).catch((caught: { statusCode: number; code: string; detail: { path: Array<{ nameEn: string }> } }) => caught);
    expect(error).toMatchObject({ statusCode: 409, code: "recipe_cycle" });
    expect((error as { detail: { path: Array<{ nameEn: string }> } }).detail.path.map((entry) => entry.nameEn)).toEqual([
      "Vanilla syrup",
      "Sauce base",
      "Vanilla syrup",
    ]);
  });

  it("refuses a cycle on approve even when the lines were written around the service", async () => {
    await prepared("Sauce base", fx.items.base, [{ item: fx.items.syrup, quantity: "0.5", unit: fx.units.l }], "2026-11-01");
    const syrup = await prepared("Vanilla syrup", fx.items.syrup, [{ item: fx.items.sugar, quantity: "1", unit: fx.units.kg }]);
    const draft = syrup.versions[0]!;
    // Simulate a line that reached the draft without the save-time check.
    await sql`
      INSERT INTO qos.recipe_version_lines (tenant_id, public_id, recipe_version_id, item_id, unit_id, quantity_micros, position)
      SELECT v.tenant_id, 'recl_injected', v.id, i.id, u.id, 100000, 5
      FROM qos.recipe_versions v, qos.inventory_items i, qos.inventory_units u
      WHERE v.public_id = ${draft.publicId} AND i.public_id = ${fx.items.base} AND u.public_id = ${fx.units.l}`;
    expect(
      await rejection(approveVersion(db, tenantId, ADMIN, ACTOR, syrup.recipe.publicId, draft.publicId, { expectedVersion: draft.version, effectiveFrom: "2026-11-10" }, NOW)),
    ).toMatchObject({ statusCode: 409, code: "recipe_cycle" });
    const [{ status }] = await sql<{ status: string }[]>`SELECT status FROM qos.recipe_versions WHERE public_id = ${draft.publicId}`;
    expect(status).toBe("draft");
  });

  it("accepts a prepared item as a line of a sellable recipe and writes nothing but recipe and audit rows", async () => {
    const tables = await sql<{ table_name: string }[]>`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'qos' AND table_type = 'BASE TABLE' ORDER BY table_name`;
    // There is no stock, ledger or production table to write to.
    expect(tables.map((row) => row.table_name).filter((name) => /stock|ledger|production|movement/.test(name))).toEqual([]);
    const counts = async () =>
      Object.fromEntries(
        await Promise.all(
          tables.map(async ({ table_name }) => {
            const [row] = await sql.unsafe<{ count: number }[]>(`SELECT count(*)::int AS count FROM qos."${table_name}"`);
            return [table_name, row!.count] as const;
          }),
        ),
      );
    const before = await counts();

    await prepared("Vanilla syrup", fx.items.syrup, [{ item: fx.items.sugar, quantity: "1", unit: fx.units.kg }], "2026-11-01");
    const latte = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Vanilla latte", kind: "sellable", yieldQuantity: "1", yieldUnitPublicId: fx.units.portion }, NOW);
    const lines = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, latte.recipe.publicId, latte.versions[0]!.publicId, {
      expectedVersion: latte.versions[0]!.version,
      lines: [
        { itemPublicId: fx.items.milk, quantity: "250", unitPublicId: fx.units.ml },
        { itemPublicId: fx.items.syrup, quantity: "20", unitPublicId: fx.units.ml },
      ],
    }, NOW);
    expect(lines.versions[0]!.lines[1]).toMatchObject({ item: { publicId: fx.items.syrup, kind: "prepared" }, quantity: "20" });
    await approveVersion(db, tenantId, ADMIN, ACTOR, latte.recipe.publicId, latte.versions[0]!.publicId, {
      expectedVersion: lines.versions[0]!.version,
      effectiveFrom: "2026-11-10",
    }, NOW);
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: latte.recipe.publicId }, NOW);

    const after = await counts();
    const changed = Object.keys(after).filter((name) => after[name] !== before[name]).sort();
    expect(changed).toEqual([
      "recipe_sellable_links",
      "recipe_version_lines",
      "recipe_version_snapshots",
      "recipe_versions",
      "recipes",
      "tenant_audit_events",
    ]);
  });

  async function getRecipeByName(nameEn: string) {
    const [row] = await sql<{ public_id: string }[]>`SELECT public_id FROM qos.recipes WHERE tenant_id = ${tenantId} AND name_en = ${nameEn}`;
    return row?.public_id;
  }
});
