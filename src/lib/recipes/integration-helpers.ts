import type { DbClient } from "@/db/client";
import { attachModifierGroupToProduct, createModifierGroup, createModifierOption, listProductModifierGroups } from "@/lib/catalogue/modifiers";
import { createDraftProduct } from "@/lib/catalogue/products";
import { createProductVariant, updateProductVariant } from "@/lib/catalogue/variants";
import { ACTOR, ADMIN } from "@/lib/inventory/integration-helpers";
import { createItem } from "@/lib/inventory/items";
import { createUnit } from "@/lib/inventory/units";
import { createSellableLink } from "@/lib/recipes/links";
import { createRecipe } from "@/lib/recipes/recipes";
import { replaceDraftLines } from "@/lib/recipes/versions";

/* QOS-198 integration seeds, created through the real services: units with
   standard and custom codes, purchased and prepared items, a two-variant
   product and a stock-product flagged product. */

export async function seedRecipeFixtures(db: DbClient, tenantId: string) {
  const standard = async (code: string) =>
    (await createUnit(db, tenantId, ADMIN, ACTOR, { source: "standard", standardCode: code })).publicId;
  const custom = async (code: string, nameEn: string, nameAr: string, quantityKind: string, decimalPlaces: number) =>
    (await createUnit(db, tenantId, ADMIN, ACTOR, { source: "custom", code, nameEn, nameAr, quantityKind, decimalPlaces })).publicId;
  const units = {
    g: await standard("g"),
    kg: await standard("kg"),
    ml: await standard("ml"),
    l: await standard("l"),
    portion: await custom("portion", "Portion", "حصة", "count", 0),
    bottle: await custom("bottle", "Bottle", "زجاجة", "pack", 0),
  };
  const item = async (nameEn: string, kind: "purchased" | "prepared", storage: string, recipe?: string) =>
    (
      await createItem(db, tenantId, ADMIN, ACTOR, {
        nameEn,
        kind,
        storageUnitPublicId: storage,
        ...(recipe ? { recipeUnitPublicId: recipe } : {}),
      })
    ).item.publicId;
  const items = {
    milk: await item("Milk", "purchased", units.l, units.ml),
    beans: await item("Coffee beans", "purchased", units.kg, units.g),
    sugar: await item("Sugar", "purchased", units.kg, units.g),
    water: await item("Bottled water", "purchased", units.bottle),
    syrup: await item("Vanilla syrup", "prepared", units.l, units.ml),
    base: await item("Sauce base", "prepared", units.l, units.ml),
  };
  const latte = await createDraftProduct(db, tenantId, ADMIN, {
    internalName: "latte",
    translations: { en: { displayName: "Latte", description: null }, ar: { displayName: "لاتيه", description: null } },
    defaultVariant: { amountMinor: 1800, currency: "AED" },
  });
  const regular = await updateProductVariant(
    db,
    tenantId,
    ADMIN,
    latte.publicId,
    latte.defaultVariant.publicId,
    { expectedProductVersion: latte.version, translations: { en: { displayName: "Regular" }, ar: { displayName: "عادي" } } },
    ACTOR,
  );
  const withLarge = await createProductVariant(
    db,
    tenantId,
    ADMIN,
    latte.publicId,
    {
      expectedProductVersion: regular.productVersion,
      publicId: "var_latte_large",
      translations: { en: { displayName: "Large" }, ar: { displayName: "كبير" } },
      amountMinor: 2200,
    },
    ACTOR,
  );
  const water = await createDraftProduct(db, tenantId, ADMIN, {
    internalName: "water",
    translations: { en: { displayName: "Water", description: null }, ar: { displayName: "ماء", description: null } },
    defaultVariant: { amountMinor: 500, currency: "AED" },
    directStockIntent: true,
  });
  return {
    units,
    items,
    latte: {
      productPublicId: latte.publicId,
      regular: latte.defaultVariant.publicId,
      large: withLarge.variants.find((variant) => variant.publicId === "var_latte_large")!.publicId,
    },
    water: { productPublicId: water.publicId, variant: water.defaultVariant.publicId },
  };
}

export type RecipeFixtures = Awaited<ReturnType<typeof seedRecipeFixtures>>;

/* QOS-199 integration seeds, through the real services: an approved-ready
   latte draft (yield 1 portion: 200 ml milk, 18 g beans) linked to the
   regular latte, an oat milk item, and a shared "Extras" modifier group
   (Extra shot 3.00 repeatable to 3, Oat milk 2.00, No milk 0.00) attached to
   the latte product. Effects are saved by each test. */
export async function seedEffectFixtures(db: DbClient, tenantId: string, fx: RecipeFixtures, now: Date) {
  const oat = (
    await createItem(db, tenantId, ADMIN, ACTOR, { nameEn: "Oat milk", nameAr: "حليب الشوفان", kind: "purchased", storageUnitPublicId: fx.units.l, recipeUnitPublicId: fx.units.ml })
  ).item.publicId;
  const created = await createRecipe(db, tenantId, ADMIN, ACTOR, { nameEn: "Latte", kind: "sellable", yieldQuantity: "1", yieldUnitPublicId: fx.units.portion }, now);
  const draft = await replaceDraftLines(db, tenantId, ADMIN, ACTOR, created.recipe.publicId, created.versions[0]!.publicId, {
    expectedVersion: created.versions[0]!.version,
    lines: [
      { itemPublicId: fx.items.milk, quantity: "200", unitPublicId: fx.units.ml },
      { itemPublicId: fx.items.beans, quantity: "18", unitPublicId: fx.units.g },
    ],
  }, now);
  await createSellableLink(db, tenantId, ADMIN, ACTOR, { variantPublicId: fx.latte.regular, kind: "recipe", recipePublicId: created.recipe.publicId, effectiveFrom: "2026-11-01" }, now);
  let group = await createModifierGroup(db, tenantId, {
    internalName: "extras",
    minSelections: 0,
    maxSelections: 5,
    translations: { en: { displayName: "Extras" }, ar: { displayName: "إضافات" } },
  }, ACTOR, ADMIN);
  const option = async (publicId: string, en: string, ar: string, extra: Record<string, unknown>) => {
    group = await createModifierOption(db, tenantId, group.publicId, {
      expectedGroupVersion: group.version,
      publicId,
      translations: { en: { displayName: en }, ar: { displayName: ar } },
      ...extra,
    }, ACTOR, ADMIN);
    return publicId;
  };
  const options = {
    shot: await option("modopt_extra_shot", "Extra shot", "جرعة إضافية", { allowsQuantity: true, maxQuantity: 3, priceMinor: 300, currency: "AED" }),
    oat: await option("modopt_oat_milk", "Oat milk", "حليب الشوفان", { allowsQuantity: true, maxQuantity: 2, priceMinor: 200, currency: "AED" }),
    noMilk: await option("modopt_no_milk", "No milk", "بدون حليب", { priceMinor: 0, currency: "AED" }),
  };
  const assigned = await listProductModifierGroups(db, tenantId, fx.latte.productPublicId);
  await attachModifierGroupToProduct(db, tenantId, fx.latte.productPublicId, {
    expectedProductVersion: assigned.productVersion,
    modifierGroupPublicId: group.publicId,
  }, ACTOR, ADMIN);
  const version = draft.versions[0]!;
  return {
    oat,
    recipePublicId: created.recipe.publicId,
    versionPublicId: version.publicId,
    milkLine: version.lines.find((line) => line.item.publicId === fx.items.milk)!.publicId,
    beansLine: version.lines.find((line) => line.item.publicId === fx.items.beans)!.publicId,
    groupPublicId: group.publicId,
    options,
  };
}

export type EffectFixtures = Awaited<ReturnType<typeof seedEffectFixtures>>;
