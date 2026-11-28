import type { SupportedEntitySheet } from "@/lib/workbook/contract";
import { applyBranches } from "@/lib/workbook/apply/handlers/branches";
import { applyChannelSheets } from "@/lib/workbook/apply/handlers/channel-prices";
import { applyBranchPrices } from "@/lib/workbook/apply/handlers/branch-prices";
import { applyCategories } from "@/lib/workbook/apply/handlers/categories";
import { applyIngredients } from "@/lib/workbook/apply/handlers/ingredients";
import { applyInventoryCategories, applySuppliers, applyUnits, applyWarehouses } from "@/lib/workbook/apply/handlers/inventory-masters";
import { applyMenuBranches } from "@/lib/workbook/apply/handlers/menu-branches";
import { applyMenuItems } from "@/lib/workbook/apply/handlers/menu-items";
import { applyMenus } from "@/lib/workbook/apply/handlers/menus";
import { applyMenuSections } from "@/lib/workbook/apply/handlers/menu-sections";
import { applyModifierGroups } from "@/lib/workbook/apply/handlers/modifier-groups";
import { applyModifierOptions } from "@/lib/workbook/apply/handlers/modifier-options";
import { applyProductCategories } from "@/lib/workbook/apply/handlers/product-categories";
import { applyProductModifiers } from "@/lib/workbook/apply/handlers/product-modifiers";
import { applyProducts } from "@/lib/workbook/apply/handlers/products";
import { applyModifierEffects, applyPrepSteps, applyRecipeLines } from "@/lib/workbook/apply/handlers/recipe-children";
import { applyRecipes } from "@/lib/workbook/apply/handlers/recipes";
import type { SheetHandler } from "@/lib/workbook/apply/handlers/types";
import { applyVariants } from "@/lib/workbook/apply/handlers/variants";

/** One handler per supported sheet (QOS-217; QOS-200 adds the Phase 2 domain sheets). */
export const HANDLERS: Record<SupportedEntitySheet, SheetHandler> = {
  Branches: applyBranches,
  Categories: applyCategories,
  Products: applyProducts,
  "Product Categories": applyProductCategories,
  Variants: applyVariants,
  "Branch Prices": applyBranchPrices,
  "Sales Channels": applyChannelSheets,
  "Variant Channel Prices": applyChannelSheets,
  "Modifier Groups": applyModifierGroups,
  "Modifier Options": applyModifierOptions,
  "Modifier Option Channel Prices": applyChannelSheets,
  "Product Modifiers": applyProductModifiers,
  Menus: applyMenus,
  "Menu Branches": applyMenuBranches,
  "Menu Sections": applyMenuSections,
  "Menu Items": applyMenuItems,
  Units: applyUnits,
  Suppliers: applySuppliers,
  Warehouses: applyWarehouses,
  "Inventory Categories": applyInventoryCategories,
  Ingredients: applyIngredients,
  Recipes: applyRecipes,
  "Recipe Lines": applyRecipeLines,
  "Prep Steps": applyPrepSteps,
  "Modifier Effects": applyModifierEffects,
};
