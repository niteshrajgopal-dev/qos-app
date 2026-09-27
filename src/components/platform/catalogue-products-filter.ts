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
  products: ProductSummary[],
  activeTab: string,
  searchQuery: string,
): FilteredProducts {
  const filteredByTab =
    activeTab === "all"
      ? products
      : products.filter((p) => p.status === activeTab);

  const filteredBySearch = searchQuery
    ? filteredByTab.filter(
        (p) =>
          p.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.internalName.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : filteredByTab;

  const counts = {
    all: products.length,
    active: products.filter((p) => p.status === "active").length,
    draft: products.filter((p) => p.status === "draft").length,
    archived: products.filter((p) => p.status === "archived").length,
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
