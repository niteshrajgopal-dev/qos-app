import { describe, expect, it } from "vitest";

import {
  menuCardFacts,
  menuCardName,
  menuStatusBadge,
  type MenuSummary,
} from "@/app/tenants/[tenantId]/catalogue/menus/menu-management";

function menu(overrides: Partial<MenuSummary> = {}): MenuSummary {
  return {
    publicId: "men_breakfast",
    internalName: "breakfast",
    displayName: "Breakfast",
    status: "active",
    version: 4,
    publishedVersion: 3,
    isLive: true,
    hasUnpublishedChanges: true,
    sectionCount: 2,
    itemCount: 11,
    locationIds: ["loc_a", "loc_b", "loc_c"],
    translations: { ar: { displayName: "الإفطار" } },
    updatedAt: "2026-11-03T10:00:00.000Z",
    ...overrides,
  };
}

describe("menu cards", () => {
  it("summarises a live menu with unpublished changes from the list response", () => {
    expect(menuCardFacts("en", menu())).toEqual({
      summary: "2 sections · 11 items · English & Arabic",
      rows: [
        { label: "Live version", value: "v3" },
        { label: "Draft", value: "v4 · Unpublished changes" },
        { label: "Locations", value: "3 locations" },
      ],
    });
    expect(menuCardFacts("en", menu({ hasUnpublishedChanges: false })).rows[1].value).toBe(
      "v4 · Matches live",
    );
  });

  it("shows a never-published, English-only draft without a live version", () => {
    const facts = menuCardFacts(
      "en",
      menu({
        status: "draft",
        isLive: false,
        publishedVersion: null,
        version: 1,
        sectionCount: 1,
        itemCount: 1,
        locationIds: ["loc_a"],
        translations: { ar: { displayName: "  " } },
      }),
    );
    expect(facts.summary).toBe("1 section · 1 item · English only");
    expect(facts.rows).toEqual([
      { label: "Live version", value: "Not published" },
      { label: "Draft", value: "v1" },
      { label: "Locations", value: "1 location" },
    ]);
  });

  it("uses Arabic plural forms and the Arabic name in Arabic", () => {
    const facts = menuCardFacts("ar", menu({ sectionCount: 2, locationIds: ["loc_a"] }));
    expect(facts.summary).toBe("قسمان · 11 صنفًا · الإنجليزية والعربية");
    expect(facts.rows.map((row) => row.value)).toEqual([
      "الإصدار 3",
      "الإصدار 4 · تغييرات غير منشورة",
      "فرع واحد",
    ]);
    expect(menuCardName("ar", menu())).toBe("الإفطار");
    expect(menuCardName("en", menu())).toBe("Breakfast");
    expect(menuCardName("ar", menu({ translations: undefined }))).toBe("Breakfast");
    expect(menuCardName("en", menu({ displayName: "" }))).toBe("breakfast");
  });

  it("badges live, archived and draft menus with distinct tones", () => {
    expect(menuStatusBadge("en", { isLive: true, status: "active" })).toEqual({ tone: "positive", label: "Live" });
    expect(menuStatusBadge("en", { isLive: false, status: "archived" })).toEqual({ tone: "neutral", label: "Archived" });
    expect(menuStatusBadge("ar", { isLive: false, status: "draft" })).toEqual({ tone: "warm", label: "مسودة" });
  });
});
