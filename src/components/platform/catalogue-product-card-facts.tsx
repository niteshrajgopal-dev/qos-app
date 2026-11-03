import type { StaffLocale } from "@/lib/staff/locale";
import { staffUiCopy } from "@/lib/staff/locale";

export type ProductSummaryPrice = { amountMinor: number; currency: string };

export type ProductSummaryCategory = {
  publicId: string;
  displayName: { en: string | null; ar: string | null };
};

const PRICE_LOCALES: Record<StaffLocale, string> = { en: "en-AE", ar: "ar-AE" };

export function formatCatalogueCardPrice(locale: StaffLocale, price: ProductSummaryPrice) {
  return new Intl.NumberFormat(PRICE_LOCALES[locale], {
    style: "currency",
    currency: price.currency,
    numberingSystem: "latn",
  }).format(price.amountMinor / 100);
}

export function catalogueCardCategoryName(
  locale: StaffLocale,
  category: ProductSummaryCategory | null,
) {
  if (!category) {
    return null;
  }
  return category.displayName[locale] || category.displayName.en || category.displayName.ar || null;
}

export function ProductCardCategory({
  locale,
  category,
  fallback,
}: {
  locale: StaffLocale;
  category: ProductSummaryCategory | null;
  fallback: string;
}) {
  return (
    <span className="qosp-product-meta">
      {catalogueCardCategoryName(locale, category) ?? fallback}
    </span>
  );
}

export function ProductCardPrice({
  locale,
  price,
}: {
  locale: StaffLocale;
  price: ProductSummaryPrice | null;
}) {
  if (!price) {
    return (
      <span className="qosp-product-price" data-empty="true">
        {staffUiCopy(locale, "productPriceNotSet")}
      </span>
    );
  }
  return (
    <span className="qosp-product-price">
      {formatCatalogueCardPrice(locale, price)}
    </span>
  );
}
