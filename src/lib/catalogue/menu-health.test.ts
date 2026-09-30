import { describe, expect, it } from "vitest";

import type { MenuFacts, MenuProductFacts } from "@/lib/catalogue/menu-facts";
import {
  computeMenuHealth,
  normalizeProductNameForDuplicates,
  type MenuHealthIssueType,
  type MenuHealthReport,
} from "@/lib/catalogue/menu-health";

const AVAILABLE = {
  available: true,
  reason: "available",
  source: null,
  stopSaleReason: null,
  stopSaleExpiresAt: null,
} as const;

function healthyProduct(overrides: Partial<MenuProductFacts> = {}): MenuProductFacts {
  return {
    productPublicId: "prd_flat_white",
    internalName: "flat-white",
    status: "active",
    sectionPublicIds: ["sec_hot"],
    translations: [
      {
        locale: "en",
        displayName: "Flat White",
        description: "Double ristretto with milk",
        approvalStatus: "approved",
        translationVersion: 1,
        approvedSourceTranslationVersion: null,
      },
      {
        locale: "ar",
        displayName: "فلات وايت",
        description: "قهوة بالحليب",
        approvalStatus: "approved",
        translationVersion: 1,
        approvedSourceTranslationVersion: 1,
      },
    ],
    thumbnailPublicId: "drv_thumb_1",
    categoryCount: 1,
    activeVariants: [
      {
        publicId: "var_regular",
        isDefault: true,
        prices: [{ currency: "AED", amountMinor: 1800 }],
      },
    ],
    modifierGroups: [],
    eligibilityByLocation: { loc_marina: AVAILABLE },
    ...overrides,
  };
}

function facts(products: MenuProductFacts[], overrides: Partial<MenuFacts> = {}): MenuFacts {
  return {
    menuPublicId: "mnu_breakfast",
    menuVersion: 3,
    displayName: "Breakfast",
    sectionCount: 1,
    locationIds: ["00000000-0000-0000-0000-000000000001"],
    locations: [
      { id: "00000000-0000-0000-0000-000000000001", publicId: "loc_marina", name: "Marina" },
    ],
    products,
    evaluatedAt: new Date("2026-09-30T08:00:00.000Z"),
    ...overrides,
  };
}

function issueTypes(report: MenuHealthReport, productPublicId: string) {
  return report.products
    .find((product) => product.productPublicId === productPublicId)!
    .issues.map((issue) => issue.type);
}

function groupCount(report: MenuHealthReport, type: MenuHealthIssueType) {
  return report.issueGroups.find((group) => group.type === type)!.productCount;
}

describe("computeMenuHealth", () => {
  it("reports a fully healthy item as 100% complete with no issues", () => {
    const report = computeMenuHealth(facts([healthyProduct()]));

    expect(report.products[0]!.issues).toEqual([]);
    expect(report.completeness).toEqual({ percent: 100, passedChecks: 6, totalChecks: 6 });
    expect(report.totals).toEqual({
      products: 1,
      sections: 1,
      locations: 1,
      productsWithIssues: 0,
    });
    expect(report.evaluatedAt).toBe("2026-09-30T08:00:00.000Z");
  });

  it("returns every issue group, including empty ones, with fixed severities", () => {
    const report = computeMenuHealth(facts([healthyProduct()]));

    expect(report.issueGroups.map((group) => [group.type, group.severity])).toEqual([
      ["missing_photo", "warning"],
      ["missing_description", "warning"],
      ["missing_translation", "blocking"],
      ["modifier_issue", "blocking"],
      ["missing_price", "blocking"],
      ["uncategorised", "info"],
      ["duplicate_name", "warning"],
      ["stop_sale", "info"],
    ]);
    expect(report.issueGroups.every((group) => group.productCount === 0)).toBe(true);
  });

  it("counts items without an approved thumbnail as missing photos", () => {
    const report = computeMenuHealth(
      facts([
        healthyProduct({ productPublicId: "prd_a", thumbnailPublicId: null }),
        healthyProduct({
          productPublicId: "prd_b",
          thumbnailPublicId: null,
          translations: healthyProduct().translations.map((row) =>
            row.locale === "en" ? { ...row, displayName: "Latte" } : row,
          ),
        }),
        healthyProduct({
          productPublicId: "prd_c",
          translations: healthyProduct().translations.map((row) =>
            row.locale === "en" ? { ...row, displayName: "Mocha" } : row,
          ),
        }),
      ]),
    );

    expect(groupCount(report, "missing_photo")).toBe(2);
    expect(
      report.issueGroups.find((group) => group.type === "missing_photo")!.productPublicIds,
    ).toEqual(["prd_a", "prd_b"]);
  });

  it("flags a missing English description before a missing Arabic one", () => {
    const [en, ar] = healthyProduct().translations;
    const noEn = computeMenuHealth(
      facts([healthyProduct({ translations: [{ ...en!, description: "  " }, ar!] })]),
    );
    const noAr = computeMenuHealth(
      facts([healthyProduct({ translations: [en!, { ...ar!, description: null }] })]),
    );

    expect(noEn.products[0]!.issues).toEqual([
      { type: "missing_description", message: "English description is missing." },
    ]);
    expect(noAr.products[0]!.issues).toEqual([
      { type: "missing_description", message: "Arabic description is missing." },
    ]);
  });

  it("reuses the publish translation rule for missing, unapproved and stale Arabic", () => {
    const [en, ar] = healthyProduct().translations;
    const missingAr = computeMenuHealth(facts([healthyProduct({ translations: [en!] })]));
    const unapproved = computeMenuHealth(
      facts([healthyProduct({ translations: [en!, { ...ar!, approvalStatus: "draft" }] })]),
    );
    const stale = computeMenuHealth(
      facts([
        healthyProduct({
          translations: [
            { ...en!, translationVersion: 2 },
            { ...ar!, approvedSourceTranslationVersion: 1 },
          ],
        }),
      ]),
    );

    expect(issueTypes(missingAr, "prd_flat_white")).toContain("missing_translation");
    expect(issueTypes(unapproved, "prd_flat_white")).toEqual(["missing_translation"]);
    expect(issueTypes(stale, "prd_flat_white")).toEqual(["missing_translation"]);
  });

  it("flags modifier groups with no active options or infeasible defaults", () => {
    const report = computeMenuHealth(
      facts([
        healthyProduct({
          modifierGroups: [
            {
              publicId: "mod_milk",
              internalName: "milk",
              minSelections: 1,
              maxSelections: 1,
              options: [
                {
                  publicId: "opt_oat",
                  status: "archived",
                  isDefault: false,
                  allowsQuantity: false,
                  maxQuantity: 1,
                  priceMinor: 0,
                },
              ],
            },
            {
              publicId: "mod_shots",
              internalName: "shots",
              minSelections: 2,
              maxSelections: 1,
              options: [
                {
                  publicId: "opt_single",
                  status: "active",
                  isDefault: false,
                  allowsQuantity: false,
                  maxQuantity: 1,
                  priceMinor: 0,
                },
              ],
            },
          ],
        }),
      ]),
    );

    expect(report.products[0]!.issues).toEqual([
      { type: "modifier_issue", message: 'Modifier group "milk" has no active options.' },
      {
        type: "modifier_issue",
        message: 'Modifier group "shots": minSelections cannot exceed maxSelections.',
      },
    ]);
    expect(groupCount(report, "modifier_issue")).toBe(1);
  });

  it("flags items with no active variant or unpriced variants", () => {
    const report = computeMenuHealth(
      facts([
        healthyProduct({ productPublicId: "prd_none", activeVariants: [] }),
        healthyProduct({
          productPublicId: "prd_unpriced",
          translations: healthyProduct().translations.map((row) =>
            row.locale === "en" ? { ...row, displayName: "Latte" } : row,
          ),
          activeVariants: [{ publicId: "var_large", isDefault: true, prices: [] }],
        }),
      ]),
    );

    expect(report.products.map((product) => product.issues)).toEqual([
      [{ type: "missing_price", message: "No active variant, so the item has no price." }],
      [{ type: "missing_price", message: "Variant var_large has no price." }],
    ]);
  });

  it("treats items with no category relationship as uncategorised", () => {
    const report = computeMenuHealth(facts([healthyProduct({ categoryCount: 0 })]));

    expect(issueTypes(report, "prd_flat_white")).toEqual(["uncategorised"]);
  });

  it("flags likely duplicates by normalized English name", () => {
    const report = computeMenuHealth(
      facts([
        healthyProduct({ productPublicId: "prd_a" }),
        healthyProduct({
          productPublicId: "prd_b",
          translations: healthyProduct().translations.map((row) =>
            row.locale === "en" ? { ...row, displayName: "  flat-white!! " } : row,
          ),
        }),
        healthyProduct({
          productPublicId: "prd_c",
          translations: healthyProduct().translations.map((row) =>
            row.locale === "en" ? { ...row, displayName: "Cortado" } : row,
          ),
        }),
      ]),
    );

    expect(groupCount(report, "duplicate_name")).toBe(2);
    expect(report.products[0]!.issues).toEqual([
      { type: "duplicate_name", message: "Same name as prd_b." },
    ]);
    expect(issueTypes(report, "prd_c")).toEqual([]);
  });

  it("reports stop-sales per location and separates closed locations", () => {
    const report = computeMenuHealth(
      facts(
        [
          healthyProduct({
            eligibilityByLocation: {
              loc_marina: {
                available: false,
                reason: "stop_sale",
                source: "stop_sale",
                stopSaleReason: "Out of oat milk",
                stopSaleExpiresAt: null,
              },
              loc_jbr: {
                available: false,
                reason: "location_closed",
                source: "schedule",
                stopSaleReason: null,
                stopSaleExpiresAt: null,
              },
            },
          }),
        ],
        {
          locations: [
            { id: "1", publicId: "loc_marina", name: "Marina" },
            { id: "2", publicId: "loc_jbr", name: "JBR" },
          ],
        },
      ),
    );

    expect(report.products[0]!.issues).toEqual([
      { type: "stop_sale", message: "On stop-sale at Marina." },
    ]);
    expect(report.availability).toEqual({
      checkedLocations: [{ publicId: "loc_marina", name: "Marina" }],
      closedLocations: [{ publicId: "loc_jbr", name: "JBR" }],
    });
  });

  it("excludes duplicates and stop-sales from completeness", () => {
    const report = computeMenuHealth(
      facts([
        healthyProduct({
          productPublicId: "prd_a",
          thumbnailPublicId: null,
          eligibilityByLocation: {
            loc_marina: {
              available: false,
              reason: "stop_sale",
              source: "stop_sale",
              stopSaleReason: null,
              stopSaleExpiresAt: null,
            },
          },
        }),
        healthyProduct({ productPublicId: "prd_b", categoryCount: 0 }),
      ]),
    );

    expect(groupCount(report, "duplicate_name")).toBe(2);
    expect(report.completeness).toEqual({ percent: 83, passedChecks: 10, totalChecks: 12 });
    expect(report.totals.productsWithIssues).toBe(2);
  });

  it("returns null completeness for an empty menu", () => {
    const report = computeMenuHealth(facts([], { sectionCount: 0 }));

    expect(report.completeness).toEqual({ percent: null, passedChecks: 0, totalChecks: 0 });
    expect(report.products).toEqual([]);
  });

  it("is deterministic for the same facts", () => {
    const input = facts([
      healthyProduct({ thumbnailPublicId: null, categoryCount: 0 }),
      healthyProduct({ productPublicId: "prd_b", activeVariants: [] }),
    ]);

    expect(computeMenuHealth(input)).toEqual(computeMenuHealth(input));
  });

  it("only exposes public identifiers in the report", () => {
    const report = computeMenuHealth(facts([healthyProduct()]));

    expect(JSON.stringify(report)).not.toContain("00000000-0000-0000-0000-000000000001");
  });
});

describe("normalizeProductNameForDuplicates", () => {
  it("folds case, punctuation, symbols, width and whitespace", () => {
    expect(normalizeProductNameForDuplicates("  Flat-White!! ")).toBe("flat white");
    expect(normalizeProductNameForDuplicates("ＦＬＡＴ　ＷＨＩＴＥ")).toBe("flat white");
    expect(normalizeProductNameForDuplicates("Café & Co.")).toBe("café co");
    expect(normalizeProductNameForDuplicates("***")).toBe("");
  });
});
