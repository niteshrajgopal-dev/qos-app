import { CatalogueValidationError } from "@/lib/catalogue/validation";

/* QOS-214 selling attributes and supplied nutrition metadata.

   Every field is nullable and null always means "unknown" or "undeclared":
   it is never read as false, zero or "sold per piece". These helpers record
   intent only. Nothing here enables fractional checkout, scales, a POS, a
   stock deduction or a recipe; the capability answers below stay false until
   the owning tickets (QOS-198 for stock links) deliver the explicit model. */

export type BusinessProfile = "hospitality" | "generic_retail";

export const SELLING_QUANTITY_BASES = ["each", "weight"] as const;
export type SellingQuantityBasis = (typeof SELLING_QUANTITY_BASES)[number];

export const PRICE_UNITS = ["each", "kg", "g"] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

const MASS_UNITS: ReadonlySet<PriceUnit> = new Set(["kg", "g"]);

export type VariantSellingBasis = {
  sellingQuantityBasis: SellingQuantityBasis | null;
  priceUnit: PriceUnit | null;
  priceUnitQuantity: number | null;
};

export type ProductSellingAttributes = {
  preparationTimeMinutes: number | null;
  walkingTimeMinutes: number | null;
  highSalt: boolean | null;
  directStockIntent: boolean | null;
};

/** Whole minutes, zero allowed. `null` is unknown; `undefined` is "not supplied". */
export function validateWholeMinutes(value: unknown, field: string): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new CatalogueValidationError("Enter a whole number of minutes.", field);
  }
  if (value < 0) {
    throw new CatalogueValidationError("Minutes cannot be negative.", field);
  }
  return value;
}

/** true, false or null (unknown). Strings such as "false" are rejected, never coerced. */
export function validateDeclaredBoolean(value: unknown, field: string): boolean | null {
  if (value === null || typeof value === "boolean") {
    return value;
  }
  throw new CatalogueValidationError("Choose yes, no or unknown.", field);
}

export function assertHospitalityOnly(
  value: unknown,
  businessProfile: BusinessProfile,
  field: string,
) {
  if (value != null && businessProfile !== "hospitality") {
    throw new CatalogueValidationError(
      "Nutrition fields are only available for hospitality businesses.",
      field,
    );
  }
}

/**
 * Validates the product-level fields present on `input`. Omitted keys stay
 * `undefined` (unchanged on update); explicit `null` clears. Walking time and
 * high salt follow the hospitality-only nutrition gate; preparation time and
 * stock-product intent are available to every business profile.
 */
export function validateProductSellingAttributesInput(
  input: Partial<Record<keyof ProductSellingAttributes, unknown>>,
  businessProfile: BusinessProfile,
): Partial<ProductSellingAttributes> {
  const result: Partial<ProductSellingAttributes> = {};

  if (input.preparationTimeMinutes !== undefined) {
    result.preparationTimeMinutes = validateWholeMinutes(
      input.preparationTimeMinutes,
      "preparationTimeMinutes",
    );
  }
  if (input.walkingTimeMinutes !== undefined) {
    assertHospitalityOnly(input.walkingTimeMinutes, businessProfile, "walkingTimeMinutes");
    result.walkingTimeMinutes = validateWholeMinutes(
      input.walkingTimeMinutes,
      "walkingTimeMinutes",
    );
  }
  if (input.highSalt !== undefined) {
    assertHospitalityOnly(input.highSalt, businessProfile, "highSalt");
    result.highSalt = validateDeclaredBoolean(input.highSalt, "highSalt");
  }
  if (input.directStockIntent !== undefined) {
    result.directStockIntent = validateDeclaredBoolean(
      input.directStockIntent,
      "directStockIntent",
    );
  }

  return result;
}

function validateEnumOrNull<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T | null {
  if (value === null) {
    return null;
  }
  if (typeof value === "string" && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  throw new CatalogueValidationError(`${field} must be one of ${allowed.join(", ")}, or null.`, field);
}

function validatePriceUnitQuantity(value: unknown): number | null {
  if (value === null) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new CatalogueValidationError(
      "Price unit quantity must be a positive number.",
      "priceUnitQuantity",
    );
  }
  return value;
}

/** Validates only the supplied variant selling fields (each may be undefined). */
export function validateVariantSellingBasisPatch(
  input: Partial<Record<keyof VariantSellingBasis, unknown>>,
): Partial<VariantSellingBasis> {
  const result: Partial<VariantSellingBasis> = {};
  if (input.sellingQuantityBasis !== undefined) {
    result.sellingQuantityBasis = validateEnumOrNull(
      input.sellingQuantityBasis,
      SELLING_QUANTITY_BASES,
      "sellingQuantityBasis",
    );
  }
  if (input.priceUnit !== undefined) {
    result.priceUnit = validateEnumOrNull(input.priceUnit, PRICE_UNITS, "priceUnit");
  }
  if (input.priceUnitQuantity !== undefined) {
    result.priceUnitQuantity = validatePriceUnitQuantity(input.priceUnitQuantity);
  }
  return result;
}

/**
 * Rejects contradictory combinations on the merged (stored + patch) state:
 * a weight basis priced per piece, or a per-piece basis priced by mass.
 * Partial weight declarations are allowed and stay unresolved.
 */
export function assertVariantSellingBasisConsistent(basis: VariantSellingBasis) {
  if (basis.sellingQuantityBasis === "weight" && basis.priceUnit === "each") {
    throw new CatalogueValidationError(
      "A weight-based variant cannot be priced per piece.",
      "priceUnit",
    );
  }
  if (
    basis.sellingQuantityBasis === "each" &&
    basis.priceUnit != null &&
    MASS_UNITS.has(basis.priceUnit)
  ) {
    throw new CatalogueValidationError(
      "A per-piece variant cannot be priced by kg or g.",
      "priceUnit",
    );
  }
}

export type SellingBasisState = "undeclared" | "each" | "weight_resolved" | "unresolved";

/**
 * `weight_resolved` needs basis weight, a mass unit and a positive quantity.
 * Any other weight or partial declaration is `unresolved`; all-null is
 * `undeclared`, which is not the same as per piece.
 */
export function sellingBasisState(basis: VariantSellingBasis): SellingBasisState {
  const { sellingQuantityBasis, priceUnit, priceUnitQuantity } = basis;
  if (sellingQuantityBasis == null && priceUnit == null && priceUnitQuantity == null) {
    return "undeclared";
  }
  if (sellingQuantityBasis === "each" && (priceUnit == null || priceUnit === "each")) {
    return "each";
  }
  if (
    sellingQuantityBasis === "weight" &&
    priceUnit != null &&
    MASS_UNITS.has(priceUnit) &&
    priceUnitQuantity != null &&
    priceUnitQuantity > 0
  ) {
    return "weight_resolved";
  }
  return "unresolved";
}

export function isWeightBasisUnresolved(basis: VariantSellingBasis) {
  return sellingBasisState(basis) === "unresolved";
}

/**
 * Recording a weight basis never changes checkout: QOS has no fractional
 * quantity, scale or POS path. Always false in this release.
 */
export function sellingBasisEnablesFractionalCheckout(basis?: VariantSellingBasis): false {
  void basis;
  return false;
}

export type DirectStockMappingState = "unknown" | "not_stock_product" | "unresolved";

/**
 * `unresolved` when the operator recorded stock-product intent: consumption
 * needs QOS-198's explicit item + quantity + unit link, which does not exist.
 */
export function directStockMappingState(directStockIntent: boolean | null): DirectStockMappingState {
  if (directStockIntent === true) return "unresolved";
  if (directStockIntent === false) return "not_stock_product";
  return "unknown";
}

/**
 * Whether selling this product may consume stock directly. Always false: an
 * intent flag is not an inventory item, quantity or unit, and QOS never
 * fabricates a recipe or deduction from it.
 */
export function directStockConsumptionEligible(product: { directStockIntent: boolean | null }): false {
  void product;
  return false;
}

export type VariantSellingBasisView = VariantSellingBasis & {
  sellingBasisState: SellingBasisState;
};

/** Maps stored variant columns (CHECK-constrained text) to the typed view. */
export function variantSellingBasisFromRow(row: {
  sellingQuantityBasis: string | null;
  priceUnit: string | null;
  priceUnitQuantity: number | string | null;
}): VariantSellingBasisView {
  const basis: VariantSellingBasis = {
    sellingQuantityBasis: (row.sellingQuantityBasis as SellingQuantityBasis | null) ?? null,
    priceUnit: (row.priceUnit as PriceUnit | null) ?? null,
    priceUnitQuantity: row.priceUnitQuantity == null ? null : Number(row.priceUnitQuantity),
  };
  return { ...basis, sellingBasisState: sellingBasisState(basis) };
}
