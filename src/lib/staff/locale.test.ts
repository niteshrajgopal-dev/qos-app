import { describe, expect, it } from "vitest";

import {
  isStaffLocale,
  readStoredStaffLocale,
  setStoredStaffLocale,
  STAFF_COUNT_COPY,
  STAFF_UI_COPY,
  staffCopyWith,
  staffCount,
  staffDocumentDirection,
  staffNavLabel,
  staffUiCopy,
  subscribeStaffLocale,
} from "@/lib/staff/locale";

describe("staff locale", () => {
  it("maps Arabic to RTL and English to LTR", () => {
    expect(staffDocumentDirection("ar")).toBe("rtl");
    expect(staffDocumentDirection("en")).toBe("ltr");
  });

  it("accepts only staff locales", () => {
    expect(isStaffLocale("ar")).toBe(true);
    expect(isStaffLocale("fr")).toBe(false);
  });

  it("reads and writes the stored staff locale", () => {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => {
            store.set(key, value);
          },
        },
      },
    });

    expect(readStoredStaffLocale()).toBe("en");
    setStoredStaffLocale("ar");
    expect(readStoredStaffLocale()).toBe("ar");
  });

  it("returns Arabic chrome copy for the shell", () => {
    expect(staffUiCopy("ar", "home")).toBe("الرئيسية");
    expect(staffNavLabel("ar", "menus", "Menus")).toBe("القوائم");
    expect(staffNavLabel("ar", "catalogue", "Products")).toBe("المنتجات");
    expect(staffNavLabel("ar", "home", "Overview")).toBe("نظرة عامة");
    expect(staffNavLabel("en", "unknown", "Fallback")).toBe("Fallback");
  });

  it("keeps Arabic staff UI keys in parity with English", () => {
    const enKeys = Object.keys(STAFF_UI_COPY.en).sort();
    const arKeys = Object.keys(STAFF_UI_COPY.ar).sort();
    expect(arKeys).toEqual(enKeys);
  });

  it("keeps the same {placeholders} in Arabic and English copy", () => {
    const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const mismatched = Object.entries(STAFF_UI_COPY.en)
      .filter(([key, en]) => {
        const ar = STAFF_UI_COPY.ar[key as keyof typeof STAFF_UI_COPY.ar];
        return placeholders(en).join() !== placeholders(ar).join();
      })
      .map(([key]) => key);
    expect(mismatched).toEqual([]);
  });

  it("keeps count copy keys in parity and gives Arabic every plural form", () => {
    expect(Object.keys(STAFF_COUNT_COPY.ar).sort()).toEqual(Object.keys(STAFF_COUNT_COPY.en).sort());
    for (const [key, forms] of Object.entries(STAFF_COUNT_COPY.ar)) {
      expect(Object.keys(forms).sort(), key).toEqual(["few", "many", "one", "other", "two", "zero"]);
    }
  });

  it("uses Arabic plural forms for product counts", () => {
    expect(staffCount("ar", "products", 0)).toBe("لا توجد منتجات");
    expect(staffCount("ar", "products", 1)).toBe("منتج واحد");
    expect(staffCount("ar", "products", 2)).toBe("منتجان");
    expect(staffCount("ar", "products", 3)).toBe("3 منتجات");
    expect(staffCount("ar", "products", 10)).toBe("10 منتجات");
    expect(staffCount("ar", "products", 11)).toBe("11 منتجًا");
    expect(staffCount("ar", "products", 99)).toBe("99 منتجًا");
    expect(staffCount("ar", "products", 100)).toBe("100 منتج");
    expect(staffCount("ar", "products", 103)).toBe("103 منتجات");
  });

  it("uses English singular and plural for counts", () => {
    expect(staffCount("en", "products", 0)).toBe("0 products");
    expect(staffCount("en", "products", 1)).toBe("1 product");
    expect(staffCount("en", "modifierOptions", 4)).toBe("4 options");
  });

  it("fills named placeholders in staff copy", () => {
    expect(staffCopyWith("en", "paginationRange", { from: 1, to: 24, total: 148 })).toBe(
      "1–24 of 148",
    );
    expect(staffCopyWith("en", "workspaceEyebrow", { name: "Quotes" })).toBe("Quotes workspace");
  });

  it("notifies locale subscribers when the stored locale changes", () => {
    const store = new Map<string, string>();
    let notifications = 0;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          getItem: (key: string) => store.get(key) ?? null,
          setItem: (key: string, value: string) => {
            store.set(key, value);
          },
        },
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });

    const unsubscribe = subscribeStaffLocale(() => {
      notifications += 1;
    });
    setStoredStaffLocale("ar");
    expect(notifications).toBe(1);
    unsubscribe();
  });

  it("provides bilingual product editor section labels", () => {
    expect(staffUiCopy("en", "productEditorSectionIdentityTitle")).toBe("Identity");
    expect(staffUiCopy("ar", "productEditorSectionIdentityTitle")).toBe("الهوية");
    expect(staffUiCopy("en", "productEditorSectionStatusTitle")).toBe("Status");
    expect(staffUiCopy("ar", "productEditorSectionStatusTitle")).toBe("الحالة");
  });

  it("provides bilingual remove-photo confirm copy (QOS-151)", () => {
    expect(staffUiCopy("en", "removeProductPhotoConfirmTitle")).toBe(
      "Remove this photo?",
    );
    expect(staffUiCopy("ar", "removeProductPhotoConfirmTitle")).toBe(
      "إزالة هذه الصورة؟",
    );
    expect(staffUiCopy("ar", "removedPhotoHistoryTitle")).toBe("الصور المُزالة");
  });
});
