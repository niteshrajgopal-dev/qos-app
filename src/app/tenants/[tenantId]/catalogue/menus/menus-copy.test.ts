import { describe, expect, it } from "vitest";

import {
  formatMenuPrice,
  MENUS_COPY,
  MENUS_COUNT_COPY,
  menusCopy,
  menusCount,
  type MenusCountKey,
} from "@/app/tenants/[tenantId]/catalogue/menus/menus-copy";

function placeholders(text: string) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("menus copy", () => {
  it("has an Arabic string for every English key with the same placeholders", () => {
    expect(Object.keys(MENUS_COPY.ar).sort()).toEqual(Object.keys(MENUS_COPY.en).sort());
    for (const [key, english] of Object.entries(MENUS_COPY.en)) {
      const arabic = MENUS_COPY.ar[key as keyof typeof MENUS_COPY.ar];
      expect(arabic.trim(), key).not.toBe("");
      if (/[A-Za-z]{2,}/.test(english.replace(/\{\w+\}|QOS|AI/g, ""))) {
        expect(arabic, key).not.toBe(english);
      }
      expect(placeholders(arabic), key).toEqual(placeholders(english));
    }
  });

  it("gives every Arabic count phrase all six plural forms without inventing placeholders", () => {
    expect(Object.keys(MENUS_COUNT_COPY.ar).sort()).toEqual(Object.keys(MENUS_COUNT_COPY.en).sort());
    for (const key of Object.keys(MENUS_COUNT_COPY.en) as MenusCountKey[]) {
      const english = MENUS_COUNT_COPY.en[key];
      const allowed = new Set([...placeholders(english.other), "count"]);
      const arabic = MENUS_COUNT_COPY.ar[key];
      for (const form of ["zero", "one", "two", "few", "many", "other"] as const) {
        const text = arabic[form];
        expect(text?.trim(), `${key}.${form}`).toBeTruthy();
        for (const name of placeholders(text ?? "")) {
          expect(allowed.has(name), `${key}.${form} uses {${name}}`).toBe(true);
        }
      }
      expect(placeholders(arabic.other), key).toEqual(placeholders(english.other));
    }
  });

  it("picks the Arabic plural form for the count", () => {
    expect([0, 1, 2, 3, 11, 100].map((count) => menusCount("ar", "items", count))).toEqual([
      "لا توجد أصناف",
      "صنف واحد",
      "صنفان",
      "3 أصناف",
      "11 صنفًا",
      "100 صنف",
    ]);
    expect(menusCount("ar", "locations", 2)).toBe("فرعان");
    expect(menusCount("ar", "itemsNeedAttention", 3, { issues: 2 })).toBe(
      "يحتاج 2 من أصل 3 أصناف إلى مراجعة.",
    );
    expect(menusCount("en", "items", 1)).toBe("1 item");
    expect(menusCount("en", "items", 4)).toBe("4 items");
  });

  it("fills named values and formats AED prices per locale", () => {
    expect(menusCopy("en", "menuVersionValue", { version: 3 })).toBe("v3");
    expect(menusCopy("ar", "menuVersionValue", { version: 3 })).toBe("الإصدار 3");
    expect(formatMenuPrice("en", 2500, "AED")).toMatch(/^AED\s25\.00$/);
    expect(formatMenuPrice("ar", 2500, "AED")).toContain("25.00");
    expect(formatMenuPrice("ar", 2500, "AED")).toContain("د.إ.");
  });
});
