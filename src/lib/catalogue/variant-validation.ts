import {
  type CostPolicyOperationInput,
  validateCostPolicyOperation,
} from "@/lib/catalogue/reference-cost-policies";
import {
  SELLING_PRICE_TAX_BASES,
  type SellingPriceTaxBasis,
} from "@/lib/catalogue/selling-tax-cost";
import type { ProductLocale } from "@/lib/catalogue/validation";
import { CatalogueValidationError } from "@/lib/catalogue/validation";
import {
  type PriceUnit,
  type SellingQuantityBasis,
  validateVariantSellingBasisPatch,
} from "@/lib/catalogue/selling-attributes";

export type VariantTranslationInput = {
  displayName?: string;
};

export type CreateProductVariantInput = {
  expectedProductVersion: number;
  publicId?: string;
  sortOrder?: number;
  isDefault?: boolean;
  sku?: string | null;
  barcode?: string | null;
  amountMinor?: number | null;
  currency?: string;
  sellingQuantityBasis?: SellingQuantityBasis | null;
  priceUnit?: PriceUnit | null;
  priceUnitQuantity?: number | null;
  /** QOS-215: omit to leave unrecorded; null records nothing. */
  priceTaxBasis?: SellingPriceTaxBasis | null;
  taxRateBasisPoints?: number | null;
  /** QOS-215: explicit cost-policy operation; omitting it changes nothing. */
  costPolicy?: CostPolicyOperationInput;
  translations?: Partial<Record<ProductLocale, VariantTranslationInput>>;
};

export type UpdateProductVariantInput = {
  expectedProductVersion: number;
  sortOrder?: number;
  isDefault?: boolean;
  status?: "active" | "archived";
  sku?: string | null;
  barcode?: string | null;
  amountMinor?: number | null;
  sellingQuantityBasis?: SellingQuantityBasis | null;
  priceUnit?: PriceUnit | null;
  priceUnitQuantity?: number | null;
  /** QOS-215: omit to keep the current value; null clears it. */
  priceTaxBasis?: SellingPriceTaxBasis | null;
  /** QOS-215: integer basis points (500 = 5%); 0 is a real 0% rate. Omit to keep; null clears. */
  taxRateBasisPoints?: number | null;
  /** QOS-215: explicit cost-policy operation; omitting it changes nothing. */
  costPolicy?: CostPolicyOperationInput;
  translations?: Partial<Record<ProductLocale, VariantTranslationInput>>;
};

export type ReorderProductVariantsInput = {
  expectedProductVersion: number;
  orderedPublicIds: string[];
};

function validatePriceAmount(
  amountMinor: number | null | undefined,
  field = "amountMinor",
) {
  if (amountMinor == null) {
    return null;
  }

  if (!Number.isInteger(amountMinor)) {
    throw new CatalogueValidationError(
      "Price must be a whole number of minor currency units.",
      field,
    );
  }

  if (amountMinor < 0) {
    throw new CatalogueValidationError("Price cannot be negative.", field);
  }

  return amountMinor;
}

const MAX_TAX_RATE_BASIS_POINTS = 1_000_000;

/** undefined = unchanged, null = clear, otherwise a stored basis. */
export function validatePriceTaxBasis(
  value: unknown,
): SellingPriceTaxBasis | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (
    typeof value !== "string" ||
    !(SELLING_PRICE_TAX_BASES as readonly string[]).includes(value)
  ) {
    throw new CatalogueValidationError(
      "priceTaxBasis must be inclusive, exclusive, unconfirmed or null.",
      "priceTaxBasis",
    );
  }
  return value as SellingPriceTaxBasis;
}

/** undefined = unchanged, null = clear, 0 = a real 0% rate. */
export function validateTaxRateBasisPoints(
  value: unknown,
): number | null | undefined {
  if (value === undefined || value === null) {
    return value;
  }
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > MAX_TAX_RATE_BASIS_POINTS
  ) {
    throw new CatalogueValidationError(
      "taxRateBasisPoints must be a whole number of basis points (500 = 5%), or null.",
      "taxRateBasisPoints",
    );
  }
  return value;
}

function validateProductVersion(expectedProductVersion: number) {
  if (!Number.isInteger(expectedProductVersion) || expectedProductVersion < 1) {
    throw new CatalogueValidationError(
      "expectedProductVersion must be a positive integer.",
      "expectedProductVersion",
    );
  }
}

function normalizeOptionalIdentifier(value: string | null | undefined) {
  if (value == null) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizeTranslations(
  translations: Partial<Record<ProductLocale, VariantTranslationInput>> | undefined,
) {
  const normalized: Partial<Record<ProductLocale, { displayName: string }>> = {};

  for (const locale of ["en", "ar"] as const) {
    const translation = translations?.[locale];
    if (!translation) {
      continue;
    }

    normalized[locale] = {
      displayName: translation.displayName?.trim() ?? "",
    };
  }

  return normalized;
}

export function validateCreateProductVariantInput(
  input: CreateProductVariantInput,
) {
  validateProductVersion(input.expectedProductVersion);

  const currency = input.currency?.trim().toUpperCase() ?? "AED";
  if (currency.length !== 3) {
    throw new CatalogueValidationError(
      "Currency must be a 3-letter code.",
      "currency",
    );
  }

  if (
    input.sortOrder != null &&
    (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)
  ) {
    throw new CatalogueValidationError(
      "sortOrder must be a non-negative integer.",
      "sortOrder",
    );
  }

  const publicId = input.publicId?.trim() || null;
  if (publicId != null && !/^var_[a-z0-9_]+$/.test(publicId)) {
    throw new CatalogueValidationError(
      "publicId must use the var_ prefix with lowercase letters, numbers, or underscores.",
      "publicId",
    );
  }

  const sellingBasis = validateVariantSellingBasisPatch({
    sellingQuantityBasis: input.sellingQuantityBasis ?? null,
    priceUnit: input.priceUnit ?? null,
    priceUnitQuantity: input.priceUnitQuantity ?? null,
  });

  return {
    expectedProductVersion: input.expectedProductVersion,
    publicId,
    sortOrder: input.sortOrder,
    isDefault: input.isDefault ?? false,
    sku: normalizeOptionalIdentifier(input.sku),
    barcode: normalizeOptionalIdentifier(input.barcode),
    amountMinor: validatePriceAmount(input.amountMinor),
    currency,
    sellingQuantityBasis: sellingBasis.sellingQuantityBasis ?? null,
    priceUnit: sellingBasis.priceUnit ?? null,
    priceUnitQuantity: sellingBasis.priceUnitQuantity ?? null,
    priceTaxBasis: validatePriceTaxBasis(input.priceTaxBasis),
    taxRateBasisPoints: validateTaxRateBasisPoints(input.taxRateBasisPoints),
    costPolicy: validateCostPolicyOperation(input.costPolicy),
    translations: normalizeTranslations(input.translations),
  };
}

export function validateUpdateProductVariantInput(
  input: UpdateProductVariantInput,
) {
  validateProductVersion(input.expectedProductVersion);

  if (
    input.sortOrder != null &&
    (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)
  ) {
    throw new CatalogueValidationError(
      "sortOrder must be a non-negative integer.",
      "sortOrder",
    );
  }

  if (
    input.status != null &&
    input.status !== "active" &&
    input.status !== "archived"
  ) {
    throw new CatalogueValidationError(
      "status must be active or archived.",
      "status",
    );
  }

  return {
    expectedProductVersion: input.expectedProductVersion,
    sortOrder: input.sortOrder,
    isDefault: input.isDefault,
    status: input.status,
    sku:
      input.sku === undefined
        ? undefined
        : normalizeOptionalIdentifier(input.sku),
    barcode:
      input.barcode === undefined
        ? undefined
        : normalizeOptionalIdentifier(input.barcode),
    amountMinor:
      input.amountMinor === undefined
        ? undefined
        : validatePriceAmount(input.amountMinor),
    ...validateVariantSellingBasisPatch({
      sellingQuantityBasis: input.sellingQuantityBasis,
      priceUnit: input.priceUnit,
      priceUnitQuantity: input.priceUnitQuantity,
    }),
    priceTaxBasis: validatePriceTaxBasis(input.priceTaxBasis),
    taxRateBasisPoints: validateTaxRateBasisPoints(input.taxRateBasisPoints),
    costPolicy: validateCostPolicyOperation(input.costPolicy),
    translations: normalizeTranslations(input.translations),
  };
}

export function validateReorderProductVariantsInput(
  input: ReorderProductVariantsInput,
) {
  validateProductVersion(input.expectedProductVersion);

  if (!Array.isArray(input.orderedPublicIds)) {
    throw new CatalogueValidationError(
      "orderedPublicIds must be an array.",
      "orderedPublicIds",
    );
  }

  const orderedPublicIds = input.orderedPublicIds.map((publicId) => {
    const trimmed = publicId.trim();
    if (!trimmed) {
      throw new CatalogueValidationError(
        "orderedPublicIds cannot contain empty values.",
        "orderedPublicIds",
      );
    }

    return trimmed;
  });

  if (new Set(orderedPublicIds).size !== orderedPublicIds.length) {
    throw new CatalogueValidationError(
      "orderedPublicIds cannot contain duplicates.",
      "orderedPublicIds",
    );
  }

  return {
    expectedProductVersion: input.expectedProductVersion,
    orderedPublicIds,
  };
}

export function assertVariantLabelsForMultipleChoices(
  activeVariantCount: number,
  translations: Partial<Record<ProductLocale, { displayName: string }>>,
  fieldPrefix: string,
) {
  if (activeVariantCount <= 1) {
    return;
  }

  for (const locale of ["en", "ar"] as const) {
    const displayName = translations[locale]?.displayName?.trim() ?? "";
    if (!displayName) {
      throw new CatalogueValidationError(
        `${locale.toUpperCase()} variant label is required when a product has multiple choices.`,
        `${fieldPrefix}.translations.${locale}.displayName`,
      );
    }
  }
}

export function assertDistinctVariantLabels(
  labels: Array<{ publicId: string; displayName: string }>,
  locale: ProductLocale,
) {
  const seen = new Map<string, string>();

  for (const label of labels) {
    const normalized = label.displayName.trim().toLowerCase();
    if (!normalized) {
      continue;
    }

    const existing = seen.get(normalized);
    if (existing) {
      throw new CatalogueValidationError(
        `${locale.toUpperCase()} variant labels must be distinguishable.`,
        `translations.${locale}.displayName`,
      );
    }

    seen.set(normalized, label.publicId);
  }
}
