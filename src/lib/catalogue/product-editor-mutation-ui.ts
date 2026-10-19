import {
  productEditorIsReadOnly,
  type CatalogueProductEditorStatus,
} from "@/lib/catalogue/product-editor-copy";

/** True when product-child editor actions (media, AI, location prices, etc.) must not run. */
export function productEditorChildMutationsDisabled(
  productStatus: CatalogueProductEditorStatus,
): boolean {
  return productEditorIsReadOnly(productStatus);
}

/** Draft and active products may clear an attached primary photo; archived may not. */
export function productEditorCanRemovePrimaryPhoto(
  productStatus: CatalogueProductEditorStatus,
): boolean {
  return !productEditorIsReadOnly(productStatus);
}
