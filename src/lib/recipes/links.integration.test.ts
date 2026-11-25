import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { ACTOR, ADMIN, auditActions, type IntegrationConnection, rejection, truncateInventory, USER } from "@/lib/inventory/integration-helpers";
import { createSellableLink, listSellableLinks, updateSellableLink } from "@/lib/recipes/links";
import { seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { createRecipe } from "@/lib/recipes/recipes";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;
const NOW = new Date("2026-11-10T08:00:00Z");

integrationDescribe("sellable links", () => {
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

  const link = (body: Record<string, unknown>, tenant = tenantId) => createSellableLink(db, tenant, ADMIN, ACTOR, body, NOW);
  const row = (view: Awaited<ReturnType<typeof listSellableLinks>>, variantPublicId: string) =>
    view.variants.find((entry) => entry.variantPublicId === variantPublicId)!;

  it("lists every sellable variant with its missing states, including the stock-product flag without a link", async () => {
    const view = await listSellableLinks(db, tenantId, NOW);
    expect(view.today).toBe("2026-11-10");
    expect(view.variants.map((entry) => [entry.productNameEn, entry.variantNameEn, entry.states])).toEqual([
      ["Latte", "Regular", ["unlinked"]],
      ["Latte", "Large", ["unlinked"]],
      ["Water", null, ["needs_direct_stock_link"]],
    ]);
    expect(row(view, fx.water.variant)).toMatchObject({ directStockIntent: true, link: null, productNameAr: "ماء" });
  });

  it("shares one family across variants without copying it, and labels shared and direct-stock links as outside the workbook", async () => {
    const latte = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable" }, NOW);
    let view = await link({ variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: latte.recipe.publicId });
    expect(row(view, fx.latte.regular).link).toMatchObject({
      kind: "recipe",
      revision: 1,
      effectiveFrom: "2026-11-10",
      workbookProfile: "default",
      recipe: { publicId: latte.recipe.publicId, currentVersionNumber: null, hasDraft: true, linkedVariantCount: 1 },
    });
    expect(row(view, fx.latte.regular).states).toEqual(["draft_pending"]);
    view = await link({ variantPublicId: fx.latte.large, kind: "recipe", recipePublicId: latte.recipe.publicId });
    for (const variant of [fx.latte.regular, fx.latte.large]) {
      expect(row(view, variant).link).toMatchObject({ workbookProfile: "shared", recipe: { linkedVariantCount: 2 } });
    }
    const [{ families, links }] = await sql<{ families: number; links: number }[]>`
      SELECT (SELECT count(*)::int FROM qos.recipes WHERE tenant_id = ${tenantId}) AS families,
             (SELECT count(DISTINCT recipe_id)::int FROM qos.recipe_sellable_links WHERE tenant_id = ${tenantId}) AS links`;
    expect({ families, links }).toEqual({ families: 1, links: 1 });

    view = await link({ variantPublicId: fx.water.variant, kind: "direct_stock", itemPublicId: fx.items.water, quantity: "1", unitPublicId: fx.units.bottle });
    expect(row(view, fx.water.variant)).toMatchObject({
      states: [],
      link: {
        kind: "direct_stock",
        recipe: null,
        workbookProfile: "direct_stock",
        directStock: { item: { publicId: fx.items.water }, quantity: "1", unit: { code: "bottle" }, inStorageUnit: { text: "1" } },
      },
    });
  });

  it("keeps a recipe link and a direct-stock link exclusive per variant, replacing by ending and inserting a revision", async () => {
    const latte = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable" }, NOW);
    await link({ variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: latte.recipe.publicId });
    expect(
      await rejection(link({ variantPublicId: fx.latte.regular, kind: "direct_stock", itemPublicId: fx.items.milk, quantity: "250", unitPublicId: fx.units.ml })),
    ).toMatchObject({ statusCode: 409, code: "link_exists" });
    const replaced = await link({
      variantPublicId: fx.latte.regular,
      kind: "direct_stock",
      itemPublicId: fx.items.milk,
      quantity: "250",
      unitPublicId: fx.units.ml,
      replace: true,
    });
    expect(row(replaced, fx.latte.regular).link).toMatchObject({
      kind: "direct_stock",
      revision: 2,
      directStock: { quantity: "250", inStorageUnit: { text: "0.250" } },
    });
    const rows = await sql<{ kind: string; revision: number; effective_from: string; effective_to: string | null }[]>`
      SELECT l.kind, l.revision, l.effective_from::text, l.effective_to::text FROM qos.recipe_sellable_links l
      JOIN qos.catalogue_variants v ON v.id = l.variant_id WHERE v.public_id = ${fx.latte.regular} ORDER BY l.revision`;
    expect(rows).toEqual([
      { kind: "recipe", revision: 1, effective_from: "2026-11-10", effective_to: "2026-11-10" },
      { kind: "direct_stock", revision: 2, effective_from: "2026-11-10", effective_to: null },
    ]);
    const actions = (await auditActions(sql, tenantId)).filter((entry) => entry.entity_type === "recipe_sellable_link").map((entry) => entry.action);
    // The replace writes its end and create events in one transaction (same timestamp), so compare them unordered.
    expect(actions[0]).toBe("recipe.link.create");
    expect(actions.slice(1).sort()).toEqual(["recipe.link.create", "recipe.link.end"]);
  });

  it("ends a link on today or a given date, never before it started, and refuses ending it twice", async () => {
    const view = await link({ variantPublicId: fx.water.variant, kind: "direct_stock", itemPublicId: fx.items.water, quantity: "1", unitPublicId: fx.units.bottle, effectiveFrom: "2026-11-12" });
    const linkPublicId = row(view, fx.water.variant).link!.publicId;
    expect(row(view, fx.water.variant).link!.scheduled).toBe(true);
    expect(await rejection(updateSellableLink(db, tenantId, ADMIN, ACTOR, linkPublicId, { operation: "end", effectiveTo: "2026-11-11" }, NOW))).toMatchObject({
      code: "effective_from_before_current",
    });
    expect(await rejection(updateSellableLink(db, tenantId, ADMIN, ACTOR, linkPublicId, { operation: "close" }, NOW))).toMatchObject({
      code: "operation_invalid",
    });
    const ended = await updateSellableLink(db, tenantId, ADMIN, ACTOR, linkPublicId, { operation: "end", effectiveTo: "2026-11-20" }, NOW);
    expect(row(ended, fx.water.variant).link).toMatchObject({ publicId: linkPublicId, effectiveTo: "2026-11-20" });
    expect(await rejection(updateSellableLink(db, tenantId, ADMIN, ACTOR, linkPublicId, { operation: "end" }, NOW))).toMatchObject({
      statusCode: 409,
      code: "link_not_current",
    });
    expect(await rejection(updateSellableLink(db, tenantId, ADMIN, ACTOR, "link_missing", { operation: "end" }, NOW))).toMatchObject({
      statusCode: 404,
      code: "link_not_found",
    });
  });

  it("refuses prepared families, archived recipes, archived variants, incomplete direct links and other businesses' records", async () => {
    const prepared = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Syrup", kind: "prepared", outputItemPublicId: fx.items.syrup }, NOW);
    expect(await rejection(link({ variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: prepared.recipe.publicId }))).toMatchObject({
      statusCode: 400,
      code: "recipe_kind_not_sellable",
    });
    expect(await rejection(link({ variantPublicId: fx.latte.regular, kind: "direct_stock", itemPublicId: fx.items.milk }))).toMatchObject({
      code: "direct_stock_fields_required",
    });
    expect(await rejection(link({ variantPublicId: fx.latte.regular, kind: "bundle" }))).toMatchObject({ code: "link_kind_invalid" });
    expect(
      await rejection(link({ variantPublicId: fx.latte.regular, kind: "direct_stock", itemPublicId: fx.items.milk, quantity: "0.5", unitPublicId: fx.units.ml })),
    ).toMatchObject({ code: "quantity_too_precise" });
    // Another business's variant, recipe and item are not found.
    const otherRecipe = await createRecipe(db, otherTenantId, ADMIN, ACTOR, { nameEn: "Other", kind: "sellable" }, NOW);
    expect(await rejection(link({ variantPublicId: other.latte.regular, kind: "recipe", recipePublicId: prepared.recipe.publicId }))).toMatchObject({
      statusCode: 404,
      code: "variant_not_found",
    });
    expect(await rejection(link({ variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: otherRecipe.recipe.publicId }))).toMatchObject({
      statusCode: 404,
      code: "recipe_not_found",
    });
    expect(
      await rejection(link({ variantPublicId: fx.latte.regular, kind: "direct_stock", itemPublicId: other.items.water, quantity: "1", unitPublicId: fx.units.bottle })),
    ).toMatchObject({ statusCode: 404, code: "item_not_found" });
    // An archived variant, and a variant of an archived product, are refused (archived directly as test setup).
    const sellable = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable" }, NOW);
    await sql`UPDATE qos.catalogue_variants SET status = 'archived' WHERE public_id = ${fx.latte.large}`;
    expect(await rejection(link({ variantPublicId: fx.latte.large, kind: "recipe", recipePublicId: sellable.recipe.publicId }))).toMatchObject({
      statusCode: 400,
      code: "variant_archived",
    });
    await sql`UPDATE qos.catalogue_products SET status = 'archived' WHERE public_id = ${fx.water.productPublicId}`;
    expect(
      await rejection(link({ variantPublicId: fx.water.variant, kind: "direct_stock", itemPublicId: fx.items.water, quantity: "1", unitPublicId: fx.units.bottle })),
    ).toMatchObject({ statusCode: 400, code: "product_archived" });
    expect(await rejection(createSellableLink(db, tenantId, USER, ACTOR, { variantPublicId: fx.latte.regular, kind: "recipe" }, NOW))).toMatchObject({
      statusCode: 403,
      code: "administrator_required",
    });
    // The other business sees none of this business's links.
    expect((await listSellableLinks(db, otherTenantId, NOW)).variants.every((entry) => entry.link === null)).toBe(true);
  });

  it("shows a recipe link beside the stock-product flag as a conflict and a direct link without a conversion as missing", async () => {
    const sellable = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Water recipe", kind: "sellable" }, NOW);
    let view = await link({ variantPublicId: fx.water.variant, kind: "recipe", recipePublicId: sellable.recipe.publicId });
    expect(row(view, fx.water.variant).states).toEqual(["flag_conflicts_with_recipe", "draft_pending"]);
    view = await link({ variantPublicId: fx.latte.regular, kind: "direct_stock", itemPublicId: fx.items.beans, quantity: "1", unitPublicId: fx.units.bottle });
    expect(row(view, fx.latte.regular)).toMatchObject({ states: ["missing_conversion"], link: { directStock: { inStorageUnit: null } } });
  });
});
