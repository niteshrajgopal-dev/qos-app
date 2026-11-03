"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BookOpen, RefreshCw, Store } from "lucide-react";

import { StorefrontContentBlocksPanel } from "@/app/tenants/[tenantId]/channels/online-store/storefront-content-blocks-panel";
import { StorefrontOverviewCard } from "@/app/tenants/[tenantId]/channels/online-store/storefront-overview-card";
import { StorefrontPublishPanel } from "@/app/tenants/[tenantId]/channels/online-store/storefront-publish-panel";
import { StorefrontThemePanel } from "@/app/tenants/[tenantId]/channels/online-store/storefront-theme-panel";
import type {
  ContentBlocksPreview,
  StorefrontSummary,
  ThemeDraft,
} from "@/app/tenants/[tenantId]/channels/online-store/storefront-view";
import {
  storefrontsCopy,
  type StorefrontsCopyKey,
} from "@/app/tenants/[tenantId]/channels/online-store/storefronts-copy";
import {
  PortalArea,
  PortalField,
  PortalNotice,
  PortalPageHeader,
  PortalPanel,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import type { StaffLocale } from "@/lib/staff/locale";

type OnlineStoreManagementProps = {
  tenantId: string;
};

async function fetchIsAdministrator(tenantId: string, locale: StaffLocale) {
  const response = await staffApiFetch("/api/staff/me/memberships");
  const payload = (await response.json()) as {
    memberships?: Array<{
      tenantId: string;
      role: "administrator" | "user";
    }>;
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? storefrontsCopy(locale, "unableToLoadMembership"));
  }

  const membership = payload.memberships?.find(
    (entry) => entry.tenantId === tenantId,
  );

  return membership?.role === "administrator";
}

async function fetchStorefronts(tenantId: string, locale: StaffLocale) {
  const response = await staffApiFetch(`/api/tenants/${tenantId}/storefronts`);
  const payload = (await response.json()) as {
    storefronts?: StorefrontSummary[];
    error?: string;
  };

  if (!response.ok) {
    throw new Error(payload.error ?? storefrontsCopy(locale, "unableToLoadStorefronts"));
  }

  return payload.storefronts ?? [];
}

export function OnlineStoreManagement({ tenantId }: OnlineStoreManagementProps) {
  const { locale } = useStaffLocale();
  const copy = (key: StorefrontsCopyKey, values?: Record<string, string | number>) =>
    storefrontsCopy(locale, key, values);
  const [storefronts, setStorefronts] = useState<StorefrontSummary[]>([]);
  const [selectedPublicId, setSelectedPublicId] = useState<string | null>(null);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [themePreview, setThemePreview] = useState<ThemeDraft | null>(null);
  const [contentPreview, setContentPreview] = useState<ContentBlocksPreview | null>(null);

  const applyStorefronts = useCallback((nextStorefronts: StorefrontSummary[]) => {
    setError(null);
    setStorefronts(nextStorefronts);
    setSelectedPublicId((current) => {
      if (current && nextStorefronts.some((row) => row.publicId === current)) {
        return current;
      }

      return nextStorefronts[0]?.publicId ?? null;
    });
  }, []);

  const loadStorefronts = useCallback(async () => {
    applyStorefronts(await fetchStorefronts(tenantId, locale));
  }, [applyStorefronts, locale, tenantId]);

  const refresh = useCallback(async () => {
    const [administrator, nextStorefronts] = await Promise.all([
      fetchIsAdministrator(tenantId, locale),
      fetchStorefronts(tenantId, locale),
    ]);
    setIsAdministrator(administrator);
    applyStorefronts(nextStorefronts);
  }, [applyStorefronts, locale, tenantId]);

  useEffect(() => {
    let cancelled = false;

    Promise.all([fetchIsAdministrator(tenantId, locale), fetchStorefronts(tenantId, locale)])
      .then(([administrator, nextStorefronts]) => {
        if (!cancelled) {
          setIsAdministrator(administrator);
          applyStorefronts(nextStorefronts);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : storefrontsCopy(locale, "unableToLoadOnlineStore"),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [applyStorefronts, locale, tenantId]);

  const selectedStorefront =
    storefronts.find((storefront) => storefront.publicId === selectedPublicId) ??
    null;

  return (
    <PortalArea>
      <PortalPageHeader
        back={{ href: `/tenants/${tenantId}/channels`, label: copy("backToChannels") }}
        title={copy("headline")}
        description={copy("description")}
        actions={
          <>
            <button
              type="button"
              onClick={() =>
                void refresh().catch((loadError) => {
                  setError(
                    loadError instanceof Error
                      ? loadError.message
                      : copy("unableToLoadOnlineStore"),
                  );
                })
              }
              className="qos-btn"
              data-variant="secondary"
            >
              <RefreshCw size={16} aria-hidden="true" />
              {copy("refresh")}
            </button>
            <Link
              href={`/tenants/${tenantId}/catalogue/menus`}
              className="qos-btn"
              data-variant="secondary"
            >
              <BookOpen size={16} aria-hidden="true" />
              {copy("manageMenus")}
            </Link>
          </>
        }
      />

      <div className="qosp-sf-layout">
        {error ? <PortalNotice tone="error">{error}</PortalNotice> : null}

        {storefronts.length > 1 ? (
          <div className="qosp-sf-picker">
            <PortalField label={copy("storefrontPicker")}>
              <select
                className="qos-select"
                value={selectedPublicId ?? ""}
                onChange={(event) => {
                  setThemePreview(null);
                  setContentPreview(null);
                  setSelectedPublicId(event.target.value);
                }}
              >
                {storefronts.map((storefront) => (
                  <option key={storefront.publicId} value={storefront.publicId}>
                    {copy("storefrontOption", {
                      name: storefront.internalName,
                      slug: storefront.slug,
                    })}
                  </option>
                ))}
              </select>
            </PortalField>
          </div>
        ) : null}

        {!loaded && !error ? (
          <PortalPanel>
            <p className="qosp-meta-line" role="status">
              {copy("loadingStorefronts")}
            </p>
          </PortalPanel>
        ) : null}

        {selectedStorefront ? (
          <>
            <div className="qosp-sf-grid">
              <StorefrontOverviewCard
                locale={locale}
                storefront={selectedStorefront}
                theme={themePreview}
                content={contentPreview}
              />
              <StorefrontPublishPanel
                key={`publish-${selectedStorefront.publicId}`}
                tenantId={tenantId}
                storefront={selectedStorefront}
                isAdministrator={isAdministrator}
                onStorefrontUpdated={loadStorefronts}
              />
            </div>
            <StorefrontThemePanel
              key={`theme-${selectedStorefront.publicId}`}
              tenantId={tenantId}
              storefrontPublicId={selectedStorefront.publicId}
              isAdministrator={isAdministrator}
              onDraftChange={setThemePreview}
            />
            <StorefrontContentBlocksPanel
              key={`blocks-${selectedStorefront.publicId}`}
              tenantId={tenantId}
              storefrontPublicId={selectedStorefront.publicId}
              isAdministrator={isAdministrator}
              onDraftChange={setContentPreview}
            />
          </>
        ) : loaded && !error && storefronts.length === 0 ? (
          <PortalPanel className="qosp-empty-panel">
            <Store size={28} aria-hidden="true" />
            <p>{copy("noStorefronts")}</p>
          </PortalPanel>
        ) : null}
      </div>
    </PortalArea>
  );
}
