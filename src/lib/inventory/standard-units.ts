/* QOS-195 standard units. These are code constants, not seeded rows: a
   tenant opts in by creating a unit with `standard_code` set. Factors are
   exact rationals to the dimension base (mass → g, volume → ml, count →
   piece), so kg ↔ g never needs an item rule and can never be overridden.
   The SQL CHECK on inventory_units.standard_code lists the same codes
   (asserted by standard-units.test.ts). Imperial units are not standard
   (D5 pending); a tenant can add them as custom units with item rules. */

export type QuantityKind = "mass" | "volume" | "count" | "pack";
export type StandardDimension = Exclude<QuantityKind, "pack">;
export type StandardUnitCode = "mg" | "g" | "kg" | "ml" | "cl" | "l" | "piece";

export const QUANTITY_KINDS: readonly QuantityKind[] = ["mass", "volume", "count", "pack"];

export type StandardUnitDefinition = {
  code: StandardUnitCode;
  dimension: StandardDimension;
  /** 1 unit = toBase.numerator / toBase.denominator base units. */
  toBase: { numerator: bigint; denominator: bigint };
  nameEn: string;
  nameAr: string;
  defaultDecimalPlaces: number;
};

const one = BigInt(1);

export const STANDARD_UNITS: readonly StandardUnitDefinition[] = [
  { code: "mg", dimension: "mass", toBase: { numerator: one, denominator: BigInt(1000) }, nameEn: "Milligram", nameAr: "ملليغرام", defaultDecimalPlaces: 0 },
  { code: "g", dimension: "mass", toBase: { numerator: one, denominator: one }, nameEn: "Gram", nameAr: "غرام", defaultDecimalPlaces: 0 },
  { code: "kg", dimension: "mass", toBase: { numerator: BigInt(1000), denominator: one }, nameEn: "Kilogram", nameAr: "كيلوغرام", defaultDecimalPlaces: 3 },
  { code: "ml", dimension: "volume", toBase: { numerator: one, denominator: one }, nameEn: "Millilitre", nameAr: "مليلتر", defaultDecimalPlaces: 0 },
  { code: "cl", dimension: "volume", toBase: { numerator: BigInt(10), denominator: one }, nameEn: "Centilitre", nameAr: "سنتيلتر", defaultDecimalPlaces: 1 },
  { code: "l", dimension: "volume", toBase: { numerator: BigInt(1000), denominator: one }, nameEn: "Litre", nameAr: "لتر", defaultDecimalPlaces: 3 },
  { code: "piece", dimension: "count", toBase: { numerator: one, denominator: one }, nameEn: "Piece", nameAr: "قطعة", defaultDecimalPlaces: 0 },
];

export const STANDARD_UNIT_CODES: readonly StandardUnitCode[] = STANDARD_UNITS.map((unit) => unit.code);

export function standardUnit(code: string | null | undefined): StandardUnitDefinition | null {
  if (!code) {
    return null;
  }
  return STANDARD_UNITS.find((unit) => unit.code === code) ?? null;
}

export function isQuantityKind(value: unknown): value is QuantityKind {
  return typeof value === "string" && (QUANTITY_KINDS as readonly string[]).includes(value);
}
