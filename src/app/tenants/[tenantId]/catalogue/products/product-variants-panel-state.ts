import { productEditorIsReadOnly } from "@/lib/catalogue/product-editor-copy";
import type { CatalogueProductEditorStatus } from "@/lib/catalogue/product-editor-copy";
import {
  staffCopyWith,
  staffUiCopy,
  type StaffLocale,
  type StaffUiCopyKey,
} from "@/lib/staff/locale";

export function productVariantsPanelIsProductReadOnly(
  productStatus: CatalogueProductEditorStatus,
): boolean {
  return productEditorIsReadOnly(productStatus);
}

export function productVariantControlDisabled(
  productReadOnly: boolean,
  variantArchived: boolean,
  busy: boolean,
): boolean {
  return productReadOnly || variantArchived || busy;
}

export function productVariantPriceDisabled(
  productReadOnly: boolean,
  variantArchived: boolean,
  busy: boolean,
  canEditPrice: boolean,
): boolean {
  return productVariantControlDisabled(productReadOnly, variantArchived, busy) ||
    !canEditPrice;
}

export function productVariantsPanelShowsAddForm(productReadOnly: boolean): boolean {
  return !productReadOnly;
}

export type ProductVariantLinkKind = "recipe" | "direct_stock" | null;

/** Archive stays hidden for the default variant; the server refuses it too. */
export function productVariantShowsArchive(
  productReadOnly: boolean,
  variant: { status: "active" | "archived"; isDefault: boolean },
): boolean {
  return !productReadOnly && variant.status === "active" && !variant.isDefault;
}

/** Restore is an administrator write on an editable product. */
export function productVariantShowsRestore(
  productReadOnly: boolean,
  variantStatus: "active" | "archived",
  isAdministrator: boolean,
): boolean {
  return !productReadOnly && variantStatus === "archived" && isAdministrator;
}

export function productVariantArchiveConfirmCopy(
  locale: StaffLocale,
  variant: {
    publicId: string;
    sellableLinkKind: ProductVariantLinkKind;
    translations: Record<StaffLocale, { displayName: string }>;
  },
) {
  const name =
    variant.translations[locale].displayName.trim() ||
    variant.translations.en.displayName.trim() ||
    variant.publicId;
  const linkKey: StaffUiCopyKey | null =
    variant.sellableLinkKind === "recipe"
      ? "variantArchiveConfirmRecipeLink"
      : variant.sellableLinkKind === "direct_stock"
        ? "variantArchiveConfirmStockLink"
        : null;
  return {
    title: staffUiCopy(locale, "variantArchiveConfirmTitle"),
    body: staffCopyWith(locale, "variantArchiveConfirmBody", { variant: name }),
    linkNotice: linkKey ? staffUiCopy(locale, linkKey) : null,
    confirmLabel: staffUiCopy(locale, "variantArchive"),
    cancelLabel: staffUiCopy(locale, "cancel"),
  };
}

export type ProductVariantArchiveConfirm = {
  targetPublicId: string | null;
  /** PATCH body to send once confirmed; never set by opening or cancelling. */
  request: { variantPublicId: string; body: { expectedProductVersion: number; status: "archived" } } | null;
};

export type ProductVariantArchiveAction =
  | { type: "open"; variantPublicId: string }
  | { type: "cancel" }
  | { type: "confirm"; productVersion: number };

export function productVariantArchiveConfirmReducer(
  state: ProductVariantArchiveConfirm,
  action: ProductVariantArchiveAction,
): ProductVariantArchiveConfirm {
  switch (action.type) {
    case "open":
      return { targetPublicId: action.variantPublicId, request: null };
    case "cancel":
      return { targetPublicId: null, request: null };
    case "confirm":
      return state.targetPublicId
        ? {
            targetPublicId: null,
            request: {
              variantPublicId: state.targetPublicId,
              body: { expectedProductVersion: action.productVersion, status: "archived" },
            },
          }
        : state;
  }
}
