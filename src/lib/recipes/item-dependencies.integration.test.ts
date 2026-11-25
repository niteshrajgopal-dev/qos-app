import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { ACTOR, ADMIN, type IntegrationConnection, truncateInventory } from "@/lib/inventory/integration-helpers";
import { getItem, updateItem } from "@/lib/inventory/items";
import { getUnit, updateUnit } from "@/lib/inventory/units";
import { createSellableLink, updateSellableLink } from "@/lib/recipes/links";
import { seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { createRecipe, updateRecipe } from "@/lib/recipes/recipes";
import { replaceDraftLines, updateDraftVersion } from "@/lib/recipes/versions";
import { quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;
const NOW = new Date("2026-11-10T08:00:00Z");

/* QOS-198 archive hooks: an item or unit used by a recipe or a sellable link
   cannot be archived, a prepared item made by an active recipe keeps its kind,
   and the item screen lists the real usage. */
integrationDescribe("recipe dependencies on items and units", () => {
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

  async function archive(itemPublicId: string) {
    const item = await getItem(db, tenantId, itemPublicId);
    return updateItem(db, tenantId, ADMIN, ACTOR, itemPublicId, { expectedVersion: item.item.version, status: "archived" }).catch(
      (error: { statusCode: number; code: string; dependencies: unknown }) => error,
    );
  }

  it("refuses archiving an item used by a draft line, a direct-stock link or as a prepared recipe's output, listing each dependency", async () => {
    const latte = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable" }, NOW);
    await replaceDraftLines(db, tenantId, ADMIN, ACTOR, latte.recipe.publicId, latte.versions[0]!.publicId, {
      expectedVersion: 1,
      lines: [{ itemPublicId: fx.items.milk, quantity: "250", unitPublicId: fx.units.ml }],
    }, NOW);
    const syrup = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Syrup", kind: "prepared", outputItemPublicId: fx.items.syrup }, NOW);
    const links = await createSellableLink(db, tenantId, ADMIN, ACTOR, {
      variantPublicId: fx.water.variant,
      kind: "direct_stock",
      itemPublicId: fx.items.water,
      quantity: "1",
      unitPublicId: fx.units.bottle,
    }, NOW);

    expect(await archive(fx.items.milk)).toMatchObject({ statusCode: 409, code: "item_in_use", dependencies: [{ kind: "recipe_lines", count: 1 }] });
    expect(await archive(fx.items.water)).toMatchObject({ code: "item_in_use", dependencies: [{ kind: "sellable_links", count: 1 }] });
    expect(await archive(fx.items.syrup)).toMatchObject({ code: "item_in_use", dependencies: [{ kind: "recipe_outputs", count: 1 }] });
    // A prepared item made by an active recipe keeps its kind.
    const syrupItem = await getItem(db, tenantId, fx.items.syrup);
    const kindChange = await updateItem(db, tenantId, ADMIN, ACTOR, fx.items.syrup, { expectedVersion: syrupItem.item.version, kind: "purchased" }).catch(
      (error: { statusCode: number; code: string; field: string; dependencies: unknown }) => error,
    );
    expect(kindChange).toMatchObject({ statusCode: 409, code: "item_in_use", field: "kind", dependencies: [{ kind: "recipe_outputs", count: 1 }] });
    // An unrelated item still archives.
    expect(await archive(fx.items.beans)).toMatchObject({ item: { status: "archived" } });

    // The item screen lists the real usage.
    expect((await getItem(db, tenantId, fx.items.milk)).usage).toEqual({
      recipeLines: [{ recipePublicId: latte.recipe.publicId, nameEn: "Latte", nameAr: null, versionNumber: 1, phase: "draft" }],
      outputOf: [],
      directStockLinks: 0,
    });
    expect((await getItem(db, tenantId, fx.items.syrup)).usage.outputOf).toEqual([
      { recipePublicId: syrup.recipe.publicId, nameEn: "Syrup", nameAr: null },
    ]);
    expect((await getItem(db, tenantId, fx.items.water)).usage.directStockLinks).toBe(1);

    // Once the uses end, archive succeeds.
    const waterLink = links.variants.find((row) => row.variantPublicId === fx.water.variant)!.link!.publicId;
    await updateSellableLink(db, tenantId, ADMIN, ACTOR, waterLink, { operation: "end" }, NOW);
    expect(await archive(fx.items.water)).toMatchObject({ item: { status: "archived" } });
    await updateRecipe(db, tenantId, ADMIN, ACTOR, syrup.recipe.publicId, { expectedVersion: 1, status: "archived" }, NOW);
    expect(await archive(fx.items.syrup)).toMatchObject({ item: { status: "archived" } });
    await updateDraftVersion(db, tenantId, ADMIN, ACTOR, latte.recipe.publicId, latte.versions[0]!.publicId, { expectedVersion: 2, status: "discarded" }, NOW);
    expect(await archive(fx.items.milk)).toMatchObject({ item: { status: "archived" } });
  });

  it("refuses archiving a unit used as a yield unit, a line unit or a direct-stock unit", async () => {
    const cupcake = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Cupcake", kind: "sellable", yieldQuantity: "12", yieldUnitPublicId: fx.units.portion }, NOW);
    expect((await getUnit(db, tenantId, fx.units.portion)).usage).toMatchObject({ itemDesignations: 0, recipeUsages: 1 });
    const portion = await getUnit(db, tenantId, fx.units.portion);
    const refused = await updateUnit(db, tenantId, ADMIN, ACTOR, fx.units.portion, { expectedVersion: portion.unit.version, status: "archived" }).catch(
      (error: { statusCode: number; code: string }) => error,
    );
    expect(refused).toMatchObject({ statusCode: 409, code: "unit_in_use" });
    await updateDraftVersion(db, tenantId, ADMIN, ACTOR, cupcake.recipe.publicId, cupcake.versions[0]!.publicId, { expectedVersion: 1, status: "discarded" }, NOW);
    expect((await getUnit(db, tenantId, fx.units.portion)).usage.recipeUsages).toBe(0);
    const archived = await updateUnit(db, tenantId, ADMIN, ACTOR, fx.units.portion, { expectedVersion: portion.unit.version, status: "archived" });
    expect(archived.status).toBe("archived");
  });
});
