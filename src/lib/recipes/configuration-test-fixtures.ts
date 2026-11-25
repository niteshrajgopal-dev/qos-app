import type { ModifierGroupRules } from "@/lib/catalogue/modifier-selection";
import { micros, unit } from "@/lib/inventory/test-units";
import type { CostItemInput } from "@/lib/recipes/cost-estimate";
import type { AssignedGroup, ConfigurationInput, EffectInput } from "@/lib/recipes/effects";
import type { ResolutionVersion } from "@/lib/recipes/resolution";

/* QOS-199 pure fixtures shared by effects.test.ts and costing.test.ts: the
   plan's worked latte (yield 1 portion; milk 200 ml, beans 18 g), an extras
   group with Extra shot (add 9 g beans, repeatable to 3), Oat milk (replace
   the milk line with 200 ml oat milk) and No milk (remove the milk line),
   and a sweetness group whose default option adds 5 g sugar. */

export const g = unit("g", "mass", { standard: true });
export const kg = unit("kg", "mass", { standard: true, decimalPlaces: 3 });
export const ml = unit("ml", "volume", { standard: true });
export const l = unit("l", "volume", { standard: true, decimalPlaces: 3 });
export const portion = unit("portion", "count");
export const pack = unit("pack", "pack");
export const UNITS = [g, kg, ml, l, portion, pack];

const purchased = (id: string, storageUnitId: string) => ({ id, status: "active" as const, kind: "purchased" as const, storageUnitId });
export const milk = purchased("item-milk", l.id);
export const beans = purchased("item-beans", kg.id);
export const oat = purchased("item-oat", l.id);
export const sugar = purchased("item-sugar", kg.id);
export const syrup = { id: "item-syrup", status: "active" as const, kind: "prepared" as const, storageUnitId: l.id };

export const MILK_LINE = "line-milk";
export const BEANS_LINE = "line-beans";

export function latteVersion(overrides: Partial<ResolutionVersion> = {}): ResolutionVersion {
  return {
    id: "v1",
    versionNumber: 1,
    status: "approved",
    effectiveFrom: "2026-11-01",
    effectiveTo: null,
    yieldQuantityMicros: micros("1"),
    yieldUnitId: portion.id,
    lines: [
      { id: MILK_LINE, itemId: milk.id, unitId: ml.id, quantityMicros: micros("200"), status: "active" },
      { id: BEANS_LINE, itemId: beans.id, unitId: g.id, quantityMicros: micros("18"), status: "active" },
    ],
    ...overrides,
  };
}

export function effect(overrides: Partial<EffectInput> & Pick<EffectInput, "id" | "modifierOptionId" | "effectType">): EffectInput {
  return {
    recipeVersionId: "v1",
    targetLineId: null,
    itemId: null,
    unitId: null,
    quantityMicros: null,
    status: "active",
    ...overrides,
  };
}

export const EFFECTS: EffectInput[] = [
  effect({ id: "eff-shot", modifierOptionId: "opt-shot", effectType: "add", itemId: beans.id, unitId: g.id, quantityMicros: micros("9") }),
  effect({ id: "eff-oat", modifierOptionId: "opt-oat", effectType: "replace", targetLineId: MILK_LINE, itemId: oat.id, unitId: ml.id, quantityMicros: micros("200") }),
  effect({ id: "eff-nomilk", modifierOptionId: "opt-nomilk", effectType: "remove", targetLineId: MILK_LINE }),
  effect({ id: "eff-sugar", modifierOptionId: "opt-sugar", effectType: "add", itemId: sugar.id, unitId: g.id, quantityMicros: micros("5") }),
];

type OptionSpec = { publicId: string; id: string; isDefault?: boolean; allowsQuantity?: boolean; maxQuantity?: number; priceMinor?: number; status?: "active" | "archived" };

export function group(
  publicId: string,
  options: OptionSpec[],
  bounds: Partial<Pick<ModifierGroupRules, "minSelections" | "maxSelections" | "selectionCountMode">> = {},
  status: "active" | "archived" = "active",
): AssignedGroup {
  return {
    status,
    rules: {
      publicId,
      minSelections: bounds.minSelections ?? 0,
      maxSelections: bounds.maxSelections ?? 5,
      selectionCountMode: bounds.selectionCountMode,
      options: options.map((option) => ({
        publicId: option.publicId,
        status: option.status ?? "active",
        isDefault: option.isDefault ?? false,
        allowsQuantity: option.allowsQuantity ?? false,
        maxQuantity: option.maxQuantity ?? 1,
        priceMinor: option.priceMinor ?? 0,
      })),
    },
    optionIds: new Map(options.map((option) => [option.publicId, option.id])),
  };
}

export const EXTRAS = group("grp_extras", [
  { publicId: "modopt_shot", id: "opt-shot", allowsQuantity: true, maxQuantity: 3, priceMinor: 300 },
  { publicId: "modopt_oat", id: "opt-oat", allowsQuantity: true, maxQuantity: 2, priceMinor: 200 },
  { publicId: "modopt_nomilk", id: "opt-nomilk", priceMinor: 0 },
]);

export const SWEETNESS = group("grp_sweet", [
  { publicId: "modopt_sugar", id: "opt-sugar", isDefault: true },
  { publicId: "modopt_plain", id: "opt-plain" },
]);

export function configuration(overrides: Partial<ConfigurationInput> = {}): ConfigurationInput {
  return {
    businessDate: "2026-11-10",
    soldQuantity: 1,
    variant: { status: "active", productStatus: "active", sellingQuantityBasis: "each" },
    links: [
      { id: "link-1", kind: "recipe", recipeId: "rec-latte", itemId: null, quantityMicros: null, unitId: null, effectiveFrom: "2026-11-01", effectiveTo: null },
    ],
    recipes: [{ id: "rec-latte", kind: "sellable", status: "active", versions: [latteVersion()] }],
    items: [milk, beans, oat, sugar, syrup],
    units: UNITS,
    rules: [],
    effects: EFFECTS,
    groups: [EXTRAS, SWEETNESS],
    selections: [],
    defaults: "none",
    ...overrides,
  };
}

const NET = "net" as const;
/** Current reference costs: milk 4 AED/l, beans 60 AED/kg, oat milk 9 AED/l, sugar 5 AED/kg, all net. */
export function costItems(overrides: Partial<Record<string, CostItemInput["cost"]>> = {}): CostItemInput[] {
  const base: Record<string, CostItemInput["cost"]> = {
    [milk.id]: { unitId: l.id, amountMicros: micros("4"), currency: "AED", taxBasis: NET },
    [beans.id]: { unitId: kg.id, amountMicros: micros("60"), currency: "AED", taxBasis: NET },
    [oat.id]: { unitId: l.id, amountMicros: micros("9"), currency: "AED", taxBasis: NET },
    [sugar.id]: { unitId: kg.id, amountMicros: micros("5"), currency: "AED", taxBasis: NET },
    [syrup.id]: null,
  };
  return Object.entries({ ...base, ...overrides }).map(([itemId, cost]) => ({ itemId, cost: cost ?? null, rules: [] }));
}
