import type { BusinessProfile } from "@/lib/tenant/types";
import type { StorefrontDraftConfig } from "@/db/schema";
import {
  STOREFRONT_THEME_SCHEMA_VERSION,
  storefrontThemeToRecord,
  type StorefrontThemeDraft,
} from "@/lib/storefront/storefront-theme-schema";

const hospitalityTheme: StorefrontThemeDraft = {
  schemaVersion: STOREFRONT_THEME_SCHEMA_VERSION,
  preset: "hospitality_baseline",
  colors: {
    primary: "#2F2322",
    accent: "#CBB792",
    background: "#F5F1E9",
    text: "#2F2322",
  },
  typography: {
    body: "inter",
    display: "young-serif",
  },
};

const genericRetailTheme: StorefrontThemeDraft = {
  schemaVersion: STOREFRONT_THEME_SCHEMA_VERSION,
  preset: "generic_retail_baseline",
  colors: {
    primary: "#14532D",
    accent: "#EC4899",
    background: "#FFF7ED",
    text: "#1F2937",
  },
  typography: {
    body: "inter",
    display: "system-ui",
  },
};

const hospitalityBaseline: StorefrontDraftConfig = {
  theme: storefrontThemeToRecord(hospitalityTheme),
  navigation: [{ id: "menu", labelKey: "nav.menu", href: "/" }],
  contentBlocks: [
    {
      id: "hero",
      type: "hero",
      schemaVersion: 1,
      visible: true,
      props: {
        title: {
          en: "Coffee worth slowing down for.",
          ar: "قهوة تستحق التمهل.",
        },
        subtitle: {
          en: "We roast in small batches, pour it in our cafés, and post it anywhere in the country the next morning.",
          ar: "نحمص بكميات صغيرة، ونقدمها في مقاهينا، ونرسلها إلى جميع أنحاء البلاد في صباح اليوم التالي.",
        },
      },
    },
  ],
  featureFlags: {
    localeSelector: true,
  },
};

const genericRetailBaseline: StorefrontDraftConfig = {
  theme: storefrontThemeToRecord(genericRetailTheme),
  navigation: [
    { id: "shop", labelKey: "nav.shop", href: "/" },
    { id: "about", labelKey: "nav.about", href: "/about" },
  ],
  contentBlocks: [
    {
      id: "hero",
      type: "hero",
      schemaVersion: 1,
      visible: true,
      props: {
        title: {
          en: "Fresh flowers for every moment.",
          ar: "زهور طازجة لكل لحظة.",
        },
        subtitle: {
          en: "Seasonal bouquets and stems, ready for pickup or delivery.",
          ar: "باقات ومزهريات موسمية جاهزة للاستلام أو التوصيل.",
        },
      },
    },
  ],
  featureFlags: {
    localeSelector: true,
  },
};

export function defaultStorefrontThemeDraft(
  businessProfile: BusinessProfile,
): StorefrontThemeDraft {
  if (businessProfile === "generic_retail") {
    return structuredClone(genericRetailTheme);
  }

  return structuredClone(hospitalityTheme);
}

export function defaultStorefrontDraftConfig(
  businessProfile: BusinessProfile,
): StorefrontDraftConfig {
  if (businessProfile === "generic_retail") {
    return structuredClone(genericRetailBaseline);
  }

  return structuredClone(hospitalityBaseline);
}
