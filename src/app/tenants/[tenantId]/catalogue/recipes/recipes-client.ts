"use client";

import type { CostView, DecimalView } from "@/lib/recipes/views";
import type { RecipeStateKey } from "@/lib/recipes/states";
import type { UnresolvedReason } from "@/lib/recipes/resolution";
import type { RejectionCode } from "@/lib/recipes/effects";
import type { ConfigurationMarginReason } from "@/lib/recipes/costing";
import { isolateText } from "@/lib/staff/branch-copy";
import { type StaffLocale, type StaffUiCopyKey, staffCopyWith } from "@/lib/staff/locale";

/* QOS-198 client helpers shared by the recipe screens: paths, state and
   reason labels, and decimal text that says when it was rounded. Every value
   shown comes from the recipes API; nothing is stored locally or sampled. */

export function recipesPath(tenantId: string, suffix = "") {
  return `/tenants/${tenantId}/catalogue/recipes${suffix}`;
}

export function recipesApiPath(tenantId: string, suffix = "") {
  return `/api/tenants/${tenantId}/recipes${suffix}`;
}

export const RECIPE_STATE_LABEL: Record<RecipeStateKey, StaffUiCopyKey> = {
  no_lines: "recipeStateNoLines",
  item_archived: "recipeStateItemArchived",
  yield_missing: "recipeStateYieldMissing",
  yield_unit_archived: "recipeStateYieldUnitArchived",
  missing_conversion: "recipeStateMissingConversion",
  cost_unknown: "recipeStateCostUnknown",
  cost_not_convertible: "recipeStateCostNotConvertible",
  no_approved_version: "recipeStateNoApprovedVersion",
  draft_pending: "recipeStateDraftPending",
  scheduled: "recipeStateScheduled",
  ended: "recipeStateEnded",
  no_assignment: "recipeStateNoAssignment",
  unlinked: "recipeStateUnlinked",
  needs_direct_stock_link: "recipeStateNeedsDirectStockLink",
  flag_conflicts_with_recipe: "recipeStateFlagConflictsWithRecipe",
  variant_archived: "recipeStateVariantArchived",
  output_item_archived: "recipeStateOutputItemArchived",
  weight_basis_unsupported: "recipeStateWeightBasisUnsupported",
  effect_option_archived: "recipeStateEffectOptionArchived",
  effect_option_unassigned: "recipeStateEffectOptionUnassigned",
  effect_unit_not_convertible: "recipeStateEffectUnitNotConvertible",
};

/** Informational states are neutral; everything else needs attention. */
export const RECIPE_STATE_TONE: Record<RecipeStateKey, "warm" | "neutral" | "danger"> = {
  no_lines: "warm",
  item_archived: "danger",
  yield_missing: "warm",
  yield_unit_archived: "danger",
  missing_conversion: "warm",
  cost_unknown: "neutral",
  cost_not_convertible: "neutral",
  no_approved_version: "warm",
  draft_pending: "neutral",
  scheduled: "neutral",
  ended: "neutral",
  no_assignment: "neutral",
  unlinked: "neutral",
  needs_direct_stock_link: "warm",
  flag_conflicts_with_recipe: "warm",
  variant_archived: "danger",
  output_item_archived: "danger",
  weight_basis_unsupported: "warm",
  effect_option_archived: "danger",
  effect_option_unassigned: "warm",
  effect_unit_not_convertible: "warm",
};

export const UNRESOLVED_REASON_LABEL: Record<UnresolvedReason, StaffUiCopyKey> = {
  variant_archived: "recipeUnresolvedVariantArchived",
  weight_basis_unsupported: "recipeUnresolvedWeightBasis",
  no_link: "recipeUnresolvedNoLink",
  overlapping_links: "recipeUnresolvedOverlappingLinks",
  recipe_archived: "recipeUnresolvedRecipeArchived",
  recipe_not_sellable: "recipeUnresolvedNotSellable",
  draft_only: "recipeUnresolvedDraftOnly",
  no_approved_version: "recipeUnresolvedNoApprovedVersion",
  overlapping_versions: "recipeUnresolvedOverlappingVersions",
  yield_missing: "recipeUnresolvedYieldMissing",
  no_lines: "recipeUnresolvedNoLines",
  item_archived: "recipeUnresolvedItemArchived",
  missing_conversion: "recipeUnresolvedMissingConversion",
  storage_unit_missing: "recipeUnresolvedStorageUnitMissing",
};

export const TAX_BASIS_KEY: Record<string, StaffUiCopyKey> = {
  net: "taxBasisNet",
  gross: "taxBasisGross",
  unconfirmed: "taxBasisUnconfirmed",
  mixed: "recipeTaxBasisMixed",
};

/** "12.500" or "12.500 (rounded)" as an LTR isolate. */
export function decimalText(locale: StaffLocale, value: DecimalView) {
  return value.rounded
    ? staffCopyWith(locale, "recipeRoundedValue", { value: isolateText(value.text) })
    : isolateText(value.text);
}

export function costSummaryText(locale: StaffLocale, cost: Extract<CostView, { status: "known" }>, yieldUnitCode: string | null) {
  if (cost.perYieldUnit && yieldUnitCode) {
    return staffCopyWith(locale, "recipeCostPerYieldUnit", {
      amount: decimalText(locale, cost.perYieldUnit),
      currency: isolateText(cost.currency),
      unit: isolateText(yieldUnitCode),
    });
  }
  return staffCopyWith(locale, "recipeCostPerBatch", {
    amount: decimalText(locale, cost.perBatch),
    currency: isolateText(cost.currency),
  });
}

/** The last business date a half-open range covers. */
export function lastCoveredDay(effectiveTo: string) {
  const date = new Date(`${effectiveTo}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** QOS-199: why a configuration could not be calculated. {option}, {options}, {group} and {item} are filled in. */
export const REJECTION_LABEL: Record<RejectionCode, StaffUiCopyKey> = {
  option_not_available: "recipeRejectOptionNotAvailable",
  duplicate_selection: "recipeRejectDuplicateSelection",
  option_quantity_exceeds_cap: "recipeRejectQuantityCap",
  selection_required: "recipeRejectSelectionRequired",
  selection_exceeds_max: "recipeRejectSelectionMax",
  group_rules_infeasible: "recipeRejectGroupInfeasible",
  repeat_not_allowed_for_effect: "recipeRejectRepeatEffect",
  conflicting_effects: "recipeRejectConflictingEffects",
  negative_consumption: "recipeRejectNegative",
};

/** QOS-199: why there is no ingredient margin for a configuration. */
export const MARGIN_REASON_LABEL: Record<ConfigurationMarginReason, StaffUiCopyKey> = {
  missing_price: "sellableMarginReasonMissingPrice",
  option_currency_mismatch: "recipeMarginReasonOptionCurrency",
  zero_price: "recipeMarginReasonZeroPrice",
  missing_selling_tax_basis: "sellableMarginReasonMissingSellingTaxBasis",
  unconfirmed_selling_tax_basis: "sellableMarginReasonUnconfirmedSellingTaxBasis",
  missing_tax_rate: "sellableMarginReasonMissingTaxRate",
  cost_unavailable: "recipeMarginReasonCostUnavailable",
  attribution_unavailable: "recipeMarginReasonAttribution",
  unconfirmed_cost_tax_basis: "recipeMarginReasonUnconfirmedCost",
  mixed_cost_tax_basis: "recipeMarginReasonMixedCost",
  currency_mismatch: "sellableMarginReasonCurrencyMismatch",
  cost_unit_not_each: "sellableMarginReasonCostUnitNotEach",
};
