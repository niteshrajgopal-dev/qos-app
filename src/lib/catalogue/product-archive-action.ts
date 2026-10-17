export type CatalogueProductLifecycleStatus =
  | "draft"
  | "active"
  | "archived"
  | string;

export function shouldShowArchiveDraftProductAction(
  status: CatalogueProductLifecycleStatus,
  isAdministrator: boolean,
): boolean {
  return status === "draft" && isAdministrator;
}
