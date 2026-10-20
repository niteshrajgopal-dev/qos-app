import type { ProductSummary } from "./catalogue-products-list";

export type FilteredProducts = {
  filtered: ProductSummary[];
  counts: {
    all: number;
    active: number;
    draft: number;
    archived: number;
  };
};

export function filterProducts(
  activeProducts: ProductSummary[],
  archivedProducts: ProductSummary[],
  activeTab: string,
  searchQuery: string,
): FilteredProducts {
  const filteredByTab =
    activeTab === "archived"
      ? archivedProducts
      : activeTab === "all"
        ? activeProducts
        : activeProducts.filter((p) => p.status === activeTab);

  const filteredBySearch = searchQuery
    ? filteredByTab.filter(
        (p) =>
          p.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.internalName.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : filteredByTab;

  const counts = {
    all: activeProducts.length,
    active: activeProducts.filter((p) => p.status === "active").length,
    draft: activeProducts.filter((p) => p.status === "draft").length,
    archived: archivedProducts.length,
  };

  return {
    filtered: filteredBySearch,
    counts,
  };
}

export function paginateProducts(
  products: ProductSummary[],
  page: number,
  pageSize: number,
): ProductSummary[] {
  const start = (page - 1) * pageSize;
  return products.slice(start, start + pageSize);
}

