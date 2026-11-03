"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BookOpen, Plus, RefreshCw, ShieldCheck } from "lucide-react";

import {
  formatMenuDate,
  menusCopy,
  menusCount,
} from "@/app/tenants/[tenantId]/catalogue/menus/menus-copy";
import {
  PortalArea,
  PortalBadge,
  PortalNotice,
  PortalPageHeader,
  PortalPanel,
  type PortalBadgeTone,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { Button } from "@/design-system";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import type { StaffLocale } from "@/lib/staff/locale";

export type MenuSummary = {
  publicId: string;
  internalName: string;
  displayName: string;
  status: "draft" | "active" | "archived";
  version: number;
  publishedVersion: number | null;
  isLive: boolean;
  hasUnpublishedChanges: boolean;
  sectionCount: number;
  itemCount: number;
  locationIds: string[];
  translations?: { ar?: { displayName?: string | null } };
  updatedAt: string;
};

type MenuManagementProps = {
  tenantId: string;
};

export function menuStatusBadge(
  locale: StaffLocale,
  menu: Pick<MenuSummary, "isLive" | "status">,
): { tone: PortalBadgeTone; label: string } {
  if (menu.isLive) {
    return { tone: "positive", label: menusCopy(locale, "menuStatusLive") };
  }
  if (menu.status === "archived") {
    return { tone: "neutral", label: menusCopy(locale, "menuStatusArchived") };
  }
  return { tone: "warm", label: menusCopy(locale, "menuStatusDraft") };
}

/** Facts for one menu card, all read from the staff menu list response. */
export function menuCardFacts(locale: StaffLocale, menu: MenuSummary) {
  const hasArabicName = Boolean(menu.translations?.ar?.displayName?.trim());
  const draftValue = menusCopy(locale, "menuVersionValue", { version: menu.version });

  return {
    summary: [
      menusCount(locale, "sections", menu.sectionCount),
      menusCount(locale, "items", menu.itemCount),
      menusCopy(locale, hasArabicName ? "menuLanguagesBoth" : "menuLanguagesEnglishOnly"),
    ].join(" · "),
    rows: [
      {
        label: menusCopy(locale, "menuLiveVersion"),
        value:
          menu.isLive && menu.publishedVersion !== null
            ? menusCopy(locale, "menuVersionValue", { version: menu.publishedVersion })
            : menusCopy(locale, "menuNotPublished"),
      },
      {
        label: menusCopy(locale, "menuDraftRow"),
        value: menu.isLive
          ? `${draftValue} · ${menusCopy(
              locale,
              menu.hasUnpublishedChanges ? "menuUnpublishedChanges" : "menuMatchesLive",
            )}`
          : draftValue,
      },
      {
        label: menusCopy(locale, "menuLocationsRow"),
        value: menusCount(locale, "locations", menu.locationIds.length),
      },
    ],
  };
}

export function menuCardName(locale: StaffLocale, menu: MenuSummary) {
  const arabicName = locale === "ar" ? menu.translations?.ar?.displayName?.trim() : "";
  return arabicName || menu.displayName || menu.internalName;
}

export function MenuManagement({ tenantId }: MenuManagementProps) {
  const router = useRouter();
  const { locale } = useStaffLocale();
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const loadMenus = useCallback(async () => {
    const response = await staffApiFetch(`/api/tenants/${tenantId}/catalogue/menus`);
    const payload = (await response.json()) as {
      menus?: MenuSummary[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? menusCopy(locale, "unableToLoadMenus"));
    }

    setError(null);
    setMenus(payload.menus ?? []);
    setLoaded(true);
  }, [locale, tenantId]);

  const reportLoadError = useCallback(
    (loadError: unknown) => {
      setError(
        loadError instanceof Error ? loadError.message : menusCopy(locale, "unableToLoadMenus"),
      );
      setLoaded(true);
    },
    [locale],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMenus().catch(reportLoadError);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadMenus, reportLoadError]);

  const newMenuHref = `/tenants/${tenantId}/catalogue/menus/new`;

  return (
    <PortalArea>
      <PortalPageHeader
        title={menusCopy(locale, "menusHeadline")}
        description={menusCopy(locale, "menusDescription")}
        actions={
          <>
            <Button variant="secondary" onClick={() => void loadMenus().catch(reportLoadError)}>
              <RefreshCw size={16} aria-hidden="true" />
              {menusCopy(locale, "reload")}
            </Button>
            <Button onClick={() => router.push(newMenuHref)}>
              <Plus size={16} aria-hidden="true" />
              {menusCopy(locale, "createMenu")}
            </Button>
          </>
        }
      />

      {error ? (
        <div className="qosp-stack">
          <PortalNotice tone="error">{error}</PortalNotice>
        </div>
      ) : null}

      {!loaded ? (
        <PortalPanel>
          <p className="qosp-meta-line" role="status">
            {menusCopy(locale, "loadingMenus")}
          </p>
        </PortalPanel>
      ) : menus.length === 0 ? (
        error ? null : (
          <PortalPanel className="qosp-empty-panel">
            <BookOpen size={36} strokeWidth={1.2} aria-hidden="true" />
            <h2>{menusCopy(locale, "noMenusTitle")}</h2>
            <p>{menusCopy(locale, "noMenusBody")}</p>
            <Button onClick={() => router.push(newMenuHref)}>
              <Plus size={16} aria-hidden="true" />
              {menusCopy(locale, "createMenu")}
            </Button>
          </PortalPanel>
        )
      ) : (
        <ul className="qosp-menu-grid" aria-label={menusCopy(locale, "menusListLabel")}>
          {menus.map((menu, index) => {
            const badge = menuStatusBadge(locale, menu);
            const facts = menuCardFacts(locale, menu);
            const name = menuCardName(locale, menu);
            return (
              <li key={menu.publicId} className="qosp-menu-card qosp-glass">
                <div className="qosp-menu-card-top">
                  <span
                    className="qosp-menu-icon"
                    data-variant={index % 2 === 1 ? "alt" : undefined}
                    aria-hidden="true"
                  >
                    <BookOpen size={24} strokeWidth={1.4} />
                  </span>
                  <PortalBadge tone={badge.tone}>{badge.label}</PortalBadge>
                </div>
                <p className="qosp-product-meta">
                  {menusCopy(locale, "menuUpdated", {
                    date: formatMenuDate(locale, menu.updatedAt),
                  })}
                </p>
                <h2 className="qosp-menu-card-title" id={`menu-title-${menu.publicId}`}>
                  {name}
                </h2>
                <p className="qosp-menu-card-sub">{facts.summary}</p>
                <dl className="qosp-menu-facts">
                  {facts.rows.map((row) => (
                    <div key={row.label} className="qosp-menu-fact">
                      <dt>{row.label}</dt>
                      <dd>{row.value}</dd>
                    </div>
                  ))}
                </dl>
                <Link
                  href={`/tenants/${tenantId}/catalogue/menus/${menu.publicId}/edit`}
                  className="qos-btn"
                  data-variant="secondary"
                  data-full="true"
                  aria-describedby={`menu-title-${menu.publicId}`}
                >
                  {menusCopy(locale, "manageMenu")}
                  <ArrowUpRight size={15} aria-hidden="true" className="qosp-flip-rtl" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {loaded && menus.length > 0 ? (
        <p className="qosp-notice qosp-menus-notice" role="note">
          <ShieldCheck size={16} aria-hidden="true" />
          {menusCopy(locale, "publishPolicyNotice")}
        </p>
      ) : null}
    </PortalArea>
  );
}
