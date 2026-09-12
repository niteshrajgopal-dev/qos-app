import type { ProductLocale } from "@/lib/catalogue/validation";

export type MenuTranslationInput = {
  displayName: string;
  description?: string | null;
};

export type MenuSectionProductInput = {
  productPublicId: string;
  sortOrder: number;
  archived?: boolean;
};

export type MenuSectionInput = {
  publicId?: string;
  internalName: string;
  sortOrder: number;
  archived?: boolean;
  translations: Record<ProductLocale, MenuTranslationInput>;
  products: MenuSectionProductInput[];
};

export type CreateDraftMenuInput = {
  internalName: string;
  brandPublicId?: string;
  locationIds: string[];
  translations: Record<ProductLocale, MenuTranslationInput>;
  sections?: MenuSectionInput[];
};

export type UpdateDraftMenuInput = {
  expectedVersion: number;
  internalName?: string;
  locationIds?: string[];
  translations?: Partial<
    Record<
      ProductLocale,
      Partial<MenuTranslationInput> & {
        expectedTranslationVersion?: number;
      }
    >
  >;
  sections?: MenuSectionInput[];
};

export class MenuValidationError extends Error {
  readonly field?: string;

  constructor(message: string, field?: string) {
    super(message);
    this.name = "MenuValidationError";
    this.field = field;
  }
}

function assertNonEmpty(value: string | undefined, field: string) {
  if (!value?.trim()) {
    throw new MenuValidationError(`${field} is required.`, field);
  }
}

function validateMenuTranslation(
  locale: ProductLocale,
  translation: MenuTranslationInput,
) {
  assertNonEmpty(translation.displayName, `translations.${locale}.displayName`);
}

function validateSection(section: MenuSectionInput, index: number) {
  assertNonEmpty(section.internalName, `sections[${index}].internalName`);

  if (!section.translations?.en || !section.translations?.ar) {
    throw new MenuValidationError(
      `Section ${index + 1} requires English and Arabic labels.`,
      `sections[${index}].translations`,
    );
  }

  validateMenuTranslation("en", section.translations.en);
  validateMenuTranslation("ar", section.translations.ar);

  for (const [productIndex, product] of section.products.entries()) {
    assertNonEmpty(
      product.productPublicId,
      `sections[${index}].products[${productIndex}].productPublicId`,
    );

    if (!Number.isInteger(product.sortOrder)) {
      throw new MenuValidationError(
        "Product sort order must be an integer.",
        `sections[${index}].products[${productIndex}].sortOrder`,
      );
    }
  }
}

export function validateCreateDraftMenuInput(input: CreateDraftMenuInput) {
  assertNonEmpty(input.internalName, "internalName");

  if (!input.translations?.en || !input.translations?.ar) {
    throw new MenuValidationError(
      "English and Arabic menu labels are required.",
      "translations",
    );
  }

  validateMenuTranslation("en", input.translations.en);
  validateMenuTranslation("ar", input.translations.ar);

  if (!Array.isArray(input.locationIds) || input.locationIds.length === 0) {
    throw new MenuValidationError(
      "At least one authorized location is required.",
      "locationIds",
    );
  }

  const sections = input.sections ?? [];
  sections.forEach((section, index) => validateSection(section, index));

  return {
    internalName: input.internalName.trim(),
    brandPublicId: input.brandPublicId?.trim() || null,
    locationIds: input.locationIds.map((id) => id.trim()),
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
    sections,
  };
}

export function validateUpdateDraftMenuInput(input: UpdateDraftMenuInput) {
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw new MenuValidationError(
      "expectedVersion must be a positive integer.",
      "expectedVersion",
    );
  }

  if (input.internalName != null) {
    assertNonEmpty(input.internalName, "internalName");
  }

  if (input.locationIds != null && input.locationIds.length === 0) {
    throw new MenuValidationError(
      "At least one authorized location is required.",
      "locationIds",
    );
  }

  if (input.sections != null) {
    input.sections.forEach((section, index) => validateSection(section, index));
  }

  return input;
}
