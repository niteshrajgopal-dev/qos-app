import { describe, expect, it } from "vitest";

import type { MenuHealthReport } from "@/lib/catalogue/menu-health";

import {
  menuHealthHeadline,
  productFixHref,
  productsForIssueType,
  visibleIssueGroups,
} from "./menu-health-view";

function report(overrides: Partial<MenuHealthReport> = {}): MenuHealthReport {
  return {
    menuPublicId: "mnu_breakfast",
    menuVersion: 2,
    menuDisplayName: "Breakfast",
    evaluatedAt: "2026-09-30T08:00:00.000Z",
    totals: { products: 3, sections: 1, locations: 1, productsWithIssues: 2 },
    completeness: { percent: 83, passedChecks: 15, totalChecks: 18 },
    issueGroups: [
      { type: "missing_photo", severity: "warning", productCount: 2, productPublicIds: ["prd_a", "prd_b"] },
      { type: "missing_description", severity: "warning", productCount: 0, productPublicIds: [] },
      { type: "missing_translation", severity: "blocking", productCount: 1, productPublicIds: ["prd_b"] },
      { type: "modifier_issue", severity: "blocking", productCount: 0, productPublicIds: [] },
      { type: "missing_price", severity: "blocking", productCount: 0, productPublicIds: [] },
      { type: "uncategorised", severity: "info", productCount: 1, productPublicIds: ["prd_a"] },
      { type: "duplicate_name", severity: "warning", productCount: 0, productPublicIds: [] },
      { type: "stop_sale", severity: "info", productCount: 0, productPublicIds: [] },
    ],
    products: [
      {
        productPublicId: "prd_a",
        displayName: "Flat White",
        internalName: "flat-white",
        thumbnailPublicId: null,
        issues: [
          { type: "missing_photo", message: "No approved photo." },
          { type: "uncategorised", message: "Not assigned to any category." },
        ],
      },
      {
        productPublicId: "prd_b",
        displayName: "Latte",
        internalName: "latte",
        thumbnailPublicId: null,
        issues: [
          { type: "missing_photo", message: "No approved photo." },
          { type: "missing_translation", message: "AR display name is required before publishing." },
        ],
      },
      {
        productPublicId: "prd_c",
        displayName: "Mocha",
        internalName: "mocha",
        thumbnailPublicId: "drv_1",
        issues: [],
      },
    ],
    availability: { checkedLocations: [], closedLocations: [] },
    ...overrides,
  };
}

describe("menu health view helpers", () => {
  it("hides empty groups and orders blocking, then warning, then info", () => {
    expect(visibleIssueGroups(report()).map((group) => group.type)).toEqual([
      "missing_translation",
      "missing_photo",
      "uncategorised",
    ]);
  });

  it("groups products and their messages for one issue type", () => {
    expect(productsForIssueType(report(), "missing_photo")).toEqual([
      { productPublicId: "prd_a", displayName: "Flat White", messages: ["No approved photo."] },
      { productPublicId: "prd_b", displayName: "Latte", messages: ["No approved photo."] },
    ]);
    expect(productsForIssueType(report(), "stop_sale")).toEqual([]);
  });

  it("summarises the menu in the headline", () => {
    expect(menuHealthHeadline(report())).toBe("2 of 3 items need attention.");
    expect(
      menuHealthHeadline(
        report({ totals: { products: 1, sections: 1, locations: 1, productsWithIssues: 0 } }),
      ),
    ).toBe("All 1 item passes the menu health checks.");
    expect(
      menuHealthHeadline(
        report({ totals: { products: 0, sections: 0, locations: 1, productsWithIssues: 0 } }),
      ),
    ).toBe("This menu has no items to check yet.");
  });

  it("links translation issues to the translations screen and the rest to edit", () => {
    expect(productFixHref("t1", "prd_a", "missing_translation")).toBe(
      "/tenants/t1/catalogue/products/prd_a/translations",
    );
    expect(productFixHref("t1", "prd_a", "missing_photo")).toBe(
      "/tenants/t1/catalogue/products/prd_a/edit",
    );
  });
});
