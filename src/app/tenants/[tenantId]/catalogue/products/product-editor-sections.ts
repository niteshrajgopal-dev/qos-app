import type { StaffUiCopyKey } from "@/lib/staff/locale";

export const PRODUCT_EDITOR_SECTION_IDS = [
  "identity",
  "english",
  "arabic",
  "pricing",
  "media",
  "variants",
  "modifier-groups",
  "status",
] as const;

export type ProductEditorSectionId = (typeof PRODUCT_EDITOR_SECTION_IDS)[number];

export type ProductEditorSectionDefinition = {
  id: ProductEditorSectionId;
  titleKey: StaffUiCopyKey;
  helperKey: StaffUiCopyKey;
  /** Shown only when editing an existing product (not on the new-product flow). */
  editModeOnly?: boolean;
};

export const PRODUCT_EDITOR_SECTIONS: ProductEditorSectionDefinition[] = [
  {
    id: "identity",
    titleKey: "productEditorSectionIdentityTitle",
    helperKey: "productEditorSectionIdentityHelp",
  },
  {
    id: "english",
    titleKey: "productEditorSectionEnglishTitle",
    helperKey: "productEditorSectionEnglishHelp",
  },
  {
    id: "arabic",
    titleKey: "productEditorSectionArabicTitle",
    helperKey: "productEditorSectionArabicHelp",
  },
  {
    id: "pricing",
    titleKey: "productEditorSectionPricingTitle",
    helperKey: "productEditorSectionPricingHelp",
  },
  {
    id: "media",
    titleKey: "productEditorSectionMediaTitle",
    helperKey: "productEditorSectionMediaHelp",
    editModeOnly: true,
  },
  {
    id: "variants",
    titleKey: "productEditorSectionVariantsTitle",
    helperKey: "productEditorSectionVariantsHelp",
    editModeOnly: true,
  },
  {
    id: "modifier-groups",
    titleKey: "productEditorSectionModifierGroupsTitle",
    helperKey: "productEditorSectionModifierGroupsHelp",
    editModeOnly: true,
  },
  {
    id: "status",
    titleKey: "productEditorSectionStatusTitle",
    helperKey: "productEditorSectionStatusHelp",
    editModeOnly: true,
  },
];

export function productEditorSectionsForMode(isEditMode: boolean) {
  return PRODUCT_EDITOR_SECTIONS.filter(
    (section) => !section.editModeOnly || isEditMode,
  );
}

export function productEditorSectionTestId(id: ProductEditorSectionId) {
  return `product-editor-section-${id}`;
}
