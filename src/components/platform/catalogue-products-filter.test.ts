import { describe, expect, it } from "vitest";

import {
  filterProducts,
  paginateProducts,
} from "./catalogue-products-filter";

import type { ProductSummary } from "./catalogue-products-list";

const mockProducts: ProductSummary[] = [
  {
    publicId: "prd_1",
    internalName: "flat-white",
    displayName: "Flat White",
    status: "active",
  },
  {
    publicId: "prd_2",
    internalName: "latte",
    displayName: "Latte",
    status: "draft",
  },
  {
    publicId: "prd_3",
    internalName: "cortado",
    displayName: "Cortado",
    status: "active",
  },
  {
    publicId: "prd_4",
    internalName: "cold-brew",
    displayName: "Cold Brew",
    status: "archived",
  },
  {
    publicId: "prd_5",
    internalName: "demo-latte",
    displayName: "Demo Latte",
    status: "draft",
  },
];

describe("filterProducts", () => {
  it("returns all products when tab is 'all' and no search query", () => {
    const result = filterProducts(mockProducts, "all", "");
    expect(result.filtered).toHaveLength(5);
    expect(result.counts.all).toBe(5);
    expect(result.counts.active).toBe(2);
    expect(result.counts.draft).toBe(2);
    expect(result.counts.archived).toBe(1);
  });

  it("filters by draft status when tab is 'draft'", () => {
    const result = filterProducts(mockProducts, "draft", "");
    expect(result.filtered).toHaveLength(2);
    expect(result.filtered.every((p) => p.status === "draft")).toBe(true);
    expect(result.filtered.map((p) => p.displayName)).toEqual([
      "Latte",
      "Demo Latte",
    ]);
  });

  it("filters by active status when tab is 'active'", () => {
    const result = filterProducts(mockProducts, "active", "");
    expect(result.filtered).toHaveLength(2);
    expect(result.filtered.every((p) => p.status === "active")).toBe(true);
  });

  it("filters by archived status when tab is 'archived'", () => {
    const result = filterProducts(mockProducts, "archived", "");
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].displayName).toBe("Cold Brew");
  });

  it("filters by search query on displayName (case-insensitive)", () => {
    const result = filterProducts(mockProducts, "all", "latte");
    expect(result.filtered).toHaveLength(2);
    expect(result.filtered.map((p) => p.displayName)).toEqual([
      "Latte",
      "Demo Latte",
    ]);
  });

  it("filters by search query on internalName (case-insensitive)", () => {
    const result = filterProducts(mockProducts, "all", "brew");
    expect(result.filtered).toHaveLength(1);
    expect(result.filtered[0].displayName).toBe("Cold Brew");
  });

  it("combines tab and search filters", () => {
    const result = filterProducts(mockProducts, "draft", "latte");
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
    const result = filterProducts(mockProducts, "all", "nonexistent");
    expect(result.filtered).toHaveLength(0);
  });

  it("returns correct counts regardless of filters", () => {
    const result = filterProducts(mockProducts, "draft", "latte");
    expect(result.counts.all).toBe(5);
    expect(result.counts.active).toBe(2);
    expect(result.counts.draft).toBe(2);
    expect(result.counts.archived).toBe(1);
  });
});

describe("paginateProducts", () => {
  it("returns first page of products", () => {
    const result = paginateProducts(mockProducts, 1, 2);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.displayName)).toEqual(["Flat White", "Latte"]);
  });

  it("returns second page of products", () => {
    const result = paginateProducts(mockProducts, 2, 2);
    expect(result).toHaveLength(2);
    expect(result.map((p) => p.displayName)).toEqual(["Cortado", "Cold Brew"]);
  });

  it("returns partial last page", () => {
    const result = paginateProducts(mockProducts, 3, 2);
    expect(result).toHaveLength(1);
    expect(result[0].displayName).toBe("Demo Latte");
  });

  it("returns empty array for page beyond range", () => {
    const result = paginateProducts(mockProducts, 10, 2);
    expect(result).toHaveLength(0);
  });

  it("handles page size larger than total products", () => {
    const result = paginateProducts(mockProducts, 1, 100);
    expect(result).toHaveLength(5);
  });
});
