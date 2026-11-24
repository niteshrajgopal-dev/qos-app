import { describe, expect, it } from "vitest";

import { DEFAULT_ITEM_FILTERS, filterItems } from "@/app/tenants/[tenantId]/inventory/inventory-filters";
import { INVENTORY_TABS, inventoryTabFrom } from "@/app/tenants/[tenantId]/inventory/inventory-tabs";
import { parseCategoryFields } from "@/lib/inventory/categories";

function failure(run: () => unknown) {
  try {
    run();
  } catch (error) {
    const typed = error as { code?: string; field?: string };
    return { code: typed.code, field: typed.field };
  }
  throw new Error("expected the parser to refuse the input");
}

describe("parseCategoryFields", () => {
  it("requires an English name on create and trims both names", () => {
    expect(parseCategoryFields({ nameEn: "  Dairy ", nameAr: " ألبان " }, true)).toEqual({ nameEn: "Dairy", nameAr: "ألبان" });
    expect(failure(() => parseCategoryFields({}, true))).toEqual({ code: "name_required", field: "nameEn" });
    expect(failure(() => parseCategoryFields({ nameEn: "   " }, true))).toEqual({ code: "name_required", field: "nameEn" });
  });

  it("leaves omitted fields out on update and clears a blank Arabic name", () => {
    expect(parseCategoryFields({}, false)).toEqual({});
    expect(parseCategoryFields({ nameAr: "" }, false)).toEqual({ nameAr: null });
    expect(parseCategoryFields({ nameAr: null }, false)).toEqual({ nameAr: null });
  });

  it("limits names to 120 characters", () => {
    expect(parseCategoryFields({ nameEn: "x".repeat(120) }, true).nameEn).toHaveLength(120);
    expect(failure(() => parseCategoryFields({ nameEn: "x".repeat(121) }, true))).toEqual({ code: "name_too_long", field: "nameEn" });
    expect(failure(() => parseCategoryFields({ nameAr: "س".repeat(121) }, false))).toEqual({ code: "name_too_long", field: "nameAr" });
  });
});

describe("inventory tabs", () => {
  it("accepts the categories tab between units and suppliers", () => {
    expect(INVENTORY_TABS).toEqual(["items", "units", "categories", "suppliers", "warehouses"]);
    expect(inventoryTabFrom("categories")).toBe("categories");
    expect(inventoryTabFrom("costs")).toBe("items");
  });
});

describe("filterItems", () => {
  const item = (
    nameEn: string,
    nameAr: string | null,
    overrides: Partial<{ kind: "purchased" | "prepared"; categoryPublicId: string | null; status: "active" | "archived"; costStatus: "known" | "unknown" | "known_not_convertible" }> = {},
  ) => ({ nameEn, nameAr, kind: "purchased" as const, categoryPublicId: null, status: "active" as const, costStatus: "unknown" as const, ...overrides });
  const items = [
    item("Full cream milk", "حليب كامل الدسم", { categoryPublicId: "invcat_dairy_1", costStatus: "known" }),
    item("Oat milk", null, { costStatus: "known_not_convertible" }),
    item("Burger sauce", "صلصة البرجر", { kind: "prepared" }),
    item("Old cheese", "جبن قديم", { categoryPublicId: "invcat_dairy_1", status: "archived" }),
  ];
  const names = (filters: Partial<typeof DEFAULT_ITEM_FILTERS>) =>
    filterItems(items, { ...DEFAULT_ITEM_FILTERS, ...filters }).map((entry) => entry.nameEn);

  it("shows active items by default", () => {
    expect(names({})).toEqual(["Full cream milk", "Oat milk", "Burger sauce"]);
    expect(names({ status: "all" })).toHaveLength(4);
    expect(names({ status: "archived" })).toEqual(["Old cheese"]);
  });

  it("searches English and Arabic names case-insensitively after NFKC normalisation", () => {
    expect(names({ query: "MILK" })).toEqual(["Full cream milk", "Oat milk"]);
    expect(names({ query: "حليب" })).toEqual(["Full cream milk"]);
    // A full-width Latin query matches after NFKC normalisation.
    expect(names({ query: "ｏａｔ" })).toEqual(["Oat milk"]);
  });

  it("filters by kind, category (including no category) and cost completeness", () => {
    expect(names({ kind: "prepared" })).toEqual(["Burger sauce"]);
    expect(names({ category: "invcat_dairy_1", status: "all" })).toEqual(["Full cream milk", "Old cheese"]);
    expect(names({ category: "none" })).toEqual(["Oat milk", "Burger sauce"]);
    expect(names({ cost: "unknown" })).toEqual(["Burger sauce"]);
    expect(names({ cost: "known" })).toEqual(["Full cream milk"]);
    expect(names({ cost: "known_not_convertible" })).toEqual(["Oat milk"]);
  });
});
