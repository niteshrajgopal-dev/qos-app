import type { ProductLocale } from "@/lib/catalogue/validation";
import { CatalogueValidationError } from "@/lib/catalogue/validation";

export type ModifierTranslationInput = {
  displayName?: string;
};

export type CreateModifierGroupInput = {
  internalName: string;
  publicId?: string;
  minSelections?: number;
  maxSelections?: number;
  translations: Record<ProductLocale, { displayName: string }>;
};

export type UpdateModifierGroupInput = {
  expectedVersion: number;
  internalName?: string;
  minSelections?: number;
  maxSelections?: number;
  status?: "active" | "archived";
  translations?: Partial<Record<ProductLocale, ModifierTranslationInput>>;
};

export type CreateModifierOptionInput = {
  expectedGroupVersion: number;
  publicId?: string;
  sortOrder?: number;
  isDefault?: boolean;
  allowsQuantity?: boolean;
  maxQuantity?: number;
  priceMinor?: number;
  currency?: string;
  translations?: Partial<Record<ProductLocale, ModifierTranslationInput>>;
};

export type UpdateModifierOptionInput = {
  expectedGroupVersion: number;
  sortOrder?: number;
  isDefault?: boolean;
  allowsQuantity?: boolean;
  maxQuantity?: number;
  status?: "active" | "archived";
  priceMinor?: number;
  translations?: Partial<Record<ProductLocale, ModifierTranslationInput>>;
};

export type ReorderModifierOptionsInput = {
  expectedGroupVersion: number;
  orderedPublicIds: string[];
};

export type AttachModifierGroupInput = {
  expectedProductVersion: number;
  modifierGroupPublicId: string;
  sortOrder?: number;
};

export type ReorderProductModifierGroupsInput = {
  expectedProductVersion: number;
  orderedPublicIds: string[];
};

function validateSelectionBounds(
  minSelections: number,
  maxSelections: number,
) {
  if (!Number.isInteger(minSelections) || minSelections < 0) {
    throw new CatalogueValidationError(
      "minSelections must be a non-negative integer.",
      "minSelections",
    );
  }

  if (!Number.isInteger(maxSelections) || maxSelections < 0) {
    throw new CatalogueValidationError(
      "maxSelections must be a non-negative integer.",
      "maxSelections",
    );
  }

  if (minSelections > maxSelections) {
    throw new CatalogueValidationError(
      "minSelections cannot exceed maxSelections.",
      "minSelections",
    );
  }
}

function validatePriceMinor(amountMinor: number, field = "priceMinor") {
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

function validateGroupVersion(expectedVersion: number) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new CatalogueValidationError(
      "expectedGroupVersion must be a positive integer.",
      "expectedGroupVersion",
    );
  }
}

function validateProductVersion(expectedProductVersion: number) {
  if (!Number.isInteger(expectedProductVersion) || expectedProductVersion < 1) {
    throw new CatalogueValidationError(
      "expectedProductVersion must be a positive integer.",
      "expectedProductVersion",
    );
  }
}

function normalizeTranslations(
  translations:
    | Partial<Record<ProductLocale, ModifierTranslationInput>>
    | Record<ProductLocale, { displayName: string }>
    | undefined,
  requireBoth = false,
) {
  const normalized: Partial<Record<ProductLocale, { displayName: string }>> = {};

  for (const locale of ["en", "ar"] as const) {
    const translation = translations?.[locale];
    const displayName = translation?.displayName?.trim() ?? "";

    if (requireBoth && !displayName) {
      throw new CatalogueValidationError(
        `${locale.toUpperCase()} display name is required.`,
        `translations.${locale}.displayName`,
      );
    }

    if (translation) {
      normalized[locale] = { displayName };
    }
  }

  return normalized;
}

export function validateCreateModifierGroupInput(input: CreateModifierGroupInput) {
  const internalName = input.internalName?.trim();
  if (!internalName) {
    throw new CatalogueValidationError("internalName is required.", "internalName");
  }

  const minSelections = input.minSelections ?? 0;
  const maxSelections = input.maxSelections ?? 1;
  validateSelectionBounds(minSelections, maxSelections);

  const publicId = input.publicId?.trim() || null;
  if (publicId != null && !/^modgrp_[a-z0-9_]+$/.test(publicId)) {
    throw new CatalogueValidationError(
      "publicId must use the modgrp_ prefix with lowercase letters, numbers, or underscores.",
      "publicId",
    );
  }

  return {
    internalName,
    publicId,
    minSelections,
    maxSelections,
    translations: normalizeTranslations(input.translations, true) as Record<
      ProductLocale,
      { displayName: string }
    >,
  };
}

export function validateUpdateModifierGroupInput(input: UpdateModifierGroupInput) {
  validateGroupVersion(input.expectedVersion);

  if (input.internalName != null && !input.internalName.trim()) {
    throw new CatalogueValidationError("internalName cannot be empty.", "internalName");
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

  if (input.minSelections != null || input.maxSelections != null) {
    validateSelectionBounds(
      input.minSelections ?? 0,
      input.maxSelections ?? 1,
    );
  }

  return {
    expectedVersion: input.expectedVersion,
    internalName: input.internalName?.trim(),
    minSelections: input.minSelections,
    maxSelections: input.maxSelections,
    status: input.status,
    translations: normalizeTranslations(input.translations),
  };
}

export function validateCreateModifierOptionInput(
  input: CreateModifierOptionInput,
) {
  validateGroupVersion(input.expectedGroupVersion);

  if (
    input.sortOrder != null &&
    (!Number.isInteger(input.sortOrder) || input.sortOrder < 0)
  ) {
    throw new CatalogueValidationError(
      "sortOrder must be a non-negative integer.",
      "sortOrder",
    );
  }

  const maxQuantity = input.maxQuantity ?? 1;
  if (!Number.isInteger(maxQuantity) || maxQuantity < 1) {
    throw new CatalogueValidationError(
      "maxQuantity must be a positive integer.",
      "maxQuantity",
    );
  }

  const priceMinor = input.priceMinor ?? 0;
  validatePriceMinor(priceMinor);

  const currency = input.currency?.trim().toUpperCase() ?? "AED";
  if (currency.length !== 3) {
    throw new CatalogueValidationError(
      "Currency must be a 3-letter code.",
      "currency",
    );
  }

  const publicId = input.publicId?.trim() || null;
  if (publicId != null && !/^modopt_[a-z0-9_]+$/.test(publicId)) {
    throw new CatalogueValidationError(
      "publicId must use the modopt_ prefix with lowercase letters, numbers, or underscores.",
      "publicId",
    );
  }

  return {
    expectedGroupVersion: input.expectedGroupVersion,
    publicId,
    sortOrder: input.sortOrder,
    isDefault: input.isDefault ?? false,
    allowsQuantity: input.allowsQuantity ?? false,
    maxQuantity,
    priceMinor,
    currency,
    translations: normalizeTranslations(input.translations),
  };
}

export function validateUpdateModifierOptionInput(
  input: UpdateModifierOptionInput,
) {
  validateGroupVersion(input.expectedGroupVersion);

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
    input.maxQuantity != null &&
    (!Number.isInteger(input.maxQuantity) || input.maxQuantity < 1)
  ) {
    throw new CatalogueValidationError(
      "maxQuantity must be a positive integer.",
      "maxQuantity",
    );
  }

  if (input.priceMinor != null) {
    validatePriceMinor(input.priceMinor);
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
    expectedGroupVersion: input.expectedGroupVersion,
    sortOrder: input.sortOrder,
    isDefault: input.isDefault,
    allowsQuantity: input.allowsQuantity,
    maxQuantity: input.maxQuantity,
    status: input.status,
    priceMinor: input.priceMinor,
    translations: normalizeTranslations(input.translations),
  };
}

export function validateReorderModifierOptionsInput(
  input: ReorderModifierOptionsInput,
) {
  validateGroupVersion(input.expectedGroupVersion);

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
    expectedGroupVersion: input.expectedGroupVersion,
    orderedPublicIds,
  };
}

export function validateAttachModifierGroupInput(input: AttachModifierGroupInput) {
  validateProductVersion(input.expectedProductVersion);

  const modifierGroupPublicId = input.modifierGroupPublicId?.trim();
  if (!modifierGroupPublicId) {
    throw new CatalogueValidationError(
      "modifierGroupPublicId is required.",
      "modifierGroupPublicId",
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

  return {
    expectedProductVersion: input.expectedProductVersion,
    modifierGroupPublicId,
    sortOrder: input.sortOrder,
  };
}

export function validateReorderProductModifierGroupsInput(
  input: ReorderProductModifierGroupsInput,
) {
  validateProductVersion(input.expectedProductVersion);

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
