"use client";

import { ExternalLink, Globe2 } from "lucide-react";

import { storefrontsCopy } from "@/app/tenants/[tenantId]/channels/online-store/storefronts-copy";
import {
  heroPreviewCopy,
  storefrontFacts,
  storefrontStatusBadge,
  themePreviewFonts,
  type ContentBlocksPreview,
  type StorefrontSummary,
  type ThemeDraft,
} from "@/app/tenants/[tenantId]/channels/online-store/storefront-view";
import { PortalBadge } from "@/components/portal/workspace/PortalWorkspace";
import type { StaffLocale } from "@/lib/staff/locale";

type StorefrontOverviewCardProps = {
  locale: StaffLocale;
  storefront: StorefrontSummary;
  theme: ThemeDraft | null;
  content: ContentBlocksPreview | null;
};

export function StorefrontOverviewCard({
  locale,
  storefront,
  theme,
  content,
}: StorefrontOverviewCardProps) {
  const copy = (key: Parameters<typeof storefrontsCopy>[1], values?: Record<string, string | number>) =>
    storefrontsCopy(locale, key, values);
  const badge = storefrontStatusBadge(locale, storefront);
  const facts = storefrontFacts(locale, storefront, content?.supportedLocales ?? null);
  const hero = content ? heroPreviewCopy(content.blocks, locale) : null;
  const fonts = theme ? themePreviewFonts(theme.typography) : null;
  const titleId = `storefront-title-${storefront.publicId}`;

  return (
    <article className="qosp-glass qosp-sf-card" aria-labelledby={titleId}>
      <figure className="qosp-sf-preview" aria-label={copy("previewLabel")}>
        <div className="qosp-sf-browser" aria-hidden="true">
          <span />
          <span />
          <span />
          <small dir="ltr">{storefront.primaryHostname ?? storefront.slug}</small>
        </div>
        <div
          className="qosp-sf-site"
          style={
            theme && fonts
              ? {
                  background: theme.colors.background,
                  color: theme.colors.text,
                  fontFamily: fonts.body,
                }
              : undefined
          }
        >
          <span className="qosp-sf-site-brand">{storefront.internalName}</span>
          <p
            className="qosp-sf-site-title"
            lang={hero?.title?.lang}
            dir={hero?.title ? (hero.title.lang === "ar" ? "rtl" : "ltr") : undefined}
            style={theme && fonts ? { color: theme.colors.primary, fontFamily: fonts.display } : undefined}
          >
            {hero?.title?.text ?? copy("previewTitleFallback")}
          </p>
          {hero?.subtitle ? (
            <p
              className="qosp-sf-site-sub"
              lang={hero.subtitle.lang}
              dir={hero.subtitle.lang === "ar" ? "rtl" : "ltr"}
            >
              {hero.subtitle.text}
            </p>
          ) : null}
          <span
            className="qosp-sf-site-accent"
            aria-hidden="true"
            style={theme ? { background: theme.colors.accent } : undefined}
          />
        </div>
        <figcaption className="qosp-meta-line qosp-sf-preview-note">{copy("previewNote")}</figcaption>
      </figure>

      <div className="qosp-sf-info">
        <div className="qosp-sf-info-text">
          <h2 id={titleId} className="qosp-sf-title">
            {storefront.internalName}
          </h2>
          <span className="qosp-code" dir="ltr">
            {storefront.publicId}
          </span>
        </div>
        <PortalBadge tone={badge.tone}>{badge.label}</PortalBadge>
      </div>

      <dl className="qosp-sf-facts">
        <div className="qosp-sf-fact">
          <dt>{copy("factDomain")}</dt>
          <dd>
            {storefront.primaryHostname ? (
              <a
                className="qosp-text-link qosp-sf-domain"
                href={`https://${storefront.primaryHostname}`}
                target="_blank"
                rel="noreferrer"
                dir="ltr"
                aria-label={copy("openDomain", { host: storefront.primaryHostname })}
              >
                <Globe2 size={14} aria-hidden="true" />
                {storefront.primaryHostname}
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            ) : (
              copy("factNoDomain")
            )}
          </dd>
        </div>
        {facts.map((fact) => (
          <div className="qosp-sf-fact" key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </article>
  );
}
