export const CATALOGUE_PRODUCT_ARCHIVED_MUTATION_CODE = "product_archived";

export const CATALOGUE_PRODUCT_ARCHIVED_MESSAGE =
  "Archived products cannot be edited.";

export function isArchivedCatalogueProduct(status: string): boolean {
  return status === "archived";
}
