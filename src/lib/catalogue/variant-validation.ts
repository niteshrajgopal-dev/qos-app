import type { ProductLocale } from "@/lib/catalogue/validation";
import { CatalogueValidationError } from "@/lib/catalogue/validation";

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

  return {
    expectedProductVersion: input.expectedProductVersion,
    publicId,
    sortOrder: input.sortOrder,
    isDefault: input.isDefault ?? false,
    sku: normalizeOptionalIdentifier(input.sku),
    barcode: normalizeOptionalIdentifier(input.barcode),
    amountMinor: validatePriceAmount(input.amountMinor),
    currency,
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
