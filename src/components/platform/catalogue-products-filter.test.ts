import { describe, expect, it } from "vitest";

import { staffProductsListSubtitle } from "@/lib/staff/locale";

import {
  filterProducts,
  paginateProducts,
} from "./catalogue-products-filter";

import type { ProductSummary } from "./catalogue-products-list";

const mockActiveProducts: ProductSummary[] = [
  {
    publicId: "prd_1",
    internalName: "flat-white",
    displayName: "Flat White",
    status: "active",
    thumbnailPublicId: null,
  },
  {
    publicId: "prd_2",
    internalName: "latte",
    displayName: "Latte",
    status: "draft",
    thumbnailPublicId: null,
  },
  {
    publicId: "prd_3",
    internalName: "cortado",
    displayName: "Cortado",
    status: "active",
    thumbnailPublicId: null,
  },
  {
    publicId: "prd_5",
    internalName: "demo-latte",
    displayName: "Demo Latte",
    status: "draft",
    thumbnailPublicId: null,
  },
];

const mockArchivedProducts: ProductSummary[] = [
  {
    publicId: "prd_4",
    internalName: "cold-brew",
    displayName: "Cold Brew",
    status: "archived",
    thumbnailPublicId: null,
  },
];

function filter(
  activeTab: string,
  searchQuery: string,
) {
  return filterProducts(
    mockActiveProducts,
    mockArchivedProducts,
    activeTab,
    searchQuery,
  );
}

describe("filterProducts", () => {
  it("returns active catalogue products when tab is 'all' and no search query", () => {
    const result = filter("all", "");
    expect(result.filtered).toHaveLength(4);
    expect(result.counts.all).toBe(4);
    expect(result.counts.active).toBe(2);
    expect(result.counts.draft).toBe(2);
    expect(result.counts.archived).toBe(1);
  });

  it("filters by draft status when tab is 'draft'", () => {
    const result = filter("draft", "");
    expect(result.filtered).toHaveLength(2);
    expect(result.filtered.every((p) => p.status === "draft")).toBe(true);
    expect(result.filtered.map((p) => p.displayName)).toEqual([
      "Latte",
      "Demo Latte",
    ]);
  });

  it("filters by active status when tab is 'active'", () => {
    const result = filter("active", "");
    expect(result.filtered).toHaveLength(2);
    expect(result.filtered.every((p) => p.status === "active")).toBe(true);
  });

  it("filters by archived status when tab is 'archived'", () => {
    const result = filter("archived", "");
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].displayName).toBe("Cold Brew");
  });

  it("filters by search query on displayName (case-insensitive)", () => {
    const result = filter("all", "latte");
    expect(result.filtered).toHaveLength(2);
    expect(result.filtered.map((p) => p.displayName)).toEqual([
      "Latte",
      "Demo Latte",
    ]);
  });

  it("filters archived products by search query on internalName", () => {
    const result = filter("archived", "brew");
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].displayName).toBe("Cold Brew");
  });

  it("combines tab and search filters", () => {
    const result = filter("draft", "latte");
    expect(result.filtered).toHaveLength(2);
    expect(result.filtered.every((p) => p.status === "draft")).toBe(true);
    expect(
      result.filtered.every(
        (p) =>
          p.displayName.toLowerCase().includes("latte") ||
          p.internalName.toLowerCase().includes("latte"),
      ),
    ).toBe(true);
  });

  it("returns empty array when search matches nothing", () => {
    const result = filter("all", "nonexistent");
    expect(result.filtered).toHaveLength(0);
  });

  it("returns correct counts regardless of filters", () => {
    const result = filter("draft", "latte");
    expect(result.counts.all).toBe(4);
    expect(result.counts.active).toBe(2);
    expect(result.counts.draft).toBe(2);
    expect(result.counts.archived).toBe(1);
  });
});

describe("paginateProducts", () => {
  it("returns first page of products", () => {
    const result = paginateProducts(mockActiveProducts, 1, 2);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.displayName)).toEqual(["Flat White", "Latte"]);
  });

  it("returns second page of products", () => {
    const result = paginateProducts(mockActiveProducts, 2, 2);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.displayName)).toEqual(["Cortado", "Demo Latte"]);
  });

  it("returns partial last page", () => {
    const result = paginateProducts(mockArchivedProducts, 2, 1);
    expect(result).toHaveLength(0);
  });

  it("returns empty array for out-of-range page", () => {
    const result = paginateProducts(mockActiveProducts, 10, 2);
    expect(result).toHaveLength(0);
  });
});

describe("staffProductsListSubtitle", () => {
  it("formats all tab without search", () => {
    expect(staffProductsListSubtitle("en", 1, "all", false)).toBe("1 product");
    expect(staffProductsListSubtitle("en", 5, "all", false)).toBe("5 products");
  });

  it("formats active tab", () => {
    expect(staffProductsListSubtitle("en", 1, "active", false)).toBe("1 active");
    expect(staffProductsListSubtitle("en", 5, "active", false)).toBe("5 active");
  });

  it("formats draft tab", () => {
    expect(staffProductsListSubtitle("en", 1, "draft", false)).toBe("1 draft");
    expect(staffProductsListSubtitle("en", 5, "draft", false)).toBe("5 drafts");
  });

  describe("Archived tab", () => {
    it("formats archived singular", () => {
      expect(staffProductsListSubtitle("en", 1, "archived", false)).toBe(
        "1 archived",
      );
    });

    it("formats archived plural", () => {
      expect(staffProductsListSubtitle("en", 5, "archived", false)).toBe(
        "5 archived",
      );
    });
  });

  it("formats search results", () => {
    expect(staffProductsListSubtitle("en", 1, "all", true)).toBe(
      "1 product matches",
    );
    expect(staffProductsListSubtitle("en", 3, "all", true)).toBe(
      "3 products match",
    );
  });

  it("returns Arabic subtitles for the products list", () => {
    expect(staffProductsListSubtitle("ar", 5, "all", false)).toBe("5 منتجات");
  });
});
