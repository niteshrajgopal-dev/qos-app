import { describe, expect, it } from "vitest";

import { rational } from "@/lib/inventory/quantity-math";
import { micros, unit } from "@/lib/inventory/test-units";
import { estimateRecipeCost } from "@/lib/recipes/cost-estimate";

const g = unit("g", "mass", { standard: true });
const kg = unit("kg", "mass", { standard: true, decimalPlaces: 3 });
const ml = unit("ml", "volume", { standard: true });
const l = unit("l", "volume", { standard: true, decimalPlaces: 3 });
const packet = unit("packet", "pack");
const UNITS = [g, kg, ml, l, packet];

const lines = [
  { lineId: "milk", itemId: "item-milk", unitId: ml.id, quantityMicros: micros("1000") },
  { lineId: "beans", itemId: "item-beans", unitId: g.id, quantityMicros: micros("72") },
];
const milkCost = { itemId: "item-milk", cost: { unitId: l.id, amountMicros: micros("5"), currency: "AED", taxBasis: "net" as const }, rules: [] };
const beansCost = { itemId: "item-beans", cost: { unitId: kg.id, amountMicros: micros("120"), currency: "AED", taxBasis: "net" as const }, rules: [] };

describe("estimateRecipeCost", () => {
  it("adds exact line costs and divides by the yield when every cost is known", () => {
    const estimate = estimateRecipeCost({ lines, yieldQuantityMicros: micros("4"), units: UNITS, items: [milkCost, beansCost] });
    // 1 l × 5 + 0.072 kg × 120 = 5 + 8.64 = 13.64 per batch; 3.41 per portion.
    expect(estimate.lines).toEqual([
      { lineId: "milk", status: "known", amount: rational(BigInt(5)), currency: "AED", taxBasis: "net" },
      { lineId: "beans", status: "known", amount: rational(BigInt(864), BigInt(100)), currency: "AED", taxBasis: "net" },
    ]);
    expect(estimate.total).toEqual({
      status: "known",
      perBatch: rational(BigInt(1364), BigInt(100)),
      perYieldUnit: rational(BigInt(341), BigInt(100)),
      currency: "AED",
      taxBasis: "net",
    });
  });

  it("is unavailable, never zero, when any line has no cost", () => {
    const estimate = estimateRecipeCost({
      lines,
      yieldQuantityMicros: micros("4"),
      units: UNITS,
      items: [milkCost, { itemId: "item-beans", cost: null, rules: [] }],
    });
    expect(estimate.lines[1]).toEqual({ lineId: "beans", status: "unknown" });
    expect(estimate.total).toEqual({ status: "unavailable", linesWithoutCost: 1 });
    expect(JSON.stringify(estimate.total)).not.toContain("perBatch");
  });

  it("is unavailable when a line unit does not convert to the cost unit, until an item rule links them", () => {
    const packetLine = [{ lineId: "beans", itemId: "item-beans", unitId: packet.id, quantityMicros: micros("1") }];
    const without = estimateRecipeCost({ lines: packetLine, yieldQuantityMicros: micros("1"), units: UNITS, items: [beansCost] });
    expect(without.lines[0]).toEqual({ lineId: "beans", status: "not_convertible" });
    expect(without.total).toEqual({ status: "unavailable", linesWithoutCost: 1 });
    const withRule = estimateRecipeCost({
      lines: packetLine,
      yieldQuantityMicros: micros("1"),
      units: UNITS,
      items: [{ ...beansCost, rules: [{ id: "r", fromUnitId: packet.id, toUnitId: g.id, factorMicros: micros("250") }] }],
    });
    expect(withRule.total).toMatchObject({ status: "known", perBatch: rational(BigInt(30)) });
  });

  it("reports mixed tax bases and keeps a known zero as zero", () => {
    const estimate = estimateRecipeCost({
      lines,
      yieldQuantityMicros: null,
      units: UNITS,
      items: [
        { ...milkCost, cost: { ...milkCost.cost, amountMicros: BigInt(0), taxBasis: "gross" as const } },
        { ...beansCost, cost: { ...beansCost.cost, taxBasis: "unconfirmed" as const } },
      ],
    });
    expect(estimate.total).toEqual({
      status: "known",
      perBatch: rational(BigInt(864), BigInt(100)),
      perYieldUnit: null,
      currency: "AED",
      taxBasis: "mixed",
    });
    expect(estimate.lines[0]).toMatchObject({ status: "known", amount: rational(BigInt(0)) });
  });

  it("says there are no lines instead of a zero total", () => {
    expect(estimateRecipeCost({ lines: [], yieldQuantityMicros: micros("1"), units: UNITS, items: [] }).total).toEqual({
      status: "no_lines",
    });
  });
});
