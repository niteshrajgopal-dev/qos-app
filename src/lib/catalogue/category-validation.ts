import type { ProductLocale } from "@/lib/catalogue/validation";
import { CatalogueValidationError } from "@/lib/catalogue/validation";

export type CategoryTranslationInput = {
  displayName?: string;
};

export type CreateCategoryInput = {
  internalName: string;
  publicId?: string;
  sortOrder?: number;
  translations: Record<ProductLocale, { displayName: string }>;
};

export type UpdateCategoryInput = {
  expectedVersion: number;
  internalName?: string;
  sortOrder?: number;
  status?: "active" | "archived";
  translations?: Partial<Record<ProductLocale, CategoryTranslationInput>>;
};

export type ReorderCategoriesInput = {
  orderedPublicIds: string[];
};

export type AssignCategoryProductInput = {
  productPublicId: string;
};

function normalizeTranslations(
  translations:
    | Partial<Record<ProductLocale, CategoryTranslationInput>>
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

function validateVersion(expectedVersion: number) {
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new CatalogueValidationError(
      "expectedVersion must be a positive integer.",
      "expectedVersion",
    );
  }
}

export function validateCreateCategoryInput(input: CreateCategoryInput) {
  const internalName = input.internalName?.trim();
  if (!internalName) {
    throw new CatalogueValidationError("internalName is required.", "internalName");
  }

  const publicId = input.publicId?.trim() || null;
  if (publicId != null && !/^cat_[a-z0-9_]+$/.test(publicId)) {
    throw new CatalogueValidationError(
      "publicId must use the cat_ prefix with lowercase letters, numbers, or underscores.",
      "publicId",
    );
  }

  const sortOrder = input.sortOrder ?? 0;
  if (!Number.isInteger(sortOrder) || sortOrder < 0) {
    throw new CatalogueValidationError(
      "sortOrder must be a non-negative integer.",
      "sortOrder",
    );
  }

  return {
    internalName,
    publicId,
    sortOrder,
    translations: normalizeTranslations(input.translations, true) as Record<
      ProductLocale,
      { displayName: string }
    >,
  };
}

export function validateUpdateCategoryInput(input: UpdateCategoryInput) {
  validateVersion(input.expectedVersion);

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

  if (input.sortOrder != null) {
    if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0) {
      throw new CatalogueValidationError(
        "sortOrder must be a non-negative integer.",
        "sortOrder",
      );
    }
  }

  return {
    expectedVersion: input.expectedVersion,
    internalName: input.internalName?.trim(),
    sortOrder: input.sortOrder,
    status: input.status,
    translations: normalizeTranslations(input.translations),
  };
}

export function validateReorderCategoriesInput(input: ReorderCategoriesInput) {
  if (!Array.isArray(input.orderedPublicIds) || input.orderedPublicIds.length === 0) {
    throw new CatalogueValidationError(
      "orderedPublicIds must include at least one category.",
      "orderedPublicIds",
    );
  }

  const orderedPublicIds = input.orderedPublicIds.map((id) => id.trim());
  if (orderedPublicIds.some((id) => !id) || new Set(orderedPublicIds).size !== orderedPublicIds.length) {
    throw new CatalogueValidationError(
      "orderedPublicIds must be unique, non-empty public ids.",
      "orderedPublicIds",
    );
  }

  return { orderedPublicIds };
}

export function validateAssignCategoryProductInput(
  input: AssignCategoryProductInput,
) {
  const productPublicId = input.productPublicId?.trim();
  if (!productPublicId) {
    throw new CatalogueValidationError(
      "productPublicId is required.",
      "productPublicId",
    );
  }

  return { productPublicId };
}
