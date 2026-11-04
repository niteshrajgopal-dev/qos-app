import { storefrontsCopy } from "@/app/tenants/[tenantId]/channels/online-store/storefronts-copy";
import type { PortalBadgeTone } from "@/components/portal/workspace/PortalWorkspace";
import type { StaffLocale } from "@/lib/staff/locale";

export type StorefrontSummary = {
  publicId: string;
  internalName: string;
  slug: string;
  status: "draft" | "active" | "archived";
  draftVersion: number;
  primaryHostname: string | null;
  activeRelease: {
    releasePublicId: string;
    releaseVersion: number;
    publishedAt: string;
    publishedBySubject: string;
    publishedByName?: string | null;
  } | null;
};

/** Who published a release: the staff display name, never the raw auth subject. */
export function storefrontPublisherLabel(locale: StaffLocale, publishedByName?: string | null) {
  return publishedByName?.trim() || storefrontsCopy(locale, "publisherUnknown");
}

export type ThemeDraft = {
  schemaVersion: number;
  preset: "hospitality_baseline" | "generic_retail_baseline";
  colors: {
    primary: string;
    accent: string;
    background: string;
    text: string;
  };
  typography: {
    body: "inter" | "system-ui";
    display: "young-serif" | "system-ui";
  };
  logo?: {
    publicDerivativeId: string;
  };
};

export type ContentBlock = {
  id: string;
  type: string;
  schemaVersion: number;
  visible: boolean;
  props: Record<string, unknown>;
};

export type LocalizedCopy = {
  en: string;
  ar: string;
};

export type ContentBlocksPreview = {
  supportedLocales: string[];
  blocks: ContentBlock[];
};

export function readLocalizedCopy(value: unknown): LocalizedCopy {
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return {
      en: typeof record.en === "string" ? record.en : "",
      ar: typeof record.ar === "string" ? record.ar : "",
    };
  }

  return { en: "", ar: "" };
}

export function storefrontStatusBadge(
  locale: StaffLocale,
  storefront: Pick<StorefrontSummary, "status" | "activeRelease">,
): { tone: PortalBadgeTone; label: string } {
  if (storefront.status === "archived") {
    return { tone: "neutral", label: storefrontsCopy(locale, "statusArchived") };
  }
  if (storefront.activeRelease) {
    return { tone: "positive", label: storefrontsCopy(locale, "statusLive") };
  }
  return { tone: "warm", label: storefrontsCopy(locale, "statusNotPublished") };
}

export function storefrontLanguagesLabel(locale: StaffLocale, supportedLocales: readonly string[]) {
  const hasEnglish = supportedLocales.includes("en");
  const hasArabic = supportedLocales.includes("ar");
  if (hasEnglish && hasArabic) {
    return storefrontsCopy(locale, "languagesBoth");
  }
  if (hasArabic) {
    return storefrontsCopy(locale, "languagesArabic");
  }
  return storefrontsCopy(locale, "languagesEnglish");
}

/** Card facts, read only from the staff storefront and content-block responses. */
export function storefrontFacts(
  locale: StaffLocale,
  storefront: StorefrontSummary,
  supportedLocales: readonly string[] | null,
) {
  const rows = [
    {
      label: storefrontsCopy(locale, "factLiveRelease"),
      value: storefront.activeRelease
        ? storefrontsCopy(locale, "versionValue", {
            version: storefront.activeRelease.releaseVersion,
          })
        : storefrontsCopy(locale, "factNotPublished"),
    },
    {
      label: storefrontsCopy(locale, "factDraft"),
      value: storefrontsCopy(locale, "versionValue", { version: storefront.draftVersion }),
    },
  ];
  if (supportedLocales && supportedLocales.length > 0) {
    rows.push({
      label: storefrontsCopy(locale, "factLanguages"),
      value: storefrontLanguagesLabel(locale, supportedLocales),
    });
  }
  return rows;
}

/** Hero copy for the preview, in the staff language with the other language as fallback. */
export function heroPreviewCopy(blocks: readonly ContentBlock[], locale: StaffLocale) {
  const hero = blocks.find((block) => block.type === "hero" && block.visible);
  if (!hero) {
    return null;
  }
  const other: StaffLocale = locale === "ar" ? "en" : "ar";
  const title = readLocalizedCopy(hero.props.title);
  const subtitle = readLocalizedCopy(hero.props.subtitle);
  const pick = (copy: LocalizedCopy) => {
    if (copy[locale].trim()) {
      return { text: copy[locale], lang: locale };
    }
    if (copy[other].trim()) {
      return { text: copy[other], lang: other };
    }
    return null;
  };
  return { title: pick(title), subtitle: pick(subtitle) };
}

export function themePreviewFonts(typography: ThemeDraft["typography"]) {
  return {
    display:
      typography.display === "young-serif"
        ? '"Young Serif", Georgia, "Times New Roman", serif'
        : "system-ui, sans-serif",
    body:
      typography.body === "inter"
        ? 'Inter, "Helvetica Neue", Arial, sans-serif'
        : "system-ui, sans-serif",
  };
}

export function blockTypeLabel(locale: StaffLocale, type: string) {
  if (type === "hero") {
    return storefrontsCopy(locale, "blockTypeHero");
  }
  if (type === "footer") {
    return storefrontsCopy(locale, "blockTypeFooter");
  }
  return type;
}

export function releaseOutcomeMessage(
  locale: StaffLocale,
  kind: "publish" | "rollback",
  outcome: { releaseVersion: number; idempotentReplay: boolean },
) {
  const key =
    kind === "publish"
      ? outcome.idempotentReplay
        ? "publishReplay"
        : "publishLive"
      : outcome.idempotentReplay
        ? "rollbackReplay"
        : "rollbackDone";
  return storefrontsCopy(locale, key, { version: outcome.releaseVersion });
}
