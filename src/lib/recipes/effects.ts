import type { ModifierGroupRules, ModifierSelectionInput } from "@/lib/catalogue/modifier-selection";
import { validateModifierGroupSelections } from "@/lib/catalogue/modifier-selection";
import { add, fromMicros, inverse, isNegative, mul, negate, rational, type Rational } from "@/lib/inventory/quantity-math";
import {
  type ConsumptionResolution,
  type LineUsageStatus,
  lineUsage,
  type ResolutionInput,
  resolveConsumption,
} from "@/lib/recipes/resolution";

/* QOS-199 modifier effects on consumption. Pure and read-only: given the
   QOS-198 resolution inputs, the active effects of the tenant's recipe
   versions, the sold product's effective modifier rules (QOS-212) and the
   requested option selections, it says what the configuration uses per sale
   and for `soldQuantity` sales. Nothing here writes or posts.

   Rules:
   - The base is exactly resolveConsumption: one live link, one live approved
     version, per-sale line usage = line quantity ÷ yield in the storage unit.
   - Selections are validated per assigned group with the product's
     effective rules. A group with no selection gets its default options once
     (quantity 1) when defaults are "auto"; a default is never merged into an
     explicit selection. Unknown, archived or unassigned options, duplicates,
     quantities above the effective cap and bound violations are rejections.
   - remove(line) subtracts that line's whole per-sale base contribution
     once. replace(line, item, qty) subtracts it once, then adds qty × q of
     the item. add(item, qty) adds qty × q. Effect quantities are per selected
     option per sold unit, so they are not divided by the yield.
   - An option with a remove or replace effect cannot be selected more than
     once (repeat_not_allowed_for_effect). Two selected options that remove or
     replace the same base line are conflicting_effects. A per-item total
     below zero is negative_consumption. Rejected configurations carry no
     numbers; nothing is clamped or approximated.
   - An effect quantity that cannot be converted to the item's storage unit on
     the date carries no number, and the configuration is incomplete. */

export type EffectType = "add" | "remove" | "replace";

export type EffectInput = {
  id: string;
  recipeVersionId: string;
  modifierOptionId: string;
  effectType: EffectType;
  targetLineId: string | null;
  itemId: string | null;
  unitId: string | null;
  quantityMicros: bigint | null;
  status: "active" | "removed";
};

/** One modifier group assigned to the sold product, with the rules that product enforces. */
export type AssignedGroup = {
  status: "active" | "archived";
  /** Effective rules from toEffectiveModifierGroupRules (bounds, count mode, option caps). */
  rules: ModifierGroupRules;
  /** Internal option id by option public id, for every option of the group. */
  optionIds: ReadonlyMap<string, string>;
};

export type ConfigurationInput = ResolutionInput & {
  effects: readonly EffectInput[];
  groups: readonly AssignedGroup[];
  selections: readonly ModifierSelectionInput[];
  defaults: "auto" | "none";
};

export type AcceptedSelection = {
  optionId: string;
  optionPublicId: string;
  groupPublicId: string;
  quantity: number;
  priceMinor: number;
  source: "selected" | "default";
};

export type RejectionCode =
  | "option_not_available"
  | "duplicate_selection"
  | "option_quantity_exceeds_cap"
  | "selection_required"
  | "selection_exceeds_max"
  | "group_rules_infeasible"
  | "repeat_not_allowed_for_effect"
  | "conflicting_effects"
  | "negative_consumption";

export type Rejection = {
  code: RejectionCode;
  /** Option public ids involved (requested or selected). */
  optionPublicIds: string[];
  groupPublicId: string | null;
  lineId: string | null;
  itemId: string | null;
};

export type ContributionKind = "base" | "add" | "remove" | "replace_remove" | "replace_add";

export type Contribution = {
  kind: ContributionKind;
  lineId: string | null;
  effectId: string | null;
  optionId: string | null;
  itemId: string;
  /** The unit and quantity as entered on the line or the effect. */
  unitId: string;
  quantityMicros: bigint;
  /** Accepted option quantity for add and replace additions, otherwise 1. */
  multiplier: number;
  /** Signed per-sale quantity in `unitId` (removals are negative); used for costing. */
  perSaleInUnit: Rational;
  status: LineUsageStatus;
  storageUnitId: string | null;
  prepared: boolean;
  /** Signed per-sale usage in the storage unit; null unless status is ok. */
  perSale: Rational | null;
  /** perSale × soldQuantity; null unless status is ok. */
  total: Rational | null;
};

export type ItemTotal = {
  itemId: string;
  storageUnitId: string | null;
  /** Null when any contribution of the item has no number. */
  perSale: Rational | null;
  total: Rational | null;
};

export type ConfigurationResult =
  | {
      status: "unresolved";
      base: Extract<ConsumptionResolution, { status: "unresolved" }>;
      selections: AcceptedSelection[];
      rejections: Rejection[];
      defaultsApplied: boolean;
    }
  | {
      status: "rejected";
      base: Extract<ConsumptionResolution, { status: "resolved" }>;
      selections: AcceptedSelection[];
      rejections: Rejection[];
      defaultsApplied: boolean;
    }
  | {
      status: "resolved";
      base: Extract<ConsumptionResolution, { status: "resolved" }>;
      selections: AcceptedSelection[];
      rejections: [];
      defaultsApplied: boolean;
      contributions: Contribution[];
      perItem: ItemTotal[];
      /** False when any contribution could not be converted; such items carry no total. */
      complete: boolean;
    };

function rejection(code: RejectionCode, values: Partial<Omit<Rejection, "code">> = {}): Rejection {
  return { code, optionPublicIds: [], groupPublicId: null, lineId: null, itemId: null, ...values };
}

/**
 * Validates the requested selections against the sold product's assigned
 * groups. Runs validateModifierGroupSelections once per group, so defaults
 * fill an empty group exactly once and never join an explicit selection.
 */
export function validateConfigurationSelections(input: {
  groups: readonly AssignedGroup[];
  selections: readonly ModifierSelectionInput[];
  defaults: "auto" | "none";
}): { selections: AcceptedSelection[]; rejections: Rejection[]; defaultsApplied: boolean } {
  const rejections: Rejection[] = [];
  const groups = input.groups.filter((group) => group.status === "active");
  const groupOf = new Map<string, AssignedGroup>();
  for (const group of groups) {
    for (const option of group.rules.options) {
      if (option.status === "active") groupOf.set(option.publicId, group);
    }
  }

  const requestedByGroup = new Map<string, ModifierSelectionInput[]>();
  const seen = new Set<string>();
  for (const selection of input.selections) {
    if (seen.has(selection.optionPublicId)) {
      rejections.push(rejection("duplicate_selection", { optionPublicIds: [selection.optionPublicId] }));
      continue;
    }
    seen.add(selection.optionPublicId);
    const group = groupOf.get(selection.optionPublicId);
    if (!group) {
      rejections.push(rejection("option_not_available", { optionPublicIds: [selection.optionPublicId] }));
      continue;
    }
    const option = group.rules.options.find((entry) => entry.publicId === selection.optionPublicId)!;
    const cap = option.allowsQuantity ? option.maxQuantity : 1;
    if (selection.quantity > cap) {
      rejections.push(
        rejection("option_quantity_exceeds_cap", { optionPublicIds: [selection.optionPublicId], groupPublicId: group.rules.publicId }),
      );
      continue;
    }
    const list = requestedByGroup.get(group.rules.publicId) ?? [];
    list.push({ optionPublicId: selection.optionPublicId, quantity: selection.quantity });
    requestedByGroup.set(group.rules.publicId, list);
  }

  const accepted: AcceptedSelection[] = [];
  let defaultsApplied = false;
  for (const group of groups) {
    const requested = requestedByGroup.get(group.rules.publicId) ?? [];
    try {
      const result = validateModifierGroupSelections(group.rules, requested, { applyDefaults: input.defaults === "auto" });
      defaultsApplied ||= result.appliedDefaults;
      for (const selection of result.selections) {
        accepted.push({
          optionId: group.optionIds.get(selection.optionPublicId)!,
          optionPublicId: selection.optionPublicId,
          groupPublicId: group.rules.publicId,
          quantity: selection.quantity,
          priceMinor: selection.priceMinor,
          source: result.appliedDefaults ? "default" : "selected",
        });
      }
    } catch {
      // Duplicates, unknown options and caps were rejected above, so what is left is a bound or a group that cannot be satisfied.
      const count =
        group.rules.selectionCountMode === "total_quantity"
          ? requested.reduce((sum, selection) => sum + selection.quantity, 0)
          : requested.length;
      const code =
        count < group.rules.minSelections
          ? "selection_required"
          : count > group.rules.maxSelections
            ? "selection_exceeds_max"
            : "group_rules_infeasible";
      rejections.push(rejection(code, { groupPublicId: group.rules.publicId, optionPublicIds: requested.map((entry) => entry.optionPublicId) }));
    }
  }
  return { selections: accepted, rejections, defaultsApplied };
}

/** Resolves the base and applies the accepted selections' effects for one configuration. */
export function applyModifierEffects(input: ConfigurationInput): ConfigurationResult {
  const base = resolveConsumption(input);
  const validated = validateConfigurationSelections(input);
  if (base.status === "unresolved") {
    return { status: "unresolved", base, ...validated };
  }
  if (validated.rejections.length > 0) {
    return { status: "rejected", base, ...validated };
  }

  const versionId = base.kind === "recipe" ? base.versionId : null;
  const effects = versionId
    ? input.effects.filter((effect) => effect.recipeVersionId === versionId && effect.status === "active")
    : [];
  const baseByLine = new Map(base.lines.flatMap((line) => (line.lineId ? [[line.lineId, line] as const] : [])));
  const publicIdOf = new Map(validated.selections.map((selection) => [selection.optionId, selection.optionPublicId]));
  const rejections: Rejection[] = [];

  // Single-selection rule and line conflicts are checked before any number is produced.
  const targets = new Map<string, string[]>();
  for (const selection of validated.selections) {
    const own = effects.filter((effect) => effect.modifierOptionId === selection.optionId);
    const targeting = own.filter((effect) => effect.effectType !== "add");
    if (targeting.length > 0 && selection.quantity > 1) {
      rejections.push(rejection("repeat_not_allowed_for_effect", { optionPublicIds: [selection.optionPublicId] }));
    }
    for (const effect of targeting) {
      const list = targets.get(effect.targetLineId!) ?? [];
      if (!list.includes(selection.optionPublicId)) list.push(selection.optionPublicId);
      targets.set(effect.targetLineId!, list);
    }
  }
  for (const [lineId, optionPublicIds] of targets) {
    if (optionPublicIds.length > 1) {
      rejections.push(rejection("conflicting_effects", { optionPublicIds, lineId, itemId: baseByLine.get(lineId)?.itemId ?? null }));
    }
  }
  if (rejections.length > 0) {
    return { status: "rejected", base, ...validated, rejections };
  }

  const sold = rational(BigInt(input.soldQuantity));
  const perYieldUnit =
    base.kind === "recipe"
      ? inverse(fromMicros(input.recipes.flatMap((recipe) => recipe.versions).find((version) => version.id === base.versionId)!.yieldQuantityMicros!))
      : rational(BigInt(1));
  const contributions: Contribution[] = base.lines.map((line) => ({
    kind: "base",
    lineId: line.lineId,
    effectId: null,
    optionId: null,
    itemId: line.itemId,
    unitId: line.unitId,
    quantityMicros: line.quantityMicros,
    multiplier: 1,
    perSaleInUnit: mul(fromMicros(line.quantityMicros), perYieldUnit),
    status: line.status,
    storageUnitId: line.storageUnitId,
    prepared: line.prepared,
    perSale: line.perSale,
    total: line.total,
  }));

  for (const selection of validated.selections) {
    for (const effect of effects.filter((entry) => entry.modifierOptionId === selection.optionId)) {
      if (effect.effectType !== "add") {
        const target = baseByLine.get(effect.targetLineId!);
        if (!target) {
          // The target is a line of the same version (composite FK) and targeted lines cannot be removed from a draft.
          throw new Error(`Effect ${effect.id} targets a line that is not active on its version.`);
        }
        contributions.push({
          kind: effect.effectType === "remove" ? "remove" : "replace_remove",
          lineId: target.lineId,
          effectId: effect.id,
          optionId: selection.optionId,
          itemId: target.itemId,
          unitId: target.unitId,
          quantityMicros: target.quantityMicros,
          multiplier: 1,
          perSaleInUnit: negate(mul(fromMicros(target.quantityMicros), perYieldUnit)),
          status: target.status,
          storageUnitId: target.storageUnitId,
          prepared: target.prepared,
          perSale: target.perSale ? negate(target.perSale) : null,
          total: target.total ? negate(target.total) : null,
        });
      }
      if (effect.effectType !== "remove") {
        const perSaleInUnit = mul(fromMicros(effect.quantityMicros!), rational(BigInt(selection.quantity)));
        const usage = lineUsage(
          input,
          { lineId: null, itemId: effect.itemId!, unitId: effect.unitId!, quantityMicros: effect.quantityMicros! },
          perSaleInUnit,
          input.soldQuantity,
        );
        contributions.push({
          kind: effect.effectType === "add" ? "add" : "replace_add",
          lineId: effect.targetLineId,
          effectId: effect.id,
          optionId: selection.optionId,
          itemId: usage.itemId,
          unitId: usage.unitId,
          quantityMicros: usage.quantityMicros,
          multiplier: selection.quantity,
          perSaleInUnit,
          status: usage.status,
          storageUnitId: usage.storageUnitId,
          prepared: usage.prepared,
          perSale: usage.perSale,
          total: usage.total,
        });
      }
    }
  }

  const perItem: ItemTotal[] = [];
  for (const contribution of contributions) {
    if (perItem.some((entry) => entry.itemId === contribution.itemId)) continue;
    const own = contributions.filter((entry) => entry.itemId === contribution.itemId);
    const known = own.every((entry) => entry.perSale !== null);
    const perSale = known ? own.reduce((sum, entry) => add(sum, entry.perSale!), rational(BigInt(0))) : null;
    perItem.push({
      itemId: contribution.itemId,
      storageUnitId: contribution.storageUnitId,
      perSale,
      total: perSale ? mul(perSale, sold) : null,
    });
  }
  const negative = perItem.filter((entry) => entry.perSale !== null && isNegative(entry.perSale));
  if (negative.length > 0) {
    return {
      status: "rejected",
      base,
      ...validated,
      rejections: negative.map((entry) =>
        rejection("negative_consumption", {
          itemId: entry.itemId,
          optionPublicIds: [
            ...new Set(
              contributions
                .filter((contribution) => contribution.itemId === entry.itemId && contribution.optionId)
                .map((contribution) => publicIdOf.get(contribution.optionId!)!),
            ),
          ],
        }),
      ),
    };
  }
  return {
    status: "resolved",
    base,
    ...validated,
    rejections: [],
    contributions,
    perItem,
    complete: contributions.every((contribution) => contribution.status === "ok"),
  };
}
