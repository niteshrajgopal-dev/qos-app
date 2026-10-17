import type { StaffLocale } from "@/lib/staff/locale";

export type CatalogueProductEditorStatus = "draft" | "active" | "archived" | null;

const COPY = {
  en: {
    pageTitleDraft: "Edit draft product",
    pageTitleActive: "Edit active product",
    pageTitleArchived: "View archived product",
    loadProduct: "Load product",
    reloadProduct: "Reload product",
    loadPromptDraft: "Load the draft product to begin editing.",
    loadPromptActive: "Load the product to begin editing.",
    loadPromptArchived: "Load the archived product to view its details.",
    saveDraft: "Save draft",
    saveActive: "Save changes",
    saving: "Saving…",
    restoreToDraft: "Restore to draft",
    restoring: "Restoring…",
    restoreSuccess: "Product restored to draft.",
  },
  ar: {
    pageTitleDraft: "تعديل منتج مسود",
    pageTitleActive: "تعديل منتج نشط",
    pageTitleArchived: "عرض منتج مؤرشف",
    loadProduct: "تحميل المنتج",
    reloadProduct: "إعادة تحميل المنتج",
    loadPromptDraft: "حمّل منتج المسودة لبدء التعديل.",
    loadPromptActive: "حمّل المنتج لبدء التعديل.",
    loadPromptArchived: "حمّل المنتج المؤرشف لعرض التفاصيل.",
    saveDraft: "حفظ المسودة",
    saveActive: "حفظ التغييرات",
    saving: "جاري الحفظ…",
    restoreToDraft: "استعادة كمسودة",
    restoring: "جاري الاستعادة…",
    restoreSuccess: "تمت استعادة المنتج كمسودة.",
  },
} as const;

export function productEditorPageTitle(
  status: CatalogueProductEditorStatus,
  locale: StaffLocale,
): string {
  if (status === "active") {
    return COPY[locale].pageTitleActive;
  }
  if (status === "archived") {
    return COPY[locale].pageTitleArchived;
  }
  return COPY[locale].pageTitleDraft;
}

export function productEditorLoadPrompt(
  status: CatalogueProductEditorStatus,
  locale: StaffLocale,
): string {
  if (status === "active") {
    return COPY[locale].loadPromptActive;
  }
  if (status === "archived") {
    return COPY[locale].loadPromptArchived;
  }
  return COPY[locale].loadPromptDraft;
}

export function productEditorLoadButtonLabel(
  locale: StaffLocale,
  reloading: boolean,
): string {
  return reloading ? COPY[locale].reloadProduct : COPY[locale].loadProduct;
}

export function productEditorSaveLabel(
  status: CatalogueProductEditorStatus,
  locale: StaffLocale,
  saving: boolean,
): string {
  if (saving) {
    return COPY[locale].saving;
  }
  if (status === "active") {
    return COPY[locale].saveActive;
  }
  return COPY[locale].saveDraft;
}

export function productEditorIsReadOnly(
  status: CatalogueProductEditorStatus,
): boolean {
  return status === "archived";
}

export function productEditorRestoreLabel(
  locale: StaffLocale,
  restoring: boolean,
): string {
  return restoring ? COPY[locale].restoring : COPY[locale].restoreToDraft;
}

export function productEditorRestoreSuccessNotice(locale: StaffLocale): string {
  return COPY[locale].restoreSuccess;
}
