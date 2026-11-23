import { describe, expect, it } from "vitest";

import {
  assertRuleInsertable,
  buildItemGraph,
  classifyPair,
  findPath,
  type GraphRule,
  validateConversionInput,
  validateFactorAndJustification,
} from "@/lib/inventory/conversion-graph";
import { toDecimalString } from "@/lib/inventory/quantity-math";
import { micros, unit } from "@/lib/inventory/test-units";

const kg = unit("kg", "mass", { standard: true, decimalPlaces: 3 });
const g = unit("g", "mass", { standard: true });
const mg = unit("mg", "mass", { standard: true });
const ml = unit("ml", "volume", { standard: true });
const l = unit("l", "volume", { standard: true, decimalPlaces: 3 });
const piece = unit("piece", "count", { standard: true });
const packet = unit("packet", "pack");
const box = unit("box", "pack");
const batch = unit("batch", "pack");
const cup = unit("cup", "volume");
const archived = unit("jug", "volume", { status: "archived" });
const UNITS = [kg, g, mg, ml, l, piece, packet, box, batch, cup, archived];

const rule = (id: string, from: { id: string }, to: { id: string }, factor: string): GraphRule => ({
  id,
  fromUnitId: from.id,
  toUnitId: to.id,
  factorMicros: micros(factor),
});

const codeOf = (error: unknown) => (error as { code?: string }).code;
function thrown(fn: () => unknown) {
  try {
    fn();
  } catch (error) {
    return error as { code?: string; statusCode?: number; message: string };
  }
  throw new Error("expected an error");
}

describe("validateConversionInput", () => {
  it("rejects zero and negative factors", () => {
    expect(codeOf(thrown(() => validateConversionInput({ from: packet, to: piece, factor: "0" })))).toBe(
      "factor_not_positive",
    );
    expect(codeOf(thrown(() => validateConversionInput({ from: packet, to: piece, factor: "-12" })))).toBe(
      "factor_not_positive",
    );
    expect(codeOf(thrown(() => validateConversionInput({ from: packet, to: piece, factor: "12.0000001" })))).toBe(
      "factor_too_precise",
    );
  });

  it("rejects the same unit on both sides and archived units", () => {
    expect(codeOf(thrown(() => validateConversionInput({ from: packet, to: packet, factor: "1" })))).toBe("same_unit");
    expect(codeOf(thrown(() => validateConversionInput({ from: archived, to: g, factor: "200", justification: "x" })))).toBe(
      "unit_archived",
    );
  });

  it("refuses to override a standard same-dimension pair such as kg to g", () => {
    const error = thrown(() => validateConversionInput({ from: kg, to: g, factor: "1000" }));
    expect(error.code).toBe("standard_pair_not_overridable");
    expect(error.statusCode).toBe(400);
    expect(classifyPair(l, ml)).toBe("standard_pair");
  });

  it("requires a justification for mass to volume in either direction, with standard or custom units", () => {
    expect(classifyPair(g, ml)).toBe("mass_volume");
    expect(classifyPair(cup, kg)).toBe("mass_volume");
    expect(codeOf(thrown(() => validateConversionInput({ from: g, to: ml, factor: "1.05" })))).toBe(
      "justification_required",
    );
    expect(codeOf(thrown(() => validateConversionInput({ from: cup, to: g, factor: "120", justification: "   " })))).toBe(
      "justification_required",
    );
    expect(validateConversionInput({ from: g, to: ml, factor: "1.05", justification: " Measured density " })).toEqual({
      factorMicros: micros("1.05"),
      justification: "Measured density",
      pairClass: "mass_volume",
    });
    expect(codeOf(thrown(() => validateConversionInput({ from: g, to: ml, factor: "1", justification: "x".repeat(201) })))).toBe(
      "justification_too_long",
    );
  });

  it("needs no justification for pack and count rules", () => {
    expect(validateConversionInput({ from: packet, to: piece, factor: "12" })).toMatchObject({
      factorMicros: micros("12"),
      justification: null,
      pairClass: "item_rule",
    });
    expect(validateFactorAndJustification("item_rule", { factor: "50" }).factorMicros).toBe(micros("50"));
  });
});

describe("item graph", () => {
  it("does not relate mass and volume without an item rule", () => {
    const graph = buildItemGraph(UNITS, []);
    expect(findPath(graph, g.id, ml.id)).toBeNull();
    expect(findPath(graph, kg.id, l.id)).toBeNull();
    expect(() => assertRuleInsertable(graph, g.id, ml.id)).not.toThrow();
  });

  it("resolves standard conversions exactly", () => {
    const graph = buildItemGraph(UNITS, []);
    const path = findPath(graph, kg.id, mg.id)!;
    expect(path.factor).toEqual({ numerator: BigInt(1_000_000), denominator: BigInt(1) });
    expect(path.hops.map((hop) => hop.source)).toEqual(["standard"]);
  });

  it("rejects a duplicate pair and its inverse with 409 duplicate_pair", () => {
    const graph = buildItemGraph(UNITS, [rule("r1", packet, piece, "12")]);
    for (const [from, to] of [
      [packet, piece],
      [piece, packet],
    ]) {
      const error = thrown(() => assertRuleInsertable(graph, from!.id, to!.id));
      expect(error.code).toBe("duplicate_pair");
      expect(error.statusCode).toBe(409);
    }
  });

  it("rejects a circular or conflicting rule that is already derivable, naming the path", () => {
    const graph = buildItemGraph(UNITS, [rule("r1", packet, box, "2"), rule("r2", box, piece, "6")]);
    const error = thrown(() => assertRuleInsertable(graph, packet.id, piece.id));
    expect(error.code).toBe("already_derivable");
    expect(error.statusCode).toBe(409);
    expect(error.message).toContain("1 packet already equals 12 piece");
    expect(error.message).toContain("packet → box → piece");
    // A conflicting factor (packet → piece = 10) is the same pair, so it is refused the same way.
    expect(codeOf(thrown(() => assertRuleInsertable(graph, piece.id, packet.id)))).toBe("already_derivable");
  });

  it("rejects a rule that would close a loop through standard units", () => {
    const graph = buildItemGraph(UNITS, [rule("r1", packet, g, "250")]);
    // kg and packet are already connected: packet → g (rule) → kg (standard).
    expect(codeOf(thrown(() => assertRuleInsertable(graph, kg.id, packet.id)))).toBe("already_derivable");
  });

  it("chains a standard hop with an item hop exactly", () => {
    const graph = buildItemGraph(UNITS, [rule("r1", g, packet, "0.004")]);
    const path = findPath(graph, kg.id, packet.id)!;
    expect(path.hops.map((hop) => [hop.fromCode, hop.toCode, hop.source])).toEqual([
      ["kg", "g", "standard"],
      ["g", "packet", "item_rule"],
    ]);
    expect(path.factor).toEqual({ numerator: BigInt(4), denominator: BigInt(1) });
  });

  it("keeps pack factors isolated per item", () => {
    const itemA = buildItemGraph(UNITS, [rule("a1", packet, piece, "12")]);
    const itemB = buildItemGraph(UNITS, [rule("b1", packet, piece, "50")]);
    const itemC = buildItemGraph(UNITS, []);
    expect(toDecimalString(findPath(itemA, packet.id, piece.id)!.factor, 0)).toBe("12");
    expect(toDecimalString(findPath(itemB, packet.id, piece.id)!.factor, 0)).toBe("50");
    expect(findPath(itemC, packet.id, piece.id)).toBeNull();
    // Item C may define its own, different packet factor.
    expect(() => assertRuleInsertable(itemC, packet.id, piece.id)).not.toThrow();
  });

  it("does not route through archived standard units", () => {
    const archivedG = unit("g", "mass", { standard: true, status: "archived" });
    const graph = buildItemGraph([kg, archivedG], []);
    expect(findPath(graph, kg.id, archivedG.id)).toBeNull();
  });

  it("does not re-run topology when only a factor is revised", () => {
    // A revision validates the factor for the existing pair; the pair itself
    // stays an edge, so the derivability check (which would refuse it) is not used.
    const graph = buildItemGraph(UNITS, [rule("r1", packet, piece, "12")]);
    expect(codeOf(thrown(() => assertRuleInsertable(graph, packet.id, piece.id)))).toBe("duplicate_pair");
    expect(validateFactorAndJustification(classifyPair(packet, piece), { factor: "10" }).factorMicros).toBe(
      micros("10"),
    );
    expect(codeOf(thrown(() => validateFactorAndJustification(classifyPair(g, ml), { factor: "1.1" })))).toBe(
      "justification_required",
    );
  });
});
