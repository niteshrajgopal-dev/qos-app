import { describe, expect, it } from "vitest";

import {
  isStaffLocale,
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

  it("returns Arabic chrome copy for the shell", () => {
    expect(staffUiCopy("ar", "home")).toBe("الرئيسية");
    expect(staffNavLabel("ar", "menus", "Menus")).toBe("القوائم");
    expect(staffNavLabel("ar", "catalogue", "Products")).toBe("المنتجات");
    expect(staffNavLabel("en", "unknown", "Fallback")).toBe("Fallback");
  });
});
