import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { grantRoleMembership, hasIntegrationDatabase, resetAndMigrate } from "@/db/test-utils";
import { createConversion, updateConversion } from "@/lib/inventory/conversions";
import { ACTOR, ADMIN, type IntegrationConnection, rejection, truncateInventory } from "@/lib/inventory/integration-helpers";
import { createUnit } from "@/lib/inventory/units";
import { createSellableLink } from "@/lib/recipes/links";
import { seedRecipeFixtures, type RecipeFixtures } from "@/lib/recipes/integration-helpers";
import { createRecipe } from "@/lib/recipes/recipes";
import { getConsumptionPreview } from "@/lib/recipes/resolution-service";
import { approveVersion, createDraftFromVersion, replaceDraftLines } from "@/lib/recipes/versions";
import { flowerTenantFixture, quotesTenantFixture } from "@/lib/tenant/fixtures";
import { createTenantHierarchy } from "@/lib/tenant/repository";

const integrationDescribe = hasIntegrationDatabase() ? describe : describe.skip;
const NOW = new Date("2026-11-10T08:00:00Z");

integrationDescribe("consumption preview", () => {
  let db: IntegrationConnection["db"];
  let sql: IntegrationConnection["sql"];
  let tenantId: string;
  let otherTenantId: string;
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
    otherTenantId = (await createTenantHierarchy(db, flowerTenantFixture())).tenant.id;
    fx = await seedRecipeFixtures(db, tenantId);
  });

  const preview = (variantPublicId: string, date?: string, quantity?: string) =>
    getConsumptionPreview(db, tenantId, { variantPublicId, date: date ?? null, quantity: quantity ?? null }, NOW);

  it("resolves the version effective on each business date, divides by the yield and never picks the draft", async () => {
    const created = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable", yieldQuantity: "4", yieldUnitPublicId: fx.units.portion }, NOW);
    const recipe = created.recipe.publicId;
    const v1 = created.versions[0]!;
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: recipe, effectiveFrom: "2026-11-01" }, NOW);
    // Only a draft exists: nothing resolves.
    expect(await preview(fx.latte.regular, "2026-11-10")).toMatchObject({ status: "unresolved", reason: "draft_only", lines: [] });

    let detail = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe, v1.publicId, {
      expectedVersion: v1.version,
      lines: [
        { itemPublicId: fx.items.milk, quantity: "1000", unitPublicId: fx.units.ml },
        { itemPublicId: fx.items.beans, quantity: "72", unitPublicId: fx.units.g },
      ],
    }, NOW);
    detail = await approveVersion(db, tenantId, ADMIN, ACTOR, recipe, v1.publicId, { expectedVersion: detail.versions[0]!.version, effectiveFrom: "2026-11-01" }, NOW);
    const v2 = (await createDraftFromVersion(db, tenantId, ADMIN, ACTOR, recipe, { fromVersionPublicId: v1.publicId }, NOW)).versions[0]!;
    detail = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, recipe, v2.publicId, {
      expectedVersion: v2.version,
      lines: [
        { itemPublicId: fx.items.milk, quantity: "1200", unitPublicId: fx.units.ml },
        { itemPublicId: fx.items.beans, quantity: "80", unitPublicId: fx.units.g },
      ],
    }, NOW);
    await approveVersion(db, tenantId, ADMIN, ACTOR, recipe, v2.publicId, { expectedVersion: detail.versions[0]!.version, effectiveFrom: "2026-12-01" }, NOW);
    // A newer draft (v3) exists but is never chosen.
    await createDraftFromVersion(db, tenantId, ADMIN, ACTOR, recipe, { fromVersionPublicId: v2.publicId }, NOW);

    const today = await preview(fx.latte.regular);
    expect(today).toMatchObject({
      businessDate: "2026-11-10",
      status: "resolved",
      kind: "recipe",
      soldQuantity: 1,
      version: { versionNumber: 1, yieldQuantity: "4", yieldUnitCode: "portion" },
      recipe: { publicId: recipe },
      complete: true,
      productNameEn: "Latte",
      variantNameEn: "Regular",
    });
    expect(today.lines.map((line) => [line.item.nameEn, line.quantity, line.unitCode, line.perSale?.text, line.storageUnitCode])).toEqual([
      ["Milk", "1000", "ml", "0.250", "l"],
      ["Coffee beans", "72", "g", "0.018", "kg"],
    ]);
    const lastDay = await preview(fx.latte.regular, "2026-11-30", "3");
    expect(lastDay).toMatchObject({ version: { versionNumber: 1 } });
    expect(lastDay.lines.map((line) => line.total?.text)).toEqual(["0.750", "0.054"]);
    const december = await preview(fx.latte.regular, "2026-12-01");
    expect(december).toMatchObject({ version: { versionNumber: 2 } });
    expect(december.lines.map((line) => line.perSale?.text)).toEqual(["0.300", "0.020"]);
    // Before the link started there is nothing to resolve.
    expect(await preview(fx.latte.regular, "2026-10-31")).toMatchObject({ status: "unresolved", reason: "no_link" });
  });

  it("uses the item's conversion rule live on the business date and refuses to guess an incompatible unit", async () => {
    const cup = await createUnit(db, tenantId, ADMIN, ACTOR, { source: "custom", code: "cup", nameEn: "Cup", nameAr: "كوب", quantityKind: "volume", decimalPlaces: 2 });
    const created = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Milk cup", kind: "sellable", yieldQuantity: "2", yieldUnitPublicId: fx.units.portion }, NOW);
    const detail = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, created.recipe.publicId, created.versions[0]!.publicId, {
      expectedVersion: 1,
      lines: [
        { itemPublicId: fx.items.milk, quantity: "1", unitPublicId: cup.publicId },
        { itemPublicId: fx.items.sugar, quantity: "10", unitPublicId: fx.units.ml },
      ],
    }, NOW);
    await approveVersion(db, tenantId, ADMIN, ACTOR, created.recipe.publicId, created.versions[0]!.publicId, {
      expectedVersion: detail.versions[0]!.version,
      effectiveFrom: "2026-11-01",
    }, NOW);
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.large, kind: "recipe", recipePublicId: created.recipe.publicId, effectiveFrom: "2026-11-01" }, NOW);

    // No rule yet: the milk line cannot be converted and carries no number; sugar in ml never converts to kg.
    let result = await preview(fx.latte.large);
    expect(result).toMatchObject({ status: "resolved", complete: false });
    expect(result.lines.map((line) => [line.item.nameEn, line.status, line.perSale])).toEqual([
      ["Milk", "missing_conversion", null],
      ["Sugar", "missing_conversion", null],
    ]);

    const withRule = await createConversion(db, tenantId, ADMIN, ACTOR, fx.items.milk, {
      fromUnitPublicId: cup.publicId,
      toUnitPublicId: fx.units.ml,
      factor: "240",
      effectiveFrom: "2026-11-05",
    }, NOW);
    const rule = withRule.rules[0]!;
    await updateConversion(db, tenantId, ADMIN, ACTOR, fx.items.milk, rule.publicId, {
      operation: "revise",
      expectedRevision: rule.revision,
      factor: "250",
      effectiveFrom: "2026-11-20",
    });
    expect((await preview(fx.latte.large, "2026-11-04")).lines[0]).toMatchObject({ status: "missing_conversion" });
    // Half a cup per sale: 120 ml = 0.120 l with the first rule, 125 ml = 0.125 l with the revision.
    expect((await preview(fx.latte.large, "2026-11-10")).lines[0]).toMatchObject({ status: "ok", perSale: { text: "0.120", rounded: false } });
    expect((await preview(fx.latte.large, "2026-11-20")).lines[0]).toMatchObject({ status: "ok", perSale: { text: "0.125" } });
    result = await preview(fx.latte.large, "2026-11-20");
    expect(result.complete).toBe(false);
  });

  it("previews a direct-stock link and reports the stock-product flag without a link as unresolved", async () => {
    expect(await preview(fx.water.variant)).toMatchObject({ status: "unresolved", reason: "no_link", kind: null });
    await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.water.variant, kind: "direct_stock", itemPublicId: fx.items.water, quantity: "1", unitPublicId: fx.units.bottle }, NOW);
    const result = await preview(fx.water.variant, undefined, "6");
    expect(result).toMatchObject({ status: "resolved", kind: "direct_stock", recipe: null, version: null, complete: true });
    expect(result.lines).toEqual([
      expect.objectContaining({ item: expect.objectContaining({ publicId: fx.items.water }), quantity: "1", unitCode: "bottle", status: "ok", perSale: { text: "1", exact: "1", rounded: false }, total: { text: "6", exact: "6", rounded: false } }),
    ]);
  });

  it("validates the query and keeps other businesses' variants out", async () => {
    expect(await rejection(preview(fx.water.variant, "2026-13-01"))).toMatchObject({ statusCode: 400, code: "effective_from_invalid" });
    expect(await rejection(preview(fx.water.variant, undefined, "0"))).toMatchObject({ statusCode: 400, code: "quantity_invalid" });
    expect(await rejection(preview(fx.water.variant, undefined, "1.5"))).toMatchObject({ code: "quantity_invalid" });
    expect(await rejection(getConsumptionPreview(db, otherTenantId, { variantPublicId: fx.water.variant, date: null, quantity: null }, NOW))).toMatchObject({
      statusCode: 404,
      code: "variant_not_found",
    });
    // Reading a preview writes nothing.
    const [{ audits }] = await sql<{ audits: number }[]>`SELECT count(*)::int AS audits FROM qos.tenant_audit_events WHERE action LIKE 'recipe.%'`;
    await preview(fx.latte.regular);
    const [{ audits: after }] = await sql<{ audits: number }[]>`SELECT count(*)::int AS audits FROM qos.tenant_audit_events WHERE action LIKE 'recipe.%'`;
    expect(after).toBe(audits);
  });
});
