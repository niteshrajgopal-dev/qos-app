/* Recipes screen tabs, shared by the server page (reads `?tab=`) and the
   client screen. An unknown value opens the recipes tab. */

export const RECIPES_TABS = ["recipes", "links"] as const;
export type RecipesTab = (typeof RECIPES_TABS)[number];

export function recipesTabFrom(value: unknown): RecipesTab {
  return RECIPES_TABS.find((tab) => tab === value) ?? "recipes";
}
