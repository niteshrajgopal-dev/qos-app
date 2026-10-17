import { productEditorIsReadOnly } from "@/lib/catalogue/product-editor-copy";
import type { CatalogueProductEditorStatus } from "@/lib/catalogue/product-editor-copy";

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
