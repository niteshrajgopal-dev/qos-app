import type { ItemCostStatus } from "@/lib/inventory/cost-completeness";
import type { ItemSummaryView } from "@/lib/inventory/items";

/* QOS-197 item search and filters. They run on the already loaded list: the
   inventory lists are not paginated and pilot item counts are small. Move to
   server-side filtering when a tenant has around a thousand items. */

export type ItemFilters = {
  query: string;
  kind: "all" | ItemSummaryView["kind"];
  /** "all", "none" (items without a category) or a category public id. */
  category: string;
  status: "all" | ItemSummaryView["status"];
  cost: "all" | ItemCostStatus;
};

export const DEFAULT_ITEM_FILTERS: ItemFilters = { query: "", kind: "all", category: "all", status: "active", cost: "all" };

const normalise = (text: string) => text.normalize("NFKC").toLocaleLowerCase();

/** Case-insensitive substring search over the English and Arabic names, then the select filters. */
export function filterItems<T extends Pick<ItemSummaryView, "nameEn" | "nameAr" | "kind" | "categoryPublicId" | "status" | "costStatus">>(
  items: readonly T[],
  filters: ItemFilters,
): T[] {
  const query = normalise(filters.query.trim());
  return items.filter(
    (item) =>
      (!query || normalise(item.nameEn).includes(query) || normalise(item.nameAr ?? "").includes(query)) &&
      (filters.kind === "all" || item.kind === filters.kind) &&
      (filters.category === "all" ||
        (filters.category === "none" ? item.categoryPublicId === null : item.categoryPublicId === filters.category)) &&
      (filters.status === "all" || item.status === filters.status) &&
      (filters.cost === "all" || item.costStatus === filters.cost),
  );
}
