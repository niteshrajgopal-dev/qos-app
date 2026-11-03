import { describe, expect, it } from "vitest";

import {
  blockTypeLabel,
  heroPreviewCopy,
  releaseOutcomeMessage,
  storefrontFacts,
  storefrontLanguagesLabel,
  storefrontStatusBadge,
  themePreviewFonts,
  type ContentBlock,
  type StorefrontSummary,
} from "@/app/tenants/[tenantId]/channels/online-store/storefront-view";
import {
  formatStorefrontDateTime,
  STOREFRONTS_COPY,
} from "@/app/tenants/[tenantId]/channels/online-store/storefronts-copy";

function storefront(overrides: Partial<StorefrontSummary> = {}): StorefrontSummary {
  return {
    publicId: "stf_quotes",
    internalName: "Quotes Website",
    slug: "quotes",
    status: "active",
    draftVersion: 4,
    primaryHostname: "quotes.example.com",
    activeRelease: {
      releasePublicId: "rel_2",
      releaseVersion: 2,
      publishedAt: "2026-11-03T15:03:00.000Z",
      publishedBySubject: "sub_admin",
    },
    ...overrides,
  };
}

function hero(props: Record<string, unknown>, visible = true): ContentBlock {
  return { id: "hero", type: "hero", schemaVersion: 1, visible, props };
}

function placeholders(text: string) {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

describe("storefronts copy", () => {
  it("has Arabic for every key with the same placeholders", () => {
    expect(Object.keys(STOREFRONTS_COPY.ar).sort()).toEqual(Object.keys(STOREFRONTS_COPY.en).sort());
    for (const [key, english] of Object.entries(STOREFRONTS_COPY.en)) {
      const arabic = STOREFRONTS_COPY.ar[key as keyof typeof STOREFRONTS_COPY.ar];
      expect(arabic.trim(), key).not.toBe("");
      expect(placeholders(arabic), key).toEqual(placeholders(english));
      if (/[A-Za-z]{2,}/.test(english.replace(/\{\w+\}/g, ""))) {
        expect(arabic, key).not.toBe(english);
      }
    }
  });

  it("formats release times with Latin digits in both languages", () => {
    const english = formatStorefrontDateTime("en", "2026-11-03T15:03:00.000Z");
    const arabic = formatStorefrontDateTime("ar", "2026-11-03T15:03:00.000Z");
    expect(english).toContain("2026");
    expect(arabic).toContain("2026");
    expect(arabic).not.toMatch(/[٠-٩]/);
  });
});

describe("storefront card", () => {
  it("badges live, unpublished and archived storefronts", () => {
    expect(storefrontStatusBadge("en", storefront())).toEqual({ tone: "positive", label: "Live" });
    expect(storefrontStatusBadge("en", storefront({ activeRelease: null }))).toEqual({
      tone: "warm",
      label: "Not published",
    });
    expect(storefrontStatusBadge("ar", storefront({ status: "archived" }))).toEqual({
      tone: "neutral",
      label: "مؤرشفة",
    });
  });

  it("lists live release, draft and languages from the staff responses", () => {
    expect(storefrontFacts("en", storefront(), ["en", "ar"])).toEqual([
      { label: "Live release", value: "v2" },
      { label: "Draft", value: "v4" },
      { label: "Languages", value: "English & Arabic" },
    ]);
    expect(storefrontFacts("ar", storefront({ activeRelease: null }), null)).toEqual([
      { label: "الإصدار المنشور", value: "غير منشور" },
      { label: "المسودة", value: "الإصدار 4" },
    ]);
    expect(storefrontLanguagesLabel("en", ["en"])).toBe("English only");
    expect(storefrontLanguagesLabel("ar", ["ar"])).toBe("العربية فقط");
  });
});

describe("storefront preview", () => {
  it("shows hero copy in the staff language and falls back to the other one", () => {
    const blocks = [
      hero({
        title: { en: "Coffee worth slowing down for.", ar: "قهوة تستحق التمهل." },
        subtitle: { en: "Small batches.", ar: "" },
      }),
    ];
    expect(heroPreviewCopy(blocks, "ar")).toEqual({
      title: { text: "قهوة تستحق التمهل.", lang: "ar" },
      subtitle: { text: "Small batches.", lang: "en" },
    });
    expect(heroPreviewCopy(blocks, "en")?.title).toEqual({
      text: "Coffee worth slowing down for.",
      lang: "en",
    });
  });

  it("ignores hidden heroes and empty copy", () => {
    expect(heroPreviewCopy([hero({ title: { en: "Hidden", ar: "" } }, false)], "en")).toBeNull();
    expect(heroPreviewCopy([hero({ title: { en: " ", ar: "" } })], "en")).toEqual({
      title: null,
      subtitle: null,
    });
    expect(heroPreviewCopy([], "en")).toBeNull();
  });

  it("maps theme fonts to real font stacks", () => {
    expect(themePreviewFonts({ body: "inter", display: "young-serif" })).toEqual({
      display: '"Young Serif", Georgia, "Times New Roman", serif',
      body: 'Inter, "Helvetica Neue", Arial, sans-serif',
    });
    expect(themePreviewFonts({ body: "system-ui", display: "system-ui" })).toEqual({
      display: "system-ui, sans-serif",
      body: "system-ui, sans-serif",
    });
  });
});

describe("storefront labels", () => {
  it("names known block types and keeps unknown ones as sent", () => {
    expect(blockTypeLabel("en", "hero")).toBe("Hero");
    expect(blockTypeLabel("ar", "footer")).toBe("التذييل");
    expect(blockTypeLabel("ar", "gallery")).toBe("gallery");
  });

  it("reports publish and rollback outcomes, including replays", () => {
    expect(releaseOutcomeMessage("en", "publish", { releaseVersion: 3, idempotentReplay: false })).toBe(
      "Release v3 is now live.",
    );
    expect(releaseOutcomeMessage("en", "publish", { releaseVersion: 3, idempotentReplay: true })).toBe(
      "Release v3 is already live.",
    );
    expect(releaseOutcomeMessage("ar", "rollback", { releaseVersion: 1, idempotentReplay: false })).toBe(
      "تم التراجع إلى الإصدار 1.",
    );
    expect(releaseOutcomeMessage("ar", "rollback", { releaseVersion: 1, idempotentReplay: true })).toBe(
      "كان الإصدار 1 منشورًا بالفعل.",
    );
  });
});
