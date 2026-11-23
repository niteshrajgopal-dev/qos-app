import { InventoryConflictError, InventoryError } from "@/lib/inventory/errors";
import {
  fromMicros,
  inverse,
  mul,
  parseFactorMicros,
  rational,
  type Rational,
  toDecimalString,
  toExactDecimalString,
} from "@/lib/inventory/quantity-math";
import { type QuantityKind, standardUnit, type StandardUnitCode } from "@/lib/inventory/standard-units";

/* QOS-195 item conversion graph. Pure: no I/O.

   One item's graph is its current rules (undirected: a rule 1 A = f B also
   gives 1 B = 1/f A) plus implicit standard edges between active standard
   units of the same dimension (kg ↔ g ↔ mg). Rules from other items are
   never passed in, so one item's pack factor cannot reach another item.
   Mass and volume are never linked by a standard edge: only an explicit
   item rule (with a justification) relates them, and nothing infers one
   from names, codes or other items.

   A new rule is refused when its two units are already connected. That
   keeps every item's rules a forest over the standard dimensions, so there
   is exactly one derivation per pair and no cycle or conflicting path. */

export const JUSTIFICATION_MAX_LENGTH = 200;

export type GraphUnit = {
  id: string;
  code: string;
  quantityKind: QuantityKind;
  standardCode: StandardUnitCode | null;
  status: "active" | "archived";
};

export type GraphRule = {
  id: string;
  fromUnitId: string;
  toUnitId: string;
  factorMicros: bigint;
};

export type GraphEdgeSource = "item_rule" | "standard";

type Edge = { to: string; factor: Rational; source: GraphEdgeSource; ruleId: string | null };

export type ItemGraph = {
  units: ReadonlyMap<string, GraphUnit>;
  adjacency: ReadonlyMap<string, readonly Edge[]>;
  rules: readonly GraphRule[];
};

export type PathHop = {
  fromUnitId: string;
  toUnitId: string;
  fromCode: string;
  toCode: string;
  factor: Rational;
  source: GraphEdgeSource;
  ruleId: string | null;
};

export type DerivedPath = { factor: Rational; hops: PathHop[] };

function standardFactor(from: StandardUnitCode, to: StandardUnitCode): Rational {
  const a = standardUnit(from)!.toBase;
  const b = standardUnit(to)!.toBase;
  // 1 from = a base; 1 to = b base → 1 from = a / b to.
  return rational(a.numerator * b.denominator, a.denominator * b.numerator);
}

export function buildItemGraph(units: readonly GraphUnit[], rules: readonly GraphRule[]): ItemGraph {
  const unitMap = new Map(units.map((unit) => [unit.id, unit]));
  const adjacency = new Map<string, Edge[]>();
  const add = (from: string, edge: Edge) => {
    const list = adjacency.get(from) ?? [];
    list.push(edge);
    adjacency.set(from, list);
  };

  for (const rule of rules) {
    const factor = fromMicros(rule.factorMicros);
    add(rule.fromUnitId, { to: rule.toUnitId, factor, source: "item_rule", ruleId: rule.id });
    add(rule.toUnitId, { to: rule.fromUnitId, factor: inverse(factor), source: "item_rule", ruleId: rule.id });
  }

  const standards = units.filter((unit) => unit.standardCode && unit.status === "active");
  for (const a of standards) {
    for (const b of standards) {
      if (a.id === b.id) continue;
      if (standardUnit(a.standardCode)!.dimension !== standardUnit(b.standardCode)!.dimension) continue;
      add(a.id, { to: b.id, factor: standardFactor(a.standardCode!, b.standardCode!), source: "standard", ruleId: null });
    }
  }

  return { units: unitMap, adjacency, rules };
}

/** Breadth-first path from one unit to another, or null when they are not connected. */
export function findPath(graph: ItemGraph, fromUnitId: string, toUnitId: string): DerivedPath | null {
  if (fromUnitId === toUnitId) {
    return { factor: rational(BigInt(1)), hops: [] };
  }
  const previous = new Map<string, { from: string; edge: Edge }>();
  const visited = new Set([fromUnitId]);
  const queue = [fromUnitId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of graph.adjacency.get(current) ?? []) {
      if (visited.has(edge.to)) continue;
      visited.add(edge.to);
      previous.set(edge.to, { from: current, edge });
      if (edge.to === toUnitId) {
        const hops: PathHop[] = [];
        let cursor = toUnitId;
        while (cursor !== fromUnitId) {
          const step = previous.get(cursor)!;
          hops.unshift({
            fromUnitId: step.from,
            toUnitId: cursor,
            fromCode: graph.units.get(step.from)?.code ?? step.from,
            toCode: graph.units.get(cursor)?.code ?? cursor,
            factor: step.edge.factor,
            source: step.edge.source,
            ruleId: step.edge.ruleId,
          });
          cursor = step.from;
        }
        const factor = hops.reduce((total, hop) => mul(total, hop.factor), rational(BigInt(1)));
        return { factor, hops };
      }
      queue.push(edge.to);
    }
  }
  return null;
}

export type PairClass = "standard_pair" | "mass_volume" | "item_rule";

/** How a pair of distinct units may be related for an item. */
export function classifyPair(from: GraphUnit, to: GraphUnit): PairClass {
  const fromStandard = standardUnit(from.standardCode);
  const toStandard = standardUnit(to.standardCode);
  if (fromStandard && toStandard && fromStandard.dimension === toStandard.dimension) {
    return "standard_pair";
  }
  const kinds = new Set([from.quantityKind, to.quantityKind]);
  if (kinds.has("mass") && kinds.has("volume")) {
    return "mass_volume";
  }
  return "item_rule";
}

function normalizeJustification(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new InventoryError("Justification must be text.", 400, "justification_invalid", "justification");
  }
  const trimmed = value.trim();
  if (trimmed.length > JUSTIFICATION_MAX_LENGTH) {
    throw new InventoryError(
      `Justification can be at most ${JUSTIFICATION_MAX_LENGTH} characters.`,
      400,
      "justification_too_long",
      "justification",
    );
  }
  return trimmed || null;
}

const FACTOR_MESSAGES = {
  factor_invalid: "Enter the factor as a plain decimal number, for example 12 or 0.5.",
  factor_not_positive: "The factor must be greater than zero.",
  factor_too_precise: "The factor can have at most 6 decimal places.",
} as const;

/** Parses the factor and justification for a known pair (used by create and revise). */
export function validateFactorAndJustification(
  pairClass: PairClass,
  input: { factor: unknown; justification?: unknown },
): { factorMicros: bigint; justification: string | null } {
  const parsed = parseFactorMicros(input.factor);
  if (parsed.status === "invalid") {
    throw new InventoryError(FACTOR_MESSAGES[parsed.code], 400, parsed.code, "factor");
  }
  const justification = normalizeJustification(input.justification);
  if (pairClass === "mass_volume" && !justification) {
    throw new InventoryError(
      "A mass to volume rule needs a justification for this item, for example a measured density.",
      400,
      "justification_required",
      "justification",
    );
  }
  return { factorMicros: parsed.micros, justification };
}

/**
 * Checks §1C rules 1–4 for a new rule: positive exact factor, two different
 * active units, no standard same-dimension pair, and a justification for
 * mass ↔ volume. Unit lookups (404) happen in the service before this.
 */
export function validateConversionInput(input: {
  from: GraphUnit;
  to: GraphUnit;
  factor: unknown;
  justification?: unknown;
}): { factorMicros: bigint; justification: string | null; pairClass: PairClass } {
  const { from, to } = input;
  if (from.id === to.id) {
    throw new InventoryError("Choose two different units.", 400, "same_unit", "toUnitPublicId");
  }
  if (from.status !== "active" || to.status !== "active") {
    throw new InventoryError(
      "Archived units cannot be used in a new conversion. Restore the unit first.",
      400,
      "unit_archived",
      from.status !== "active" ? "fromUnitPublicId" : "toUnitPublicId",
    );
  }
  const pairClass = classifyPair(from, to);
  if (pairClass === "standard_pair") {
    throw new InventoryError(
      `${from.code} and ${to.code} are standard units of the same kind. The standard conversion applies and cannot be overridden per item.`,
      400,
      "standard_pair_not_overridable",
      "toUnitPublicId",
    );
  }
  return { ...validateFactorAndJustification(pairClass, input), pairClass };
}

export function describePath(path: DerivedPath, fromCode: string): string {
  return [fromCode, ...path.hops.map((hop) => hop.toCode)].join(" → ");
}

/**
 * §1C rules 5–6: refuses a rule for a pair that already has a current rule
 * on this item (either direction), and a rule whose units are already
 * connected through other rules or standard conversions.
 */
export function assertRuleInsertable(graph: ItemGraph, fromUnitId: string, toUnitId: string): void {
  const duplicate = graph.rules.some(
    (rule) =>
      (rule.fromUnitId === fromUnitId && rule.toUnitId === toUnitId) ||
      (rule.fromUnitId === toUnitId && rule.toUnitId === fromUnitId),
  );
  const fromCode = graph.units.get(fromUnitId)?.code ?? fromUnitId;
  const toCode = graph.units.get(toUnitId)?.code ?? toUnitId;
  if (duplicate) {
    throw new InventoryConflictError(
      `This item already has a current rule between ${fromCode} and ${toCode}. Change its factor instead.`,
      "duplicate_pair",
      "toUnitPublicId",
    );
  }
  const path = findPath(graph, fromUnitId, toUnitId);
  if (path) {
    throw new InventoryConflictError(
      `1 ${fromCode} already equals ${toExactDecimalString(path.factor, 6) ?? toDecimalString(path.factor, 6)} ${toCode} for this item through ${describePath(path, fromCode)}.`,
      "already_derivable",
      "toUnitPublicId",
    );
  }
}
