"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { StatusBadge } from "@/components/StatusBadge";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";

type TenantHomeProps = {
  tenantId: string;
  membership: ActiveStaffMembershipSummary | null;
};

type MenuSummary = {
  publicId: string;
  displayName: string;
  isLive: boolean;
  itemCount: number;
};

type StorefrontSummary = {
  publicId: string;
  internalName: string;
  status: "draft" | "active" | "archived";
  primaryHostname: string | null;
};

type LocationSummary = {
  publicId: string;
  name: string;
};

export function TenantHome({ tenantId, membership }: TenantHomeProps) {
  const [menus, setMenus] = useState<MenuSummary[]>([]);
  const [storefronts, setStorefronts] = useState<StorefrontSummary[]>([]);
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const [menusResponse, storefrontsResponse, locationsResponse] =
        await Promise.all([
          staffApiFetch(`/api/tenants/${tenantId}/catalogue/menus`),
          staffApiFetch(`/api/tenants/${tenantId}/storefronts`),
          staffApiFetch(`/api/tenants/${tenantId}/staff/locations`),
        ]);

      if (cancelled) {
        return;
      }

      if (!menusResponse.ok || !storefrontsResponse.ok) {
        setError("Unable to load this business workspace.");
        return;
      }

      const menusPayload = (await menusResponse.json()) as {
        menus?: MenuSummary[];
      };
      const storefrontsPayload = (await storefrontsResponse.json()) as {
        storefronts?: StorefrontSummary[];
      };

      setMenus(menusPayload.menus ?? []);
      setStorefronts(storefrontsPayload.storefronts ?? []);

      if (locationsResponse.ok) {
        const locationsPayload = (await locationsResponse.json()) as {
          locations?: LocationSummary[];
        };
        setLocations(locationsPayload.locations ?? []);
      }
    }

    void load();

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

  const tenantName = membership?.tenantName ?? "this business";

  return (
    <div style={{ display: "grid", gap: "var(--space-7)" }}>
      <div className="qos-pagehead">
        <div>
          <h1 className="qos-pagetitle">Welcome back</h1>
          <p className="qos-pagesub">
            {tenantName}
            {locations.length ? ` · ${locations.length} locations` : ""}.
            Catalogue, checkout, and storefront records are live; POS devices
            and catalogue categories are not modeled yet.
          </p>
        </div>
      </div>

      {error ? (
        <div className="qos-alert" data-tone="error" role="alert">
          <div className="qos-alert-body">{error}</div>
        </div>
      ) : null}

      <section>
        <h2 className="qos-card-title" style={{ marginBottom: 12 }}>
          Continue
        </h2>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
            gap: 16,
          }}
        >
          <Link
            href={`/tenants/${tenantId}/catalogue/products/new`}
            className="qos-card"
            data-padding="sm"
            data-interactive="true"
          >
            <strong>New draft product</strong>
            <p className="qos-card-sub">Create EN and AR copy, then approve translations.</p>
          </Link>
          <Link
            href={`/tenants/${tenantId}/catalogue/menus`}
            className="qos-card"
            data-padding="sm"
            data-interactive="true"
          >
            <strong>Menus</strong>
            <p className="qos-card-sub">
              {menus.length
                ? `${menus.length} menu${menus.length === 1 ? "" : "s"} in draft or live.`
                : "Add a menu and publish it to a Quotes location."}
            </p>
          </Link>
          <Link
            href={`/tenants/${tenantId}/channels/online-store`}
            className="qos-card"
            data-padding="sm"
            data-interactive="true"
          >
            <strong>Online Store</strong>
            <p className="qos-card-sub">
              Assign the menu and publish a storefront release.
            </p>
          </Link>
          <Link
            href={`/tenants/${tenantId}/catalogue/import`}
            className="qos-card"
            data-padding="sm"
            data-interactive="true"
          >
            <strong>Catalogue import</strong>
            <p className="qos-card-sub">Preview and apply a catalogue file.</p>
          </Link>
        </div>
      </section>

      <section
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
          gap: 16,
        }}
      >
        <div className="qos-card" data-padding="none">
          <div className="qos-card-head">
            <div>
              <div className="qos-card-title">Menus</div>
              <div className="qos-card-sub">Published state is real, not a dashboard mock.</div>
            </div>
          </div>
          {menus.length === 0 ? (
            <div className="qos-empty">
              <div className="qos-empty-title">No menus yet</div>
              <p className="qos-empty-body">Create a draft menu to start the Quotes publish path.</p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {menus.map((menu) => (
                <li key={menu.publicId}>
                  <Link
                    href={`/tenants/${tenantId}/catalogue/menus/${menu.publicId}/edit`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: "11px var(--card-padding)",
                      borderBottom: "1px solid var(--border-subtle)",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontWeight: 500 }}>
                        {menu.displayName}
                      </span>
                      <span className="qos-card-sub">
                        {menu.itemCount} item{menu.itemCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <StatusBadge state={menu.isLive ? "live" : "draft"} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="qos-card" data-padding="none">
          <div className="qos-card-head">
            <div>
              <div className="qos-card-title">Storefronts</div>
              <div className="qos-card-sub">Quotes is Customer #1 on this platform.</div>
            </div>
          </div>
          {storefronts.length === 0 ? (
            <div className="qos-empty">
              <div className="qos-empty-title">No storefronts</div>
              <p className="qos-empty-body">Online Store will appear here after onboarding.</p>
            </div>
          ) : (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {storefronts.map((storefront) => (
                <li
                  key={storefront.publicId}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "11px var(--card-padding)",
                    borderBottom: "1px solid var(--border-subtle)",
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", fontWeight: 500 }}>
                      {storefront.internalName}
                    </span>
                    <span className="qos-card-sub">
                      {storefront.primaryHostname ?? "No hostname"}
                    </span>
                  </span>
                  <StatusBadge state={storefront.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {locations.length ? (
        <section>
          <h2 className="qos-card-title" style={{ marginBottom: 12 }}>
            Locations
          </h2>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              gap: 16,
            }}
          >
            {locations.map((location) => (
              <Link
                key={location.publicId}
                href={`/tenants/${tenantId}/locations/${location.publicId}/availability`}
                className="qos-card"
                data-padding="sm"
                data-interactive="true"
              >
                <strong>{location.name}</strong>
                <p className="qos-card-sub">Hours, exceptions, and stop-sales</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
