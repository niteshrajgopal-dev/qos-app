import { describe, expect, it } from "vitest";

import {
  productVariantArchiveConfirmCopy,
  productVariantArchiveConfirmReducer,
  productVariantShowsArchive,
  productVariantShowsRestore,
  type ProductVariantArchiveConfirm,
} from "./product-variants-panel-state";
import { STAFF_UI_COPY } from "@/lib/staff/locale";

const closed: ProductVariantArchiveConfirm = { targetPublicId: null, request: null };

const large = (sellableLinkKind: "recipe" | "direct_stock" | null) => ({
  publicId: "var_latte_large",
  sellableLinkKind,
  translations: { en: { displayName: "Large" }, ar: { displayName: "كبير" } },
});

describe("variant archive confirmation", () => {
  it("opens without archiving, and cancel closes it without a request", () => {
    const opened = productVariantArchiveConfirmReducer(closed, { type: "open", variantPublicId: "var_latte_large" });
    expect(opened).toEqual({ targetPublicId: "var_latte_large", request: null });
    expect(productVariantArchiveConfirmReducer(opened, { type: "cancel" })).toEqual(closed);
  });

  it("confirm sends the existing archive patch with the product version, once", () => {
    const opened = productVariantArchiveConfirmReducer(closed, { type: "open", variantPublicId: "var_latte_large" });
    const confirmed = productVariantArchiveConfirmReducer(opened, { type: "confirm", productVersion: 7 });
    expect(confirmed).toEqual({
      targetPublicId: null,
      request: { variantPublicId: "var_latte_large", body: { expectedProductVersion: 7, status: "archived" } },
    });
    expect(productVariantArchiveConfirmReducer(closed, { type: "confirm", productVersion: 7 })).toEqual(closed);
  });

  it("names the variant and says nothing about links when it has none", () => {
    const en = productVariantArchiveConfirmCopy("en", large(null));
    expect(en).toEqual({
      title: "Archive this variant?",
      body: "Large will no longer be offered for sale. You can restore it later.",
      linkNotice: null,
      confirmLabel: "Archive variant",
      cancelLabel: "Cancel",
    });
    const ar = productVariantArchiveConfirmCopy("ar", large(null));
    expect(ar.body).toBe("لن يُعرض كبير للبيع بعد الآن. يمكنك استعادته لاحقًا.");
    expect(ar.cancelLabel).toBe(STAFF_UI_COPY.ar.cancel);
    expect(Object.values(ar).filter(Boolean).join(" ")).not.toMatch(/[A-Za-z]/);
  });

  it("says when the variant has a recipe or direct-stock link, in English and Arabic", () => {
    expect(productVariantArchiveConfirmCopy("en", large("recipe")).linkNotice).toBe(
      "This variant is linked to a recipe. The link stays in place and will show the variant as archived.",
    );
    expect(productVariantArchiveConfirmCopy("ar", large("recipe")).linkNotice).toBe(STAFF_UI_COPY.ar.variantArchiveConfirmRecipeLink);
    expect(productVariantArchiveConfirmCopy("en", large("direct_stock")).linkNotice).toBe(
      "This variant is linked to a stock item. The link stays in place and will show the variant as archived.",
    );
    expect(productVariantArchiveConfirmCopy("ar", large("direct_stock")).linkNotice).toBe(STAFF_UI_COPY.ar.variantArchiveConfirmStockLink);
    expect(STAFF_UI_COPY.ar.variantArchiveConfirmRecipeLink).toContain("وصفة");
    expect(STAFF_UI_COPY.ar.variantArchiveConfirmStockLink).toContain("صنف مخزون");
  });

  it("falls back to the English label, then the public id, when a label is blank", () => {
    const unlabelledAr = { ...large(null), translations: { en: { displayName: "Large" }, ar: { displayName: " " } } };
    expect(productVariantArchiveConfirmCopy("ar", unlabelledAr).body).toContain("Large");
    const unlabelled = { ...large(null), translations: { en: { displayName: "" }, ar: { displayName: "" } } };
    expect(productVariantArchiveConfirmCopy("en", unlabelled).body).toContain("var_latte_large");
  });

  it("offers archive only on active, non-default variants of an editable product", () => {
    expect(productVariantShowsArchive(false, { status: "active", isDefault: false })).toBe(true);
    expect(productVariantShowsArchive(false, { status: "active", isDefault: true })).toBe(false);
    expect(productVariantShowsArchive(false, { status: "archived", isDefault: false })).toBe(false);
    expect(productVariantShowsArchive(true, { status: "active", isDefault: false })).toBe(false);
  });
});

describe("variant restore control", () => {
  it("shows on archived variants of an editable product for administrators only", () => {
    expect(productVariantShowsRestore(false, "archived", true)).toBe(true);
    expect(productVariantShowsRestore(false, "active", true)).toBe(false);
    expect(productVariantShowsRestore(true, "archived", true)).toBe(false);
    expect(productVariantShowsRestore(false, "archived", false)).toBe(false);
  });

  it("has restore and success copy in English and Arabic that says the variant is not the default", () => {
    expect(STAFF_UI_COPY.en.variantRestore).toBe("Restore variant");
    expect(STAFF_UI_COPY.ar.variantRestore).toBe("استعادة المتغيّر");
    expect(STAFF_UI_COPY.en.variantRestored).toBe("Variant restored. It is active again and is not the default.");
    expect(STAFF_UI_COPY.ar.variantRestored).toBe("تمت استعادة المتغيّر. أصبح نشطًا مجددًا وليس هو الافتراضي.");
  });
});
