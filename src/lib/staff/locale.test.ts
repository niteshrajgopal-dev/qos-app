import { describe, expect, it } from "vitest";

import {
  isStaffLocale,
  readStoredStaffLocale,
  setStoredStaffLocale,
  staffDocumentDirection,
  staffNavLabel,
  staffUiCopy,
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
    expect(staffNavLabel("en", "unknown", "Fallback")).toBe("Fallback");
  });
});
