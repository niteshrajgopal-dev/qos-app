import { type ChannelPriceOverride, resolveChannelPrice } from "@/lib/catalogue/channel-price-resolver";
import { compareOnBasis } from "@/lib/catalogue/reference-cost-policies";
import {
  currencyMinorExponent,
  type ReferenceCostTaxBasis,
  type ReferenceCostUnit,
  type SellingPriceTaxBasis,
} from "@/lib/catalogue/selling-tax-cost";
import { buildItemGraph, findPath, type GraphUnit } from "@/lib/inventory/conversion-graph";
import {
  add,
  fromMicros,
  isExactAt,
  mul,
  rational,
  type Rational,
  toDecimalString,
  toMicrosHalfUp,
} from "@/lib/inventory/quantity-math";
import { type CostItemInput, estimateRecipeCost, type RecipeCostEstimate, type RecipeTaxBasis } from "@/lib/recipes/cost-estimate";
import type { ConfigurationResult, Contribution } from "@/lib/recipes/effects";

/* QOS-199 configuration cost and ingredient margin. Pure.

   Cost: every contribution of the configuration (base lines, option
   additions and removals) is costed as estimateRecipeCost costs a line:
   its quantity converted to the item's current cost unit × amount; a
   removal costs negative. Per component exactly one method applies, never
   both (QOS-215 policies):
   - base: a manual variant policy gives the manual amount and its base lines
     are not costed; recipe-derived or no policy costs the base lines.
   - option o × q: a manual option policy gives amount × q and its effects are
     not costed (they still drive consumption); otherwise its effects are
     costed (additions minus removed base contributions).
   - a manual base with an option that removes or replaces a line and has no
     manual policy cannot be netted: attribution_unavailable, no total.
   Unknown or unconvertible costs make the total unavailable with a count;
   unknown is never zero. Bases: all net → net, all gross → gross, any
   unconfirmed → unconfirmed, net with gross → mixed. These are current
   reference estimates, never stored and never a posted snapshot.

   Margin: the configured selling price (variant price, or the channel price
   with central inheritance, plus option price deltas × q) against the cost on
   one tax basis with compareOnBasis. Missing, zero, unconfirmed, mixed or
   mismatched inputs give a reason and no number. Never the Phase 1 checkout
   tax, never a percentage for a zero price. */

export type CostPolicyInput = {
  method: "manual" | "recipe_derived";
  amountMicros: bigint | null;
  currency: string | null;
  unit: ReferenceCostUnit | null;
  taxBasis: ReferenceCostTaxBasis | null;
} | null;

export type ContributionCost =
  | { status: "known"; amount: Rational; currency: string; taxBasis: ReferenceCostTaxBasis }
  | { status: "unknown" | "not_convertible" }
  | { status: "not_costed"; reason: "manual_base" | "manual_option" };

export type CostComponent = {
  source: "base" | "option";
  optionId: string | null;
  method: "manual" | "derived";
  /** Accepted option quantity; 1 for the base. */
  quantity: number;
  status: "known" | "unavailable";
  /** Per sale; null when unavailable. */
  amount: Rational | null;
  currency: string | null;
  taxBasis: RecipeTaxBasis | null;
  /** Manual base only: the policy's cost unit. */
  manualUnit: ReferenceCostUnit | null;
  /** Contributions or manual amounts without a usable cost. */
  missingCount: number;
  /** Option removes or replaces a base line while the base cost is manual. */
  attributionUnavailable: boolean;
};

export type ConfigurationCost =
  | {
      status: "known";
      perSale: Rational;
      total: Rational;
      currency: string;
      taxBasis: RecipeTaxBasis;
      /** The base component's manual unit, or null when the base is recipe-derived. */
      manualBaseUnit: ReferenceCostUnit | null;
      baseMethod: "manual" | "derived";
      components: CostComponent[];
      contributionCosts: ContributionCost[];
    }
  | {
      status: "unavailable";
      reason: "rejected" | "unresolved" | "attribution_unavailable" | "incomplete" | "currency_mismatch";
      missingCount: number;
      attributionOptionIds: string[];
      baseMethod: "manual" | "derived";
      components: CostComponent[];
      contributionCosts: ContributionCost[];
    };

function combineBases(bases: RecipeTaxBasis[]): RecipeTaxBasis {
  const set = new Set(bases);
  if (set.has("unconfirmed")) return "unconfirmed";
  if (set.size === 1) return bases[0]!;
  return "mixed";
}

function sum(values: Rational[]): Rational {
  return values.reduce((total, value) => add(total, value), rational(BigInt(0)));
}

/** A manual policy's amount, or null when the amount or currency is missing. A missing basis is treated as unconfirmed. */
function manualAmount(policy: NonNullable<CostPolicyInput>, quantity: number) {
  if (policy.amountMicros === null || !policy.currency?.trim()) return null;
  return {
    amount: mul(fromMicros(policy.amountMicros), rational(BigInt(quantity))),
    currency: policy.currency.trim(),
    taxBasis: (policy.taxBasis ?? "unconfirmed") as RecipeTaxBasis,
  };
}

/** Costs one contribution in its own unit: signed quantity × factor to the cost unit × amount. */
export function costContribution(
  contribution: Pick<Contribution, "itemId" | "unitId" | "perSaleInUnit">,
  units: readonly GraphUnit[],
  items: readonly CostItemInput[],
): ContributionCost {
  const item = items.find((entry) => entry.itemId === contribution.itemId);
  if (!item?.cost) {
    return { status: "unknown" };
  }
  const path = findPath(buildItemGraph(units, item.rules), contribution.unitId, item.cost.unitId);
  if (!path) {
    return { status: "not_convertible" };
  }
  return {
    status: "known",
    amount: mul(mul(contribution.perSaleInUnit, path.factor), fromMicros(item.cost.amountMicros)),
    currency: item.cost.currency,
    taxBasis: item.cost.taxBasis,
  };
}

function manualComponent(
  source: "base" | "option",
  optionId: string | null,
  policy: NonNullable<CostPolicyInput>,
  quantity: number,
): CostComponent {
  const manual = manualAmount(policy, quantity);
  return {
    source,
    optionId,
    method: "manual",
    quantity,
    status: manual ? "known" : "unavailable",
    amount: manual?.amount ?? null,
    currency: manual?.currency ?? null,
    taxBasis: manual?.taxBasis ?? null,
    manualUnit: source === "base" ? policy.unit : null,
    missingCount: manual ? 0 : 1,
    attributionUnavailable: false,
  };
}

function derivedComponent(
  source: "base" | "option",
  optionId: string | null,
  quantity: number,
  costs: ContributionCost[],
  attributionUnavailable: boolean,
): CostComponent {
  const known = costs.filter((cost): cost is Extract<ContributionCost, { status: "known" }> => cost.status === "known");
  const missingCount = costs.filter((cost) => cost.status === "unknown" || cost.status === "not_convertible").length;
  const currencies = new Set(known.map((cost) => cost.currency));
  const usable = missingCount === 0 && !attributionUnavailable && currencies.size <= 1;
  return {
    source,
    optionId,
    method: "derived",
    quantity,
    status: usable ? "known" : "unavailable",
    amount: usable ? sum(known.map((cost) => cost.amount)) : null,
    currency: usable ? known[0]?.currency ?? null : null,
    taxBasis: usable && known.length > 0 ? combineBases(known.map((cost) => cost.taxBasis)) : null,
    manualUnit: null,
    missingCount,
    attributionUnavailable,
  };
}

function totalOf(
  components: CostComponent[],
  contributionCosts: ContributionCost[],
  baseMethod: "manual" | "derived",
  manualBaseUnit: ReferenceCostUnit | null,
  soldQuantity: number,
): ConfigurationCost {
  const attributionOptionIds = components.filter((entry) => entry.attributionUnavailable).map((entry) => entry.optionId!);
  const missingCount = components.reduce((count, entry) => count + entry.missingCount, 0);
  const unavailable = (reason: Extract<ConfigurationCost, { status: "unavailable" }>["reason"]): ConfigurationCost => ({
    status: "unavailable",
    reason,
    missingCount,
    attributionOptionIds,
    baseMethod,
    components,
    contributionCosts,
  });
  if (attributionOptionIds.length > 0) return unavailable("attribution_unavailable");
  if (missingCount > 0) return unavailable("incomplete");
  const priced = components.filter((entry) => entry.currency !== null);
  const currencies = new Set(priced.map((entry) => entry.currency));
  if (currencies.size !== 1 || components.some((entry) => entry.status !== "known")) {
    // One tenant has one base currency; a mixture is never added up.
    return unavailable("currency_mismatch");
  }
  const perSale = sum(components.map((entry) => entry.amount!));
  return {
    status: "known",
    perSale,
    total: mul(perSale, rational(BigInt(soldQuantity))),
    currency: priced[0]!.currency!,
    taxBasis: combineBases(priced.map((entry) => entry.taxBasis!)),
    manualBaseUnit,
    baseMethod,
    components,
    contributionCosts,
  };
}

/** Costs a configuration from the engine result, current item costs and the QOS-215 policies. */
export function costConfiguration(input: {
  configuration: ConfigurationResult;
  soldQuantity: number;
  units: readonly GraphUnit[];
  items: readonly CostItemInput[];
  basePolicy: CostPolicyInput;
  /** Current option policies keyed by option id. */
  optionPolicies: ReadonlyMap<string, CostPolicyInput>;
}): ConfigurationCost {
  const { configuration, basePolicy } = input;
  const baseManual = basePolicy?.method === "manual";
  const baseMethod = baseManual ? "manual" : "derived";
  const manualBaseUnit = baseManual ? basePolicy!.unit : null;

  if (configuration.status === "rejected") {
    return { status: "unavailable", reason: "rejected", missingCount: 0, attributionOptionIds: [], baseMethod, components: [], contributionCosts: [] };
  }
  if (configuration.status === "unresolved") {
    // Without a recipe only manual amounts can be costed: the base and every selected option must be manual.
    const allManual =
      baseManual && configuration.selections.every((selection) => input.optionPolicies.get(selection.optionId)?.method === "manual");
    if (!allManual) {
      return { status: "unavailable", reason: "unresolved", missingCount: 0, attributionOptionIds: [], baseMethod, components: [], contributionCosts: [] };
    }
    const components = [
      manualComponent("base", null, basePolicy!, 1),
      ...configuration.selections.map((selection) =>
        manualComponent("option", selection.optionId, input.optionPolicies.get(selection.optionId)!, selection.quantity),
      ),
    ];
    return totalOf(components, [], baseMethod, manualBaseUnit, input.soldQuantity);
  }

  const contributions = configuration.contributions;
  const optionManual = (optionId: string | null) => optionId !== null && input.optionPolicies.get(optionId)?.method === "manual";
  const contributionCosts: ContributionCost[] = contributions.map((contribution) => {
    if (contribution.kind === "base" && baseManual) return { status: "not_costed", reason: "manual_base" };
    if (contribution.kind !== "base" && optionManual(contribution.optionId)) return { status: "not_costed", reason: "manual_option" };
    return costContribution(contribution, input.units, input.items);
  });
  const costsOf = (predicate: (contribution: Contribution) => boolean) =>
    contributions.flatMap((contribution, index) => (predicate(contribution) ? [contributionCosts[index]!] : []));

  const components: CostComponent[] = [
    baseManual
      ? manualComponent("base", null, basePolicy!, 1)
      : derivedComponent("base", null, 1, costsOf((contribution) => contribution.kind === "base"), false),
  ];
  for (const selection of configuration.selections) {
    const policy = input.optionPolicies.get(selection.optionId) ?? null;
    if (policy?.method === "manual") {
      components.push(manualComponent("option", selection.optionId, policy, selection.quantity));
      continue;
    }
    const own = contributions.filter((contribution) => contribution.optionId === selection.optionId);
    // A manual base has no ingredient lines to take a removal out of.
    const attribution = baseManual && own.some((contribution) => contribution.kind === "remove" || contribution.kind === "replace_remove");
    components.push(
      derivedComponent(
        "option",
        selection.optionId,
        selection.quantity,
        costsOf((contribution) => contribution.optionId === selection.optionId),
        attribution,
      ),
    );
  }
  return totalOf(components, contributionCosts, baseMethod, manualBaseUnit, input.soldQuantity);
}

/** The version's QOS-198 batch and per-output estimate: per-output = per-batch ÷ a positive yield, never a division by nothing. */
export function batchCost(input: Parameters<typeof estimateRecipeCost>[0]): RecipeCostEstimate {
  return estimateRecipeCost(input);
}

export type PriceInheritance = "central" | "inherited" | "override";

export type ConfigurationPrice =
  | {
      status: "available";
      baseMinor: number;
      baseInheritance: PriceInheritance;
      options: Array<{ optionId: string; unitMinor: number; quantity: number; inheritance: PriceInheritance }>;
      optionsMinor: number;
      totalMinor: number;
      currency: string;
    }
  | { status: "unavailable"; reason: "missing_price" | "option_currency_mismatch" };

/**
 * The configured selling price: the variant's central price, or with a
 * channel its channel row (inherited from central when there is none), plus
 * each accepted option's price delta (central or its channel row) × q. Read
 * only: prices and selection rules are never written.
 */
export function configurationPrice(input: {
  base: { amountMinor: number; currency: string } | null;
  /** Undefined: central price. Null: a channel with no row for this variant (inherits central). */
  baseChannel?: ChannelPriceOverride | null;
  options: ReadonlyArray<{
    optionId: string;
    priceMinor: number;
    currency: string;
    quantity: number;
    channel?: ChannelPriceOverride | null;
  }>;
}): ConfigurationPrice {
  if (!input.base || !input.base.currency.trim()) {
    return { status: "unavailable", reason: "missing_price" };
  }
  const inheritance = (channel: ChannelPriceOverride | null | undefined): PriceInheritance =>
    channel === undefined ? "central" : channel === null ? "inherited" : "override";
  let baseMinor: number;
  try {
    baseMinor =
      input.baseChannel === undefined
        ? input.base.amountMinor
        : resolveChannelPrice(input.base, input.baseChannel).effectiveAmountMinor;
  } catch {
    return { status: "unavailable", reason: "missing_price" };
  }
  const currency = input.base.currency.trim().toUpperCase();
  const options: Extract<ConfigurationPrice, { status: "available" }>["options"] = [];
  for (const option of input.options) {
    if (option.currency.trim().toUpperCase() !== currency) {
      return { status: "unavailable", reason: "option_currency_mismatch" };
    }
    let unitMinor: number;
    try {
      unitMinor =
        option.channel === undefined
          ? option.priceMinor
          : resolveChannelPrice({ amountMinor: option.priceMinor, currency: option.currency }, option.channel).effectiveAmountMinor;
    } catch {
      return { status: "unavailable", reason: "option_currency_mismatch" };
    }
    options.push({ optionId: option.optionId, unitMinor, quantity: option.quantity, inheritance: inheritance(option.channel) });
  }
  const optionsMinor = options.reduce((total, option) => total + option.unitMinor * option.quantity, 0);
  return {
    status: "available",
    baseMinor,
    baseInheritance: inheritance(input.baseChannel),
    options,
    optionsMinor,
    totalMinor: baseMinor + optionsMinor,
    currency,
  };
}

export type ConfigurationMarginReason =
  | "missing_price"
  | "option_currency_mismatch"
  | "zero_price"
  | "missing_selling_tax_basis"
  | "unconfirmed_selling_tax_basis"
  | "missing_tax_rate"
  | "cost_unavailable"
  | "attribution_unavailable"
  | "unconfirmed_cost_tax_basis"
  | "mixed_cost_tax_basis"
  | "currency_mismatch"
  | "cost_unit_not_each";

export type ConfigurationMargin =
  | {
      status: "available";
      basis: "net" | "gross";
      currency: string;
      priceMicros: bigint;
      costMicros: bigint;
      /** priceMicros − costMicros; may be negative. */
      marginMicros: bigint;
      /** margin ÷ price × 100, half-up to one decimal. */
      marginPercent: { text: string; rounded: boolean };
      rounding: "none" | "half_up_micros";
    }
  | { status: "unavailable"; reason: ConfigurationMarginReason };

/** Ingredient margin for one configuration. It is selling price minus ingredient cost, not profit. */
export function configurationMargin(
  price: ConfigurationPrice,
  sellingTax: { priceTaxBasis: SellingPriceTaxBasis | null; taxRateBasisPoints: number | null },
  cost: ConfigurationCost,
): ConfigurationMargin {
  const unavailable = (reason: ConfigurationMarginReason): ConfigurationMargin => ({ status: "unavailable", reason });
  if (price.status !== "available") return unavailable(price.reason);
  if (price.totalMinor === 0) return unavailable("zero_price");
  if (sellingTax.priceTaxBasis == null) return unavailable("missing_selling_tax_basis");
  if (sellingTax.priceTaxBasis === "unconfirmed") return unavailable("unconfirmed_selling_tax_basis");
  if (cost.status !== "known") {
    return unavailable(cost.reason === "attribution_unavailable" ? "attribution_unavailable" : "cost_unavailable");
  }
  if (cost.taxBasis === "unconfirmed") return unavailable("unconfirmed_cost_tax_basis");
  if (cost.taxBasis === "mixed") return unavailable("mixed_cost_tax_basis");
  if (cost.currency !== price.currency || currencyMinorExponent(price.currency) !== 2) return unavailable("currency_mismatch");
  if (cost.baseMethod === "manual" && cost.manualBaseUnit !== "each") return unavailable("cost_unit_not_each");

  const compared = compareOnBasis(
    { amountMinor: price.totalMinor, isGross: sellingTax.priceTaxBasis === "inclusive", taxRateBasisPoints: sellingTax.taxRateBasisPoints },
    cost.taxBasis === "gross",
  );
  if (compared.status !== "ok") return unavailable("missing_tax_rate");
  const costMicros = toMicrosHalfUp(cost.perSale);
  const marginMicros = compared.priceMicros - costMicros.micros;
  const percent = rational(marginMicros * BigInt(100), compared.priceMicros);
  return {
    status: "available",
    basis: cost.taxBasis,
    currency: price.currency,
    priceMicros: compared.priceMicros,
    costMicros: costMicros.micros,
    marginMicros,
    marginPercent: { text: toDecimalString(percent, 1), rounded: !isExactAt(percent, 1) },
    rounding: compared.rounding === "half_up_micros" || !costMicros.exact ? "half_up_micros" : "none",
  };
}
