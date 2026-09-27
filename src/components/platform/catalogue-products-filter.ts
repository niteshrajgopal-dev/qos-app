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

export function formatSubtitle(
  count: number,
  activeTab: string,
  hasSearchQuery: boolean,
): string {
  if (hasSearchQuery) {
    return count === 1 ? "1 product matches" : `${count} products match`;
  }

  switch (activeTab) {
    case "all":
      return count === 1 ? "1 product" : `${count} products`;
    case "active":
      return count === 1 ? "1 active" : `${count} active`;
    case "draft":
      return count === 1 ? "1 draft" : `${count} drafts`;
    case "archived":
      return count === 1 ? "1 archived" : `${count} archived`;
    default:
      return count === 1 ? "1 product" : `${count} products`;
  }
}
