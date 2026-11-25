import { describe, expect, it } from "vitest";

import { type Rational, toDecimalString } from "@/lib/inventory/quantity-math";
import { micros } from "@/lib/inventory/test-units";
import {
  beans,
  configuration,
  costItems,
  g,
  kg,
  l,
  milk,
  ml,
  oat,
  pack,
  UNITS,
} from "@/lib/recipes/configuration-test-fixtures";
import {
  batchCost,
  type ConfigurationCost,
  configurationMargin,
  configurationPrice,
  costConfiguration,
  type CostPolicyInput,
} from "@/lib/recipes/costing";
import { applyModifierEffects, type ConfigurationInput } from "@/lib/recipes/effects";
import type { ModifierSelectionInput } from "@/lib/catalogue/modifier-selection";

const money = (value: Rational) => toDecimalString(value, 2);
const manual = (amount: string, overrides: Partial<NonNullable<CostPolicyInput>> = {}): CostPolicyInput => ({
  method: "manual",
  amountMicros: micros(amount),
  currency: "AED",
  unit: "each",
  taxBasis: "net",
  ...overrides,
});
const derived: CostPolicyInput = { method: "recipe_derived", amountMicros: null, currency: null, unit: null, taxBasis: null };

function cost(
  selections: ModifierSelectionInput[] = [],
  options: {
    soldQuantity?: number;
    items?: ReturnType<typeof costItems>;
    basePolicy?: CostPolicyInput;
    optionPolicies?: Record<string, CostPolicyInput>;
    links?: ConfigurationInput["links"];
  } = {},
): ConfigurationCost {
  const soldQuantity = options.soldQuantity ?? 1;
  return costConfiguration({
    configuration: applyModifierEffects(configuration({ selections, soldQuantity, ...(options.links ? { links: options.links } : {}) })),
    soldQuantity,
    units: UNITS,
    items: options.items ?? costItems(),
    basePolicy: options.basePolicy ?? null,
    optionPolicies: new Map(Object.entries(options.optionPolicies ?? {})),
  });
}

function known(result: ConfigurationCost) {
  if (result.status !== "known") throw new Error(`expected known cost, got ${JSON.stringify(result)}`);
  return result;
}

const WORKED: ModifierSelectionInput[] = [
  { optionPublicId: "modopt_shot", quantity: 2 },
  { optionPublicId: "modopt_oat", quantity: 1 },
];

describe("costConfiguration: sums", () => {
  it("costs the base lines: 0.80 milk + 1.08 beans = 1.88, equal to the version's per-output cost", () => {
    const result = known(cost());
    expect([money(result.perSale), money(result.total), result.currency, result.taxBasis]).toEqual(["1.88", "1.88", "AED", "net"]);
    const batch = batchCost({
      lines: [
        { lineId: "a", itemId: milk.id, unitId: ml.id, quantityMicros: micros("200") },
        { lineId: "b", itemId: beans.id, unitId: g.id, quantityMicros: micros("18") },
      ],
      yieldQuantityMicros: micros("1"),
      units: UNITS,
      items: costItems(),
    });
    expect(batch.total.status === "known" && money(batch.total.perYieldUnit!)).toBe("1.88");
  });

  it("worked example: extra shot ×2 and oat milk ×1 sold 3 costs 3.96 per sale and 11.88 in total", () => {
    const result = known(cost(WORKED, { soldQuantity: 3 }));
    expect([money(result.perSale), money(result.total)]).toEqual(["3.96", "11.88"]);
    expect(result.components.map((entry) => [entry.source, entry.optionId, entry.method, money(entry.amount!)])).toEqual([
      ["base", null, "derived", "1.88"],
      ["option", "opt-shot", "derived", "1.08"],
      // Oat milk: 200 ml oat at 9/l minus the removed 200 ml milk at 4/l.
      ["option", "opt-oat", "derived", "1.00"],
    ]);
    expect(result.contributionCosts.map((entry) => (entry.status === "known" ? money(entry.amount) : entry.status))).toEqual([
      "0.80",
      "1.08",
      "1.08",
      "-0.80",
      "1.80",
    ]);
  });

  it("batch cost sums every line and per-output divides by a positive yield; no yield gives no per-output", () => {
    const lines = [
      { lineId: "a", itemId: milk.id, unitId: ml.id, quantityMicros: micros("1000") },
      { lineId: "b", itemId: beans.id, unitId: g.id, quantityMicros: micros("72") },
    ];
    const four = batchCost({ lines, yieldQuantityMicros: micros("4"), units: UNITS, items: costItems() });
    expect(four.total.status === "known" && [money(four.total.perBatch), money(four.total.perYieldUnit!)]).toEqual(["8.32", "2.08"]);
    const none = batchCost({ lines, yieldQuantityMicros: null, units: UNITS, items: costItems() });
    expect(none.total.status === "known" && none.total.perYieldUnit).toBeNull();
    const missing = batchCost({ lines, yieldQuantityMicros: micros("4"), units: UNITS, items: costItems({ [beans.id]: null }) });
    expect(missing.total).toEqual({ status: "unavailable", linesWithoutCost: 1 });
  });
});

describe("costConfiguration: unknown is never zero", () => {
  it("one component without a cost makes the total unavailable with a count", () => {
    const result = cost([{ optionPublicId: "modopt_shot", quantity: 2 }], { items: costItems({ [beans.id]: null }) });
    expect(result).toMatchObject({ status: "unavailable", reason: "incomplete", missingCount: 2 });
    expect("perSale" in result).toBe(false);
  });

  it("a cost unit that cannot be reached counts as missing", () => {
    const result = cost([], { items: costItems({ [milk.id]: { unitId: pack.id, amountMicros: micros("4"), currency: "AED", taxBasis: "net" } }) });
    expect(result).toMatchObject({ status: "unavailable", reason: "incomplete", missingCount: 1 });
    expect(result.contributionCosts[0]).toEqual({ status: "not_convertible" });
  });

  it("never adds up two currencies", () => {
    const result = cost(WORKED, { items: costItems({ [oat.id]: { unitId: l.id, amountMicros: micros("9"), currency: "USD", taxBasis: "net" } }) });
    expect(result).toMatchObject({ status: "unavailable", reason: "currency_mismatch" });
  });

  it("combines tax bases: all gross, any unconfirmed, net with gross", () => {
    const gross = { currency: "AED", taxBasis: "gross" as const };
    const allGross = costItems({
      [milk.id]: { unitId: l.id, amountMicros: micros("4"), ...gross },
      [beans.id]: { unitId: kg.id, amountMicros: micros("60"), ...gross },
    });
    expect(known(cost([], { items: allGross })).taxBasis).toBe("gross");
    expect(known(cost([], { items: costItems({ [milk.id]: { unitId: l.id, amountMicros: micros("4"), currency: "AED", taxBasis: "unconfirmed" } }) })).taxBasis).toBe(
      "unconfirmed",
    );
    expect(known(cost([], { items: costItems({ [milk.id]: { unitId: l.id, amountMicros: micros("4"), ...gross } }) })).taxBasis).toBe("mixed");
  });

  it("a rejected configuration has no cost", () => {
    expect(cost([{ optionPublicId: "modopt_oat", quantity: 2 }])).toMatchObject({ status: "unavailable", reason: "rejected" });
  });
});

describe("costConfiguration: manual and derived are never both counted", () => {
  it("manual base and manual option: the manual amounts only, ingredient lines and effects not costed", () => {
    const result = known(cost(WORKED, { basePolicy: manual("5"), optionPolicies: { "opt-shot": manual("1.5"), "opt-oat": manual("2") } }));
    expect(money(result.perSale)).toBe("10.00");
    expect(result.contributionCosts.map((entry) => entry.status === "not_costed" && entry.reason)).toEqual([
      "manual_base",
      "manual_base",
      "manual_option",
      "manual_option",
      "manual_option",
    ]);
  });

  it("manual base with an add-only option: base plus the added ingredient cost", () => {
    const result = known(cost([{ optionPublicId: "modopt_shot", quantity: 2 }], { basePolicy: manual("5") }));
    expect(money(result.perSale)).toBe("6.08");
  });

  it("manual base with a remove or replace option and no manual option cost: attribution unavailable", () => {
    for (const selection of ["modopt_nomilk", "modopt_oat"]) {
      const optionId = selection === "modopt_oat" ? "opt-oat" : "opt-nomilk";
      const result = cost([{ optionPublicId: selection, quantity: 1 }], { basePolicy: manual("5") });
      expect(result, selection).toMatchObject({ status: "unavailable", reason: "attribution_unavailable", attributionOptionIds: [optionId] });
      expect(result.components[0]).toMatchObject({ source: "base", method: "manual", status: "known" });
    }
    expect(known(cost([{ optionPublicId: "modopt_oat", quantity: 1 }], { basePolicy: manual("5"), optionPolicies: { "opt-oat": manual("2") } })).perSale).toEqual(
      { numerator: BigInt(7), denominator: BigInt(1) },
    );
  });

  it("a recipe-derived policy costs like no policy", () => {
    expect(money(known(cost(WORKED, { basePolicy: derived, optionPolicies: { "opt-shot": derived } })).perSale)).toBe("3.96");
  });

  it("without a recipe only an all-manual configuration has a cost", () => {
    const links: never[] = [];
    expect(cost([], { links, basePolicy: derived })).toMatchObject({ status: "unavailable", reason: "unresolved" });
    expect(money(known(cost([], { links, basePolicy: manual("5") })).perSale)).toBe("5.00");
  });
});

describe("configurationMargin", () => {
  const price = (overrides: Partial<Parameters<typeof configurationPrice>[0]> = {}) =>
    configurationPrice({
      base: { amountMinor: 1800, currency: "AED" },
      options: [
        { optionId: "opt-shot", priceMinor: 300, currency: "AED", quantity: 2 },
        { optionId: "opt-oat", priceMinor: 200, currency: "AED", quantity: 1 },
      ],
      ...overrides,
    });
  const exclusive = { priceTaxBasis: "exclusive" as const, taxRateBasisPoints: 500 };
  const workedCost = () => cost(WORKED);

  it("worked example: 26.00 exclusive against 3.96 net is 22.04, 84.8% rounded", () => {
    const result = configurationMargin(price(), exclusive, workedCost());
    expect(result).toEqual({
      status: "available",
      basis: "net",
      currency: "AED",
      priceMicros: BigInt(26_000_000),
      costMicros: BigInt(3_960_000),
      marginMicros: BigInt(22_040_000),
      marginPercent: { text: "84.8", rounded: true },
      rounding: "none",
    });
  });

  it("an inclusive price is brought to net once, half-up to micros", () => {
    const result = configurationMargin(price(), { priceTaxBasis: "inclusive", taxRateBasisPoints: 500 }, workedCost());
    expect(result).toMatchObject({ status: "available", priceMicros: BigInt(24_761_905), marginMicros: BigInt(20_801_905), rounding: "half_up_micros" });
  });

  it("an exclusive price against a gross cost is brought to gross exactly", () => {
    const grossItems = costItems({
      [milk.id]: { unitId: l.id, amountMicros: micros("4"), currency: "AED", taxBasis: "gross" },
      [beans.id]: { unitId: kg.id, amountMicros: micros("60"), currency: "AED", taxBasis: "gross" },
    });
    const result = configurationMargin(price({ options: [] }), exclusive, cost([], { items: grossItems }));
    expect(result).toMatchObject({ status: "available", basis: "gross", priceMicros: BigInt(18_900_000), marginMicros: BigInt(17_020_000) });
  });

  it.each([
    ["unknown cost", () => configurationMargin(price(), exclusive, cost(WORKED, { items: costItems({ [beans.id]: null }) })), "cost_unavailable"],
    [
      "unconfirmed cost basis",
      () =>
        configurationMargin(price(), exclusive, cost(WORKED, { items: costItems({ [oat.id]: { unitId: l.id, amountMicros: micros("9"), currency: "AED", taxBasis: "unconfirmed" } }) })),
      "unconfirmed_cost_tax_basis",
    ],
    [
      "mixed cost basis",
      () =>
        configurationMargin(price(), exclusive, cost(WORKED, { items: costItems({ [oat.id]: { unitId: l.id, amountMicros: micros("9"), currency: "AED", taxBasis: "gross" } }) })),
      "mixed_cost_tax_basis",
    ],
    ["unconfirmed selling basis", () => configurationMargin(price(), { priceTaxBasis: "unconfirmed", taxRateBasisPoints: 500 }, workedCost()), "unconfirmed_selling_tax_basis"],
    ["missing selling basis", () => configurationMargin(price(), { priceTaxBasis: null, taxRateBasisPoints: 500 }, workedCost()), "missing_selling_tax_basis"],
    ["missing rate when bases differ", () => configurationMargin(price(), { priceTaxBasis: "inclusive", taxRateBasisPoints: null }, workedCost()), "missing_tax_rate"],
    ["zero price", () => configurationMargin(price({ base: { amountMinor: 0, currency: "AED" }, options: [] }), exclusive, cost()), "zero_price"],
    ["missing price", () => configurationMargin(price({ base: null }), exclusive, workedCost()), "missing_price"],
    ["cost and price currencies differ", () => configurationMargin(price({ base: { amountMinor: 1800, currency: "USD" }, options: [] }), exclusive, cost()), "currency_mismatch"],
    [
      "an option price in another currency",
      () => configurationMargin(price({ options: [{ optionId: "opt-shot", priceMinor: 300, currency: "USD", quantity: 1 }] }), exclusive, workedCost()),
      "option_currency_mismatch",
    ],
    ["attribution unavailable", () => configurationMargin(price(), exclusive, cost([{ optionPublicId: "modopt_nomilk", quantity: 1 }], { basePolicy: manual("5") })), "attribution_unavailable"],
    ["manual base cost per kg", () => configurationMargin(price({ options: [] }), exclusive, cost([], { basePolicy: manual("5", { unit: "kg" }) })), "cost_unit_not_each"],
  ])("%s: no number and no percentage", (_, run, reason) => {
    expect(run()).toEqual({ status: "unavailable", reason });
  });

  it("a zero price never yields a percentage, even with a known cost", () => {
    const result = configurationMargin(price({ base: { amountMinor: 0, currency: "AED" }, options: [] }), exclusive, cost());
    expect("marginPercent" in result).toBe(false);
  });

  it("uses the channel row when there is one and inherits the central price when there is none", () => {
    const inherited = configurationPrice({ base: { amountMinor: 1800, currency: "AED" }, baseChannel: null, options: [] });
    expect(inherited).toMatchObject({ status: "available", baseMinor: 1800, baseInheritance: "inherited" });
    const override = configurationPrice({
      base: { amountMinor: 1800, currency: "AED" },
      baseChannel: { amountMinor: 2100, currency: "AED", version: 1 },
      options: [{ optionId: "opt-shot", priceMinor: 300, currency: "AED", quantity: 2, channel: { amountMinor: 350, currency: "AED", version: 1 } }],
    });
    expect(override).toMatchObject({ status: "available", baseMinor: 2100, baseInheritance: "override", optionsMinor: 700, totalMinor: 2800 });
    expect(configurationPrice({ base: { amountMinor: 1800, currency: "AED" }, options: [] })).toMatchObject({ baseInheritance: "central" });
  });
});
