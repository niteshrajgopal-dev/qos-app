import {
  directStockConsumptionEligible,
  directStockMappingState,
  PRICE_UNITS,
  type PriceUnit,
  SELLING_QUANTITY_BASES,
  type SellingQuantityBasis,
  sellingBasisEnablesFractionalCheckout,
  sellingBasisState,
} from "@/lib/catalogue/selling-attributes";

/* QOS-214 capability contract for the workbook selling attributes, consumed
   by QOS-194 (review) and QOS-200 (apply). It declares what a stored value
   means operationally:

   - persistable: QOS stores the value on an existing record.
   - review_only: QOS stores the intent but must show the operator that the
     operational meaning is unresolved (weight without unit + quantity, or
     stock-product intent without an explicit item/quantity/unit link).
   - deferred: an operation QOS does not perform in this release, whatever
     flags are stored.

   A stored flag never upgrades an operation to supported. This module does
   not apply anything. */

export type SellingAttributeCapabilityClass = "persistable" | "review_only" | "deferred";

export type SellingAttributeCapability = {
  key: string;
  classification: SellingAttributeCapabilityClass;
  sheet?: "Products" | "Variants" | "Modifier Options";
  column?: string;
  target?: string;
  note: string;
};

export const SELLING_ATTRIBUTE_CAPABILITIES: readonly SellingAttributeCapability[] = [
  {
    key: "product.preparation_time_minutes",
    classification: "persistable",
    sheet: "Products",
    column: "preparation_time_minutes",
    target: "catalogue_products.preparation_time_minutes",
    note: "Whole minutes; blank is unknown.",
  },
  {
    key: "product.walking_time_minutes",
    classification: "persistable",
    sheet: "Products",
    column: "walking_time_minutes",
    target: "catalogue_products.walking_time_minutes",
    note: "Whole minutes; hospitality only; never derived from calories.",
  },
  {
    key: "product.high_salt",
    classification: "persistable",
    sheet: "Products",
    column: "high_salt",
    target: "catalogue_products.high_salt",
    note: "TRUE/FALSE; blank is unknown; hospitality only.",
  },
  {
    key: "product.is_stock_product",
    classification: "persistable",
    sheet: "Products",
    column: "is_stock_product",
    target: "catalogue_products.direct_stock_intent",
    note: "Intent only; it is not an inventory link.",
  },
  {
    key: "variant.selling_quantity_basis",
    classification: "persistable",
    sheet: "Variants",
    column: "selling_quantity_basis",
    target: "catalogue_variants.selling_quantity_basis",
    note: "Blank is undeclared, not per piece.",
  },
  {
    key: "variant.price_unit",
    classification: "persistable",
    sheet: "Variants",
    column: "price_unit",
    target: "catalogue_variants.price_unit",
    note: "each, kg or g.",
  },
  {
    key: "variant.price_unit_quantity",
    classification: "persistable",
    sheet: "Variants",
    column: "price_unit_quantity",
    target: "catalogue_variants.price_unit_quantity",
    note: "Positive number.",
  },
  {
    key: "modifier_option.nutrition_calories",
    classification: "persistable",
    sheet: "Modifier Options",
    column: "nutrition_calories",
    target: "catalogue_modifier_options.nutrition_calories",
    note: "Whole kcal; hospitality only.",
  },
  {
    key: "variant.weight_basis_unresolved",
    classification: "review_only",
    sheet: "Variants",
    note: "Weight basis without a kg/g price unit and positive quantity stays unresolved.",
  },
  {
    key: "product.direct_stock_unresolved",
    classification: "review_only",
    sheet: "Products",
    note: "Stock-product intent needs an explicit item + quantity + unit link (QOS-198) before consumption is eligible.",
  },
  { key: "operation.fractional_checkout", classification: "deferred", note: "Checkout quantities stay whole." },
  { key: "operation.scale_integration", classification: "deferred", note: "No scale integration." },
  { key: "operation.pos", classification: "deferred", note: "No POS is enabled by a selling basis." },
  { key: "operation.stock_deduction", classification: "deferred", note: "No stock is deducted from a flag." },
  { key: "operation.recipe_fabrication", classification: "deferred", note: "No recipe is created from a flag." },
];

export function sellingAttributeCapability(key: string) {
  return SELLING_ATTRIBUTE_CAPABILITIES.find((capability) => capability.key === key);
}

/** v1.3 selling-attribute columns are persistable in the catalogue, but workbook apply is QOS-200's. */
export const SELLING_ATTRIBUTE_APPLY_OWNER = "QOS-200 apply";

/** The persistable capability behind a v1.3 contract column, or undefined for any other column. */
export function sellingAttributeColumnCapability(sheet: string, column: string) {
  return SELLING_ATTRIBUTE_CAPABILITIES.find(
    (capability) => capability.classification === "persistable" && capability.sheet === sheet && capability.column === column,
  );
}

export type SellingAttributeDiagnostic = {
  severity: "error" | "warning";
  classification: SellingAttributeCapabilityClass | "invalid";
  code:
    | "invalid_integer"
    | "invalid_boolean"
    | "invalid_value"
    | "invalid_positive_number"
    | "illegal_basis_unit"
    | "weight_basis_unresolved"
    | "direct_stock_unresolved";
  column?: string;
};

type Parsed<T> = { fields: T; diagnostics: SellingAttributeDiagnostic[] };

function parseWholeNumber(raw: string | undefined, column: string, diagnostics: SellingAttributeDiagnostic[]) {
  const value = raw?.trim() ?? "";
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    diagnostics.push({ severity: "error", classification: "invalid", code: "invalid_integer", column });
    return null;
  }
  return Number(value);
}

function parseDeclaredBoolean(raw: string | undefined, column: string, diagnostics: SellingAttributeDiagnostic[]) {
  const value = raw?.trim().toUpperCase() ?? "";
  if (!value) return null;
  if (value === "TRUE") return true;
  if (value === "FALSE") return false;
  diagnostics.push({ severity: "error", classification: "invalid", code: "invalid_boolean", column });
  return null;
}

function parseEnum<T extends string>(
  raw: string | undefined,
  allowed: readonly T[],
  column: string,
  diagnostics: SellingAttributeDiagnostic[],
): T | null {
  const value = raw?.trim().toLowerCase() ?? "";
  if (!value) return null;
  if ((allowed as readonly string[]).includes(value)) return value as T;
  diagnostics.push({ severity: "error", classification: "invalid", code: "invalid_value", column });
  return null;
}

/** Typed product fields from a Products row, plus review diagnostics. Blank stays null. */
export function parseProductSellingAttributes(values: Record<string, string>): Parsed<{
  preparationTimeMinutes: number | null;
  walkingTimeMinutes: number | null;
  highSalt: boolean | null;
  directStockIntent: boolean | null;
}> {
  const diagnostics: SellingAttributeDiagnostic[] = [];
  const fields = {
    preparationTimeMinutes: parseWholeNumber(values.preparation_time_minutes, "preparation_time_minutes", diagnostics),
    walkingTimeMinutes: parseWholeNumber(values.walking_time_minutes, "walking_time_minutes", diagnostics),
    highSalt: parseDeclaredBoolean(values.high_salt, "high_salt", diagnostics),
    directStockIntent: parseDeclaredBoolean(values.is_stock_product, "is_stock_product", diagnostics),
  };
  if (directStockMappingState(fields.directStockIntent) === "unresolved") {
    diagnostics.push({
      severity: "warning",
      classification: "review_only",
      code: "direct_stock_unresolved",
      column: "is_stock_product",
    });
  }
  return { fields, diagnostics };
}

/** Typed variant selling basis from a Variants row, plus review diagnostics. */
export function parseVariantSellingBasis(values: Record<string, string>): Parsed<{
  sellingQuantityBasis: SellingQuantityBasis | null;
  priceUnit: PriceUnit | null;
  priceUnitQuantity: number | null;
}> {
  const diagnostics: SellingAttributeDiagnostic[] = [];
  const sellingQuantityBasis = parseEnum(
    values.selling_quantity_basis,
    SELLING_QUANTITY_BASES,
    "selling_quantity_basis",
    diagnostics,
  );
  const priceUnit = parseEnum(values.price_unit, PRICE_UNITS, "price_unit", diagnostics);
  const rawQuantity = values.price_unit_quantity?.trim() ?? "";
  let priceUnitQuantity: number | null = null;
  if (rawQuantity) {
    const parsed = /^\d+(\.\d+)?$/.test(rawQuantity) ? Number(rawQuantity) : NaN;
    if (Number.isFinite(parsed) && parsed > 0) {
      priceUnitQuantity = parsed;
    } else {
      diagnostics.push({
        severity: "error",
        classification: "invalid",
        code: "invalid_positive_number",
        column: "price_unit_quantity",
      });
    }
  }
  const fields = { sellingQuantityBasis, priceUnit, priceUnitQuantity };

  const illegal =
    (sellingQuantityBasis === "weight" && priceUnit === "each") ||
    (sellingQuantityBasis === "each" && (priceUnit === "kg" || priceUnit === "g"));
  if (illegal) {
    diagnostics.push({ severity: "error", classification: "invalid", code: "illegal_basis_unit", column: "price_unit" });
  } else if (sellingBasisState(fields) === "unresolved") {
    diagnostics.push({
      severity: "warning",
      classification: "review_only",
      code: "weight_basis_unresolved",
      column: "selling_quantity_basis",
    });
  }
  return { fields, diagnostics };
}

/** Typed option calories from a Modifier Options row. */
export function parseModifierOptionNutrition(values: Record<string, string>): Parsed<{ nutritionCalories: number | null }> {
  const diagnostics: SellingAttributeDiagnostic[] = [];
  return {
    fields: { nutritionCalories: parseWholeNumber(values.nutrition_calories, "nutrition_calories", diagnostics) },
    diagnostics,
  };
}

/**
 * Operational answers for one product/variant pair. They stay false whatever
 * is stored; QOS-200 must surface the review_only states instead.
 */
export function sellingAttributeOperationalCapabilities(input: {
  directStockIntent: boolean | null;
  sellingQuantityBasis: SellingQuantityBasis | null;
  priceUnit: PriceUnit | null;
  priceUnitQuantity: number | null;
}) {
  return {
    directStockConsumptionEligible: directStockConsumptionEligible(input),
    fractionalCheckout: sellingBasisEnablesFractionalCheckout(input),
    directStockMapping: directStockMappingState(input.directStockIntent),
    sellingBasis: sellingBasisState(input),
  };
}
