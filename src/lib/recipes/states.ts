import { versionPhase } from "@/lib/recipes/dates";

/* QOS-198 missing-state derivation. Pure. Computed once on the server and
   returned on lists and details, so list badges and detail notices agree.
   Every key has EN/AR copy (recipeState* in the staff locale). */

export type RecipeStateKey =
  | "no_lines"
  | "item_archived"
  | "yield_missing"
  | "yield_unit_archived"
  | "missing_conversion"
  | "cost_unknown"
  | "cost_not_convertible"
  | "no_approved_version"
  | "draft_pending"
  | "scheduled"
  | "ended"
  | "no_assignment"
  | "unlinked"
  | "needs_direct_stock_link"
  | "flag_conflicts_with_recipe"
  | "variant_archived"
  | "output_item_archived"
  | "weight_basis_unsupported";

export function lineStates(line: {
  itemStatus: "active" | "archived";
  conversion: "ok" | "missing";
  cost: "known" | "unknown" | "not_convertible";
}): RecipeStateKey[] {
  const states: RecipeStateKey[] = [];
  if (line.itemStatus !== "active") states.push("item_archived");
  if (line.conversion === "missing") states.push("missing_conversion");
  if (line.cost === "unknown") states.push("cost_unknown");
  if (line.cost === "not_convertible") states.push("cost_not_convertible");
  return states;
}

export function versionStates(
  version: {
    status: "draft" | "approved" | "discarded";
    effectiveFrom: string | null;
    effectiveTo: string | null;
    yieldQuantityMicros: bigint | null;
    yieldUnitStatus: "active" | "archived" | null;
    activeLineCount: number;
  },
  today: string,
): RecipeStateKey[] {
  if (version.status === "discarded") {
    return [];
  }
  const states: RecipeStateKey[] = [];
  if (version.activeLineCount === 0) states.push("no_lines");
  if (version.yieldQuantityMicros === null || version.yieldUnitStatus === null) states.push("yield_missing");
  if (version.yieldUnitStatus === "archived") states.push("yield_unit_archived");
  const phase = versionPhase(version, today);
  if (phase === "scheduled" || phase === "ended") states.push(phase);
  return states;
}

export function familyStates(family: {
  kind: "sellable" | "prepared";
  versions: ReadonlyArray<{ status: "draft" | "approved" | "discarded" }>;
  liveLinkCount: number;
  outputItemStatus: "active" | "archived" | null;
}): RecipeStateKey[] {
  const states: RecipeStateKey[] = [];
  if (!family.versions.some((version) => version.status === "approved")) states.push("no_approved_version");
  if (family.versions.some((version) => version.status === "draft")) states.push("draft_pending");
  if (family.kind === "sellable" && family.liveLinkCount === 0) states.push("no_assignment");
  if (family.kind === "prepared" && family.outputItemStatus === "archived") states.push("output_item_archived");
  return states;
}

/**
 * Variant states for the sellable links tab. The QOS-214 stock-product flag
 * is recorded intent only: flagged with no direct-stock link is
 * "needs a direct-stock link"; flagged with a recipe link is shown as a
 * conflict and never resolved automatically.
 */
export function variantStates(variant: {
  variantStatus: "draft" | "active" | "archived";
  productStatus: "draft" | "active" | "archived";
  sellingQuantityBasis: string | null;
  directStockIntent: boolean | null;
  liveLinkKind: "recipe" | "direct_stock" | null;
}): RecipeStateKey[] {
  const states: RecipeStateKey[] = [];
  if (variant.variantStatus === "archived" || variant.productStatus === "archived") states.push("variant_archived");
  if (variant.directStockIntent === true && variant.liveLinkKind === null) {
    states.push("needs_direct_stock_link");
  } else if (variant.liveLinkKind === null) {
    states.push("unlinked");
  }
  if (variant.directStockIntent === true && variant.liveLinkKind === "recipe") states.push("flag_conflicts_with_recipe");
  if (variant.sellingQuantityBasis === "weight") states.push("weight_basis_unsupported");
  return states;
}
