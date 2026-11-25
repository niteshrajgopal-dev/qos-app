import type { DbClient } from "@/db/client";
import { createDraftProduct } from "@/lib/catalogue/products";
import { createProductVariant, updateProductVariant } from "@/lib/catalogue/variants";
import { ACTOR, ADMIN } from "@/lib/inventory/integration-helpers";
import { createItem } from "@/lib/inventory/items";
import { createUnit } from "@/lib/inventory/units";

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
