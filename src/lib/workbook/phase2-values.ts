import { buildItemGraph, findPath, type GraphUnit } from "@/lib/inventory/conversion-graph";
import { equals, fromMicros, type Rational } from "@/lib/inventory/quantity-math";
import { type QuantityKind, STANDARD_UNITS, standardUnit, type StandardUnitCode } from "@/lib/inventory/standard-units";
import { majorToMicrosExact } from "@/lib/catalogue/selling-tax-cost";

/* Workbook values of the Phase 2 sheets in service vocabulary (QOS-200).
   Pure, shared by the review rules and the apply handlers so preview and
   apply read a cell the same way. */

type Row = Record<string, string | undefined>;

/** Contract quantity kinds to the unit service's kinds. BATCH has no kind of its own and is read as a pack. */
export function quantityKindOf(value: string | undefined | null): QuantityKind | null {
  switch ((value ?? "").trim().toUpperCase()) {
    case "MASS":
      return "mass";
    case "VOLUME":
      return "volume";
    case "COUNT":
      return "count";
    case "PACK":
    case "BATCH":
      return "pack";
    default:
      return null;
  }
}

/**
 * The standard unit a Units row adds (decision D11): its `standard_code`, or
 * for workbooks without that column (1.4 files, Foodics conversions) a name
 * that is exactly a standard code or its English name ("kg", "Kilogram").
 * Matching a fixed vocabulary is enum normalisation, not record matching.
 */
export function standardUnitOfRow(values: Row): { code: StandardUnitCode; byName: boolean } | null {
  const explicit = (values.standard_code ?? "").trim().toLowerCase();
  if (explicit) {
    const definition = standardUnit(explicit);
    return definition ? { code: definition.code, byName: false } : null;
  }
  const name = (values.name ?? "").trim().toLowerCase();
  if (!name) return null;
  const match = STANDARD_UNITS.find((unit) => unit.code === name || unit.nameEn.toLowerCase() === name);
  return match ? { code: match.code, byName: true } : null;
}

/** What a unit is, whether it is a workbook row or an existing record. */
export type UnitFacts = { standardCode: StandardUnitCode | null; quantityKind: QuantityKind | null; decimalPlaces: number | null };

export function unitFactsOfRow(values: Row): UnitFacts {
  const standard = standardUnitOfRow(values);
  const definition = standard ? standardUnit(standard.code) : null;
  const places = Number(values.decimal_places);
  return {
    standardCode: standard?.code ?? null,
    quantityKind: definition ? definition.dimension : quantityKindOf(values.quantity_kind),
    decimalPlaces: values.decimal_places !== undefined && values.decimal_places !== "" && Number.isInteger(places) ? places : null,
  };
}

/** Exact rational of a workbook decimal, or null when it is not one. */
export function decimalRational(text: string | undefined | null): Rational | null {
  const parsed = majorToMicrosExact(text ?? "");
  return parsed.status === "ok" ? fromMicros(parsed.value) : null;
}

/** 1 `from` = factor `to` between two standard units of one dimension, or null. */
export function standardFactor(from: StandardUnitCode | null, to: StandardUnitCode | null): Rational | null {
  if (!from || !to) return null;
  const a = standardUnit(from)!;
  const b = standardUnit(to)!;
  if (a.dimension !== b.dimension) return null;
  const units: GraphUnit[] = [
    { id: "from", code: a.code, quantityKind: a.dimension, standardCode: a.code, status: "active" },
    { id: "to", code: b.code, quantityKind: b.dimension, standardCode: b.code, status: "active" },
  ];
  return findPath(buildItemGraph(units, []), "from", "to")?.factor ?? null;
}

/** Whether a workbook factor equals a known rational exactly. */
export function sameFactor(text: string | undefined | null, value: Rational) {
  const parsed = decimalRational(text);
  return parsed !== null && equals(parsed, value);
}

/** Digits after the point, ignoring trailing zeros ("1.250" → 2). */
export function fractionDigits(text: string) {
  const match = /^\d+(?:\.(\d+))?$/.exec(text.trim());
  return match ? (match[1] ?? "").replace(/0+$/, "").length : 0;
}

export const RECIPE_TARGET_KIND: Record<string, "sellable" | "prepared"> = { SOLD_VARIANT: "sellable", PREPARED_ITEM: "prepared" };

/** A Recipes export row is a draft when it has no business-effective date (approved versions always have one; discarded ones are not exported). */
export function isDraftRecipeRecord(row: Row | null | undefined) {
  return Boolean(row) && !(row!.effective_from ?? "").trim();
}

export const ACTIVE_FLAG_SHEETS: ReadonlySet<string> = new Set(["Units", "Suppliers", "Warehouses", "Inventory Categories", "Ingredients"]);
export const RECIPE_CHILD_SHEETS: ReadonlySet<string> = new Set(["Recipe Lines", "Prep Steps", "Modifier Effects"]);
/** Sheets whose archive is an operation of its own: no status column carries it. */
export const ARCHIVE_OPERATION_SHEETS: ReadonlySet<string> = new Set(["Recipes", "Recipe Lines", "Prep Steps", "Modifier Effects"]);
