export type ProductLocale = "en" | "ar";

export type ProductTranslationInput = {
  displayName: string;
  description?: string | null;
};

export type CreateDraftProductInput = {
  internalName: string;
  brandPublicId?: string;
  sku?: string | null;
  barcode?: string | null;
  primaryMediaAssetId?: string | null;
  nutritionCalories?: number | null;
  translations: Record<ProductLocale, ProductTranslationInput>;
  defaultVariant: {
    amountMinor: number;
    currency?: string;
  };
};

export type UpdateDraftProductInput = {
  expectedVersion: number;
  internalName?: string;
  sku?: string | null;
  barcode?: string | null;
  primaryMediaAssetId?: string | null;
  nutritionCalories?: number | null;
  translations?: Partial<
    Record<
      ProductLocale,
      Partial<ProductTranslationInput> & {
        expectedTranslationVersion?: number;
      }
    >
  >;
  defaultVariant?: {
    amountMinor: number;
  };
};

export class CatalogueValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "CatalogueValidationError";
    this.field = field;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertNonEmpty(value: string | undefined, field: string) {
  if (!value?.trim()) {
    throw new CatalogueValidationError(`${field} is required.`, field);
  }
}

function assertOptionalUuid(value: string | null | undefined, field: string) {
  if (value == null || value === "") {
    return null;
  }

  const trimmed = value.trim();
  if (!UUID_PATTERN.test(trimmed)) {
    throw new CatalogueValidationError(`${field} must be a valid UUID.`, field);
  }

  return trimmed;
}

function validateTranslation(
  locale: ProductLocale,
  translation: ProductTranslationInput,
) {
  assertNonEmpty(translation.displayName, `translations.${locale}.displayName`);
}

function validatePrice(amountMinor: number, field = "defaultVariant.amountMinor") {
  if (!Number.isInteger(amountMinor)) {
    throw new CatalogueValidationError(
      "Price must be a whole number of minor currency units.",
      field,
    );
  }

  if (amountMinor < 0) {
    throw new CatalogueValidationError("Price cannot be negative.", field);
  }
}

function validateNutritionCalories(
  value: number | null | undefined,
  businessProfile: "hospitality" | "generic_retail",
) {
  if (value == null) {
    return null;
  }

  if (businessProfile !== "hospitality") {
    throw new CatalogueValidationError(
      "Nutrition fields are only available for hospitality businesses.",
      "nutritionCalories",
    );
  }

  if (!Number.isInteger(value)) {
    throw new CatalogueValidationError(
      "Calories must be a whole number.",
      "nutritionCalories",
    );
  }

  if (value < 0) {
    throw new CatalogueValidationError(
      "Calories cannot be negative.",
      "nutritionCalories",
    );
  }

  return value;
}

export function validateCreateDraftProductInput(
  input: CreateDraftProductInput,
  businessProfile: "hospitality" | "generic_retail",
) {
  assertNonEmpty(input.internalName, "internalName");

  if (!input.translations?.en || !input.translations?.ar) {
    throw new CatalogueValidationError(
      "English and Arabic translations are required.",
      "translations",
    );
  }

  validateTranslation("en", input.translations.en);
  validateTranslation("ar", input.translations.ar);

  if (input.defaultVariant == null) {
    throw new CatalogueValidationError(
      "A default variant price is required.",
      "defaultVariant.amountMinor",
    );
  }

  validatePrice(input.defaultVariant.amountMinor);

  const currency = input.defaultVariant.currency?.trim().toUpperCase() ?? "AED";
  if (currency.length !== 3) {
    throw new CatalogueValidationError(
      "Currency must be a 3-letter code.",
      "defaultVariant.currency",
    );
  }

  const nutritionCalories = validateNutritionCalories(
    input.nutritionCalories,
    businessProfile,
  );

  return {
    internalName: input.internalName.trim(),
    brandPublicId: input.brandPublicId?.trim() || null,
    sku: input.sku?.trim() || null,
    barcode: input.barcode?.trim() || null,
    primaryMediaAssetId: assertOptionalUuid(
      input.primaryMediaAssetId,
      "primaryMediaAssetId",
    ),
    nutritionCalories,
    translations: {
      en: {
        displayName: input.translations.en.displayName.trim(),
        description: input.translations.en.description?.trim() || null,
      },
      ar: {
        displayName: input.translations.ar.displayName.trim(),
        description: input.translations.ar.description?.trim() || null,
      },
    },
    defaultVariant: {
      amountMinor: input.defaultVariant.amountMinor,
      currency,
    },
  };
}

export function validateUpdateDraftProductInput(
  input: UpdateDraftProductInput,
  businessProfile: "hospitality" | "generic_retail",
) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new CatalogueValidationError(
      "expectedVersion must be a positive integer.",
      "expectedVersion",
    );
  }

  if (input.internalName != null) {
    assertNonEmpty(input.internalName, "internalName");
  }

  if (input.defaultVariant != null) {
    validatePrice(input.defaultVariant.amountMinor);
  }

  const nutritionCalories =
    input.nutritionCalories === undefined
      ? undefined
      : validateNutritionCalories(input.nutritionCalories, businessProfile);

  const translations = input.translations ?? {};
  for (const locale of ["en", "ar"] as const) {
    const translation = translations[locale];
    if (!translation) {
      continue;
    }

    if (translation.displayName != null) {
      assertNonEmpty(translation.displayName, `translations.${locale}.displayName`);
    }

    if (
      translation.expectedTranslationVersion != null &&
      (!Number.isInteger(translation.expectedTranslationVersion) ||
        translation.expectedTranslationVersion < 1)
    ) {
      throw new CatalogueValidationError(
        `translations.${locale}.expectedTranslationVersion must be a positive integer.`,
        `translations.${locale}.expectedTranslationVersion`,
      );
    }
  }

  return {
    expectedVersion: input.expectedVersion,
    internalName: input.internalName?.trim(),
    sku: input.sku === undefined ? undefined : input.sku?.trim() || null,
    barcode: input.barcode === undefined ? undefined : input.barcode?.trim() || null,
    primaryMediaAssetId:
      input.primaryMediaAssetId === undefined
        ? undefined
        : assertOptionalUuid(input.primaryMediaAssetId, "primaryMediaAssetId"),
    nutritionCalories,
    translations,
    defaultVariant: input.defaultVariant,
  };
}
