import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  catalogueCardCategoryName,
  formatCatalogueCardPrice,
  ProductCardCategory,
  ProductCardPrice,
} from "./catalogue-product-card-facts";

const plainSpaces = (text: string) => text.replace(/\u00a0/g, " ");

const hotDrinks = {
  publicId: "cat_hot_drinks",
  displayName: { en: "Hot drinks", ar: "مشروبات ساخنة" },
};

describe("catalogue card price", () => {
  it("formats AED for English with the currency code first", () => {
    expect(plainSpaces(formatCatalogueCardPrice("en", { amountMinor: 1850, currency: "AED" }))).toBe(
      "AED 18.50",
    );
    expect(
      plainSpaces(formatCatalogueCardPrice("en", { amountMinor: 123450, currency: "AED" })),
    ).toBe("AED 1,234.50");
  });

  it("formats AED for Arabic with the dirham sign and Western digits", () => {
    const formatted = formatCatalogueCardPrice("ar", { amountMinor: 1850, currency: "AED" });
    expect(formatted).toContain("18.50");
    expect(formatted).toContain("د.إ.");
    expect(formatted).not.toMatch(/[٠-٩]/);
  });

  it("renders the formatted price on the card", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCardPrice, {
        locale: "en",
        price: { amountMinor: 500, currency: "AED" },
      }),
    );
    expect(plainSpaces(html)).toBe('<span class="qosp-product-price">AED 5.00</span>');
  });

  it("renders localized copy when the default variant has no AED price", () => {
    const en = renderToStaticMarkup(createElement(ProductCardPrice, { locale: "en", price: null }));
    const ar = renderToStaticMarkup(createElement(ProductCardPrice, { locale: "ar", price: null }));
    expect(en).toContain("No price set");
    expect(ar).toContain("لم يُحدَّد السعر");
    expect(ar).toContain('data-empty="true"');
  });
});

describe("catalogue card category", () => {
  it("uses the category name for the staff locale", () => {
    expect(catalogueCardCategoryName("en", hotDrinks)).toBe("Hot drinks");
    expect(catalogueCardCategoryName("ar", hotDrinks)).toBe("مشروبات ساخنة");
  });

  it("falls back to the other translation when one is missing", () => {
    const englishOnly = { publicId: "cat_x", displayName: { en: "Bakery", ar: null } };
    expect(catalogueCardCategoryName("ar", englishOnly)).toBe("Bakery");
  });

  it("shows the internal name when the product has no category", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCardCategory, { locale: "ar", category: null, fallback: "latte" }),
    );
    expect(html).toBe('<span class="qosp-product-meta">latte</span>');
  });

  it("renders the Arabic category name on the card", () => {
    const html = renderToStaticMarkup(
      createElement(ProductCardCategory, { locale: "ar", category: hotDrinks, fallback: "latte" }),
    );
    expect(html).toContain("مشروبات ساخنة");
    expect(html).not.toContain("latte");
  });
});
