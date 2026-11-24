import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import type { GraphRule } from "@/lib/inventory/conversion-graph";
import { type CurrentCostInput, explainItemCost, type KnownItemCost } from "@/lib/inventory/cost-completeness";
import { micros, unit } from "@/lib/inventory/test-units";

const kg = unit("kg", "mass", { standard: true, decimalPlaces: 3 });
const g = unit("g", "mass", { standard: true });
const ml = unit("ml", "volume", { standard: true });
const piece = unit("piece", "count", { standard: true });
const packet = unit("packet", "pack", { decimalPlaces: 0 });
const box = unit("box", "pack", { decimalPlaces: 0 });
const jug = unit("jug", "volume", { status: "archived" });
const UNITS = [kg, g, ml, piece, packet, box, jug];

const rule = (from: { id: string }, to: { id: string }, factor: string): GraphRule => ({
  id: `${from.id}-${to.id}`,
  fromUnitId: from.id,
  toUnitId: to.id,
  factorMicros: micros(factor),
});

function cost(unitId: string, amount: string, overrides: Partial<CurrentCostInput> = {}): CurrentCostInput {
  return {
    publicId: "cost_0001",
    unitId,
    amountMicros: micros(amount),
    currency: "AED",
    taxBasis: "net",
    source: "manual",
    sourceReference: null,
    effectiveFrom: "2026-11-01",
    revision: 1,
    ...overrides,
  };
}

function known(result: ReturnType<typeof explainItemCost>): KnownItemCost {
  if (result.status === "unknown") throw new Error("expected a known cost");
  return result;
}

describe("explainItemCost", () => {
  it("keeps an item without a current cost unknown, with no amount, zero or percentage anywhere", () => {
    const result = explainItemCost({ storageUnitId: kg.id, recipeUnitId: g.id, units: UNITS, rules: [], cost: null });
    expect(result).toEqual({ status: "unknown" });
    expect(Object.keys(result)).toEqual(["status"]);
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/\d/);
    expect(text).not.toContain("%");
  });

  it("keeps the stored amount exact and derives 60 AED per kg as exactly 0.06 per g through the standard table", () => {
    const result = known(
      explainItemCost({ storageUnitId: kg.id, recipeUnitId: g.id, units: UNITS, rules: [], cost: cost(kg.id, "60") }),
    );
    expect(result).toMatchObject({
      status: "known",
      amount: "60",
      amountMicros: "60000000",
      currency: "AED",
      taxBasis: "net",
      source: "manual",
      effectiveFrom: "2026-11-01",
      revision: 1,
      unit: { publicId: kg.publicId, code: "kg" },
    });
    expect(result.perStorageUnit).toEqual({
      status: "derived",
      unit: { publicId: kg.publicId, code: "kg" },
      text: "60",
      rounded: false,
      places: 0,
      path: [],
    });
    expect(result.perRecipeUnit).toEqual({
      status: "derived",
      unit: { publicId: g.publicId, code: "g" },
      text: "0.06",
      rounded: false,
      places: 2,
      path: [{ fromCode: "kg", toCode: "g", source: "standard" }],
    });
  });

  it("preserves more than two decimal places without rounding to cents", () => {
    const result = known(
      explainItemCost({ storageUnitId: kg.id, recipeUnitId: null, units: UNITS, rules: [], cost: cost(kg.id, "12.345678") }),
    );
    expect(result.amount).toBe("12.345678");
    expect(result.amountMicros).toBe("12345678");
    expect(result.perStorageUnit).toMatchObject({ status: "derived", text: "12.345678", rounded: false });
  });

  it("uses the item's own packet rule and rounds a non-terminating inverse half-up to 6 places, flagged", () => {
    // 1 packet = 12 piece, a packet costs 1 AED: one piece is 1/12 = 0.083333… AED.
    const result = known(
      explainItemCost({
        storageUnitId: piece.id,
        recipeUnitId: piece.id,
        units: UNITS,
        rules: [rule(packet, piece, "12")],
        cost: cost(packet.id, "1"),
      }),
    );
    expect(result.status).toBe("known");
    expect(result.perStorageUnit).toEqual({
      status: "derived",
      unit: { publicId: piece.publicId, code: "piece" },
      text: "0.083333",
      rounded: true,
      places: 6,
      path: [{ fromCode: "packet", toCode: "piece", source: "item_rule" }],
    });
    // 2/3 rounds up at the sixth place.
    const twoThirds = known(
      explainItemCost({
        storageUnitId: piece.id,
        recipeUnitId: null,
        units: UNITS,
        rules: [rule(packet, piece, "3")],
        cost: cost(packet.id, "2"),
      }),
    );
    expect(twoThirds.perStorageUnit).toMatchObject({ text: "0.666667", rounded: true });
  });

  it("chains item rules: packet → box → piece", () => {
    const result = known(
      explainItemCost({
        storageUnitId: piece.id,
        recipeUnitId: null,
        units: UNITS,
        rules: [rule(box, packet, "4"), rule(packet, piece, "6")],
        cost: cost(box.id, "48"),
      }),
    );
    expect(result.perStorageUnit).toMatchObject({ status: "derived", text: "2", rounded: false });
  });

  it("does not relate mass and volume without an item rule and marks the cost not convertible", () => {
    const result = known(
      explainItemCost({ storageUnitId: kg.id, recipeUnitId: ml.id, units: UNITS, rules: [], cost: cost(kg.id, "10") }),
    );
    expect(result.status).toBe("known_not_convertible");
    expect(result.perStorageUnit).toMatchObject({ status: "derived", text: "10" });
    expect(result.perRecipeUnit).toEqual({
      status: "missing",
      unit: { publicId: ml.publicId, code: "ml" },
      reason: "mass_volume_needs_item_rule",
    });
    expect(result.amount).toBe("10");
    // With an explicit item rule (1 kg = 1000 ml) the same cost converts.
    const withRule = known(
      explainItemCost({
        storageUnitId: kg.id,
        recipeUnitId: ml.id,
        units: UNITS,
        rules: [rule(kg, ml, "1000")],
        cost: cost(kg.id, "10"),
      }),
    );
    expect(withRule.status).toBe("known");
    expect(withRule.perRecipeUnit).toMatchObject({ status: "derived", text: "0.01" });
  });

  it("reports a pack unit without a rule and an archived target as unavailable, never as a number", () => {
    const pack = known(
      explainItemCost({ storageUnitId: piece.id, recipeUnitId: null, units: UNITS, rules: [], cost: cost(packet.id, "5") }),
    );
    expect(pack.status).toBe("known_not_convertible");
    expect(pack.perStorageUnit).toEqual({
      status: "missing",
      unit: { publicId: piece.publicId, code: "piece" },
      reason: "pack_needs_item_rule",
    });
    const archived = known(
      explainItemCost({ storageUnitId: ml.id, recipeUnitId: jug.id, units: UNITS, rules: [], cost: cost(ml.id, "5") }),
    );
    expect(archived.status).toBe("known_not_convertible");
    expect(archived.perRecipeUnit).toMatchObject({ status: "missing", reason: "unit_archived" });
    expect("text" in archived.perRecipeUnit).toBe(false);
  });

  it("ignores undesignated storage or recipe units when deciding completeness", () => {
    const result = known(
      explainItemCost({ storageUnitId: kg.id, recipeUnitId: null, units: UNITS, rules: [], cost: cost(kg.id, "3") }),
    );
    expect(result.status).toBe("known");
    expect(result.perRecipeUnit).toEqual({ status: "missing", unit: null, reason: "not_designated" });
  });

  it("represents a known zero as an explicit 0 everywhere, distinct from unknown", () => {
    const result = known(
      explainItemCost({ storageUnitId: kg.id, recipeUnitId: g.id, units: UNITS, rules: [], cost: cost(kg.id, "0") }),
    );
    expect(result.status).toBe("known");
    expect(result.amount).toBe("0");
    expect(result.amountMicros).toBe("0");
    expect(result.perStorageUnit).toMatchObject({ status: "derived", text: "0", rounded: false });
    expect(result.perRecipeUnit).toMatchObject({ status: "derived", text: "0", rounded: false });
    expect(explainItemCost({ storageUnitId: kg.id, recipeUnitId: g.id, units: UNITS, rules: [], cost: null })).not.toEqual(
      expect.objectContaining({ amount: expect.anything() }),
    );
  });

  it("keeps an unconfirmed tax basis as a known amount with its basis", () => {
    const result = known(
      explainItemCost({
        storageUnitId: kg.id,
        recipeUnitId: null,
        units: UNITS,
        rules: [],
        cost: cost(kg.id, "7.5", { taxBasis: "unconfirmed", source: "invoice", sourceReference: "INV-9" }),
      }),
    );
    expect(result).toMatchObject({ status: "known", amount: "7.5", taxBasis: "unconfirmed", source: "invoice", sourceReference: "INV-9" });
  });
});

describe("inventory sources compute no margin", () => {
  function sources(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const full = path.join(directory, entry);
      if (statSync(full).isDirectory()) return sources(full);
      return entry.endsWith(".ts") && !entry.endsWith(".test.ts") ? [full] : [];
    });
  }

  it("has no margin identifier in src/lib/inventory outside tests", () => {
    const files = sources(path.join(process.cwd(), "src/lib/inventory"));
    expect(files.length).toBeGreaterThan(10);
    const offenders = files.filter((file) => /margin/i.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });
});
