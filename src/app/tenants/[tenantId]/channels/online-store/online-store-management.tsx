"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { StorefrontPublishPanel } from "@/app/tenants/[tenantId]/channels/online-store/storefront-publish-panel";
import { StorefrontContentBlocksPanel } from "@/app/tenants/[tenantId]/channels/online-store/storefront-content-blocks-panel";
import { StorefrontThemePanel } from "@/app/tenants/[tenantId]/channels/online-store/storefront-theme-panel";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type StorefrontSummary = {
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
  } | null;
};

type OnlineStoreManagementProps = {
  tenantId: string;
};

export function OnlineStoreManagement({ tenantId }: OnlineStoreManagementProps) {
  const [storefronts, setStorefronts] = useState<StorefrontSummary[]>([]);
  const [selectedPublicId, setSelectedPublicId] = useState<string | null>(null);
  const [isAdministrator, setIsAdministrator] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMembership = useCallback(async () => {
    const response = await staffApiFetch("/api/staff/me/memberships");
    const payload = (await response.json()) as {
      memberships?: Array<{
        tenantId: string;
        role: "administrator" | "user";
      }>;
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load staff membership.");
    }

    const membership = payload.memberships?.find(
      (entry) => entry.tenantId === tenantId,
    );

    setIsAdministrator(membership?.role === "administrator");
  }, [tenantId]);

  const loadStorefronts = useCallback(async () => {
    setError(null);

    const response = await staffApiFetch(`/api/tenants/${tenantId}/storefronts`);
    const payload = (await response.json()) as {
      storefronts?: StorefrontSummary[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? "Unable to load storefronts.");
    }

    const nextStorefronts = payload.storefronts ?? [];
    setStorefronts(nextStorefronts);
    setSelectedPublicId((current) => {
      if (current && nextStorefronts.some((row) => row.publicId === current)) {
        return current;
      }

      return nextStorefronts[0]?.publicId ?? null;
    });
  }, [tenantId]);

  const refresh = useCallback(async () => {
    await Promise.all([loadMembership(), loadStorefronts()]);
  }, [loadMembership, loadStorefronts]);

  const selectedStorefront =
    storefronts.find((storefront) => storefront.publicId === selectedPublicId) ??
    null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() =>
            void refresh().catch((loadError) => {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : "Unable to load online store.",
              );
            })
          }
          className="qos-btn" data-variant="secondary"
        >
          Load online store
        </button>
        <Link
          href={`/tenants/${tenantId}/catalogue/menus`}
          className="qos-btn" data-variant="secondary"
        >
          Manage menus
        </Link>
      </div>

      {error ? (
        <p className="qos-alert" data-tone="error">
          {error}
        </p>
      ) : null}

      {storefronts.length > 1 ? (
        <label className="block text-sm">
          <span className="font-medium text-zinc-700">Storefront</span>
          <select
            className="qos-input"
            value={selectedPublicId ?? ""}
            onChange={(event) => setSelectedPublicId(event.target.value)}
          >
            {storefronts.map((storefront) => (
              <option key={storefront.publicId} value={storefront.publicId}>
                {storefront.internalName} ({storefront.slug})
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {selectedStorefront ? (
        <>
          <StorefrontThemePanel
            tenantId={tenantId}
            storefrontPublicId={selectedStorefront.publicId}
            isAdministrator={isAdministrator}
          />
          <StorefrontContentBlocksPanel
            tenantId={tenantId}
            storefrontPublicId={selectedStorefront.publicId}
            isAdministrator={isAdministrator}
          />
          <StorefrontPublishPanel
            tenantId={tenantId}
            storefront={selectedStorefront}
            isAdministrator={isAdministrator}
            onStorefrontUpdated={loadStorefronts}
          />
        </>
      ) : storefronts.length === 0 ? (
        <p className="rounded-lg border border-zinc-200 bg-zinc-50 px-4 py-3 text-sm text-zinc-600">
          No storefronts found for this tenant yet.
        </p>
      ) : null}
    </div>
  );
}
