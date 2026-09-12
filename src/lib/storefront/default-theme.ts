import type { BusinessProfile } from "@/lib/tenant/types";
import type { StorefrontDraftConfig } from "@/db/schema";

const hospitalityBaseline: StorefrontDraftConfig = {
  theme: {
    preset: "hospitality_baseline",
    colors: {
      primary: "#111827",
      accent: "#b45309",
      background: "#ffffff",
      text: "#1f2937",
    },
    typography: {
      fontFamily: "system-ui, sans-serif",
    },
  },
  navigation: [{ id: "menu", labelKey: "nav.menu", href: "/" }],
  contentBlocks: [
    {
      id: "hero",
      type: "hero",
      props: {
        titleKey: "home.hero.title",
        subtitleKey: "home.hero.subtitle",
      },
    },
  ],
  featureFlags: {
    localeSelector: true,
  },
};

const genericRetailBaseline: StorefrontDraftConfig = {
  theme: {
    preset: "generic_retail_baseline",
    colors: {
      primary: "#14532d",
      accent: "#ec4899",
      background: "#fff7ed",
      text: "#1f2937",
    },
    typography: {
      fontFamily: "system-ui, sans-serif",
    },
  },
  navigation: [
    { id: "shop", labelKey: "nav.shop", href: "/" },
    { id: "about", labelKey: "nav.about", href: "/about" },
  ],
  contentBlocks: [
    {
      id: "hero",
      type: "hero",
      props: {
        titleKey: "home.hero.title",
        subtitleKey: "home.hero.subtitle",
      },
    },
  ],
  featureFlags: {
    localeSelector: true,
  },
};

export function defaultStorefrontDraftConfig(
  businessProfile: BusinessProfile,
): StorefrontDraftConfig {
  if (businessProfile === "generic_retail") {
    return structuredClone(genericRetailBaseline);
  }

  return structuredClone(hospitalityBaseline);
}
