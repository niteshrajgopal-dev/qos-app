"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/Icon";
import { LightWave } from "@/components/portal/LightWave";
import {
  overviewActivityTime,
  overviewCopy,
  overviewCount,
  overviewCurrencyLabel,
  overviewDateLine,
  overviewGreeting,
  overviewLocationStatus,
  type OverviewCopyKey,
} from "@/components/portal/overview-copy";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { formatMinorAmount } from "@/lib/staff/overview";
import type { TenantOverview, TenantOverviewBranch } from "@/lib/staff/overview";
import {
  tenantAuditActionLabel,
  tenantAuditEntityLabel,
} from "@/lib/audit/tenant-audit-action-label";
import { staffNavHref } from "@/lib/staff/nav";

type PortalOverviewProps = {
  tenantId: string;
  tenantName: string;
  personName: string;
  motion: boolean;
  onToggleMotion: () => void;
  /** Dev harness: skip API fetch and render with fixture data. */
  layoutPreview?: {
    overview: TenantOverview;
    branches: TenantOverviewBranch[];
  };
};

/* Dock copy and the 3.4s advance are from the approved prototype. */
const DOCK: ReadonlyArray<{
  id: string;
  icon: "receipt" | "package" | "book-open" | "globe";
  title: OverviewCopyKey;
  line: OverviewCopyKey;
}> = [
  { id: "orders", icon: "receipt", title: "dockOrdersTitle", line: "dockOrdersLine" },
  { id: "catalogue", icon: "package", title: "dockCatalogueTitle", line: "dockCatalogueLine" },
  { id: "menus", icon: "book-open", title: "dockMenusTitle", line: "dockMenusLine" },
  { id: "store", icon: "globe", title: "dockStoreTitle", line: "dockStoreLine" },
];

const DOCK_ADVANCE_MS = 3400;

export function PortalOverview({
  tenantId,
  tenantName,
  personName,
  motion,
  onToggleMotion,
  layoutPreview,
}: PortalOverviewProps) {
  const { locale } = useStaffLocale();
  const copy = (key: OverviewCopyKey) => overviewCopy(locale, key);
  const [overview, setOverview] = useState<TenantOverview | null>(
    layoutPreview?.overview ?? null,
  );
  const [branches, setBranches] = useState<TenantOverviewBranch[]>(
    layoutPreview?.branches ?? [],
  );
  const [loadFailed, setLoadFailed] = useState(false);
  const [selected, setSelected] = useState(0);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (layoutPreview) {
      return;
    }

    let cancelled = false;

    staffApiFetch(`/api/tenants/${tenantId}/overview`)
      .then(async (response) => {
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setLoadFailed(true);
          return;
        }

        const payload = (await response.json()) as {
          overview: TenantOverview;
          branches: TenantOverviewBranch[];
        };
        setOverview(payload.overview);
        setBranches(payload.branches);
      })
      .catch(() => {
        if (!cancelled) {
          setLoadFailed(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [layoutPreview, tenantId]);

  useEffect(() => {
    if (held || !motion) {
      return;
    }

    const timer = window.setInterval(() => {
      setSelected((current) => (current + 1) % DOCK.length);
    }, DOCK_ADVANCE_MS);

    return () => window.clearInterval(timer);
  }, [held, motion]);

  const now = useMemo(() => new Date(), []);

  /* Until the request resolves we know nothing, so the panels stay quiet rather
     than claiming a business has no locations or no activity. */
  const loaded = overview !== null;
  const captureRate = overview?.payments.captureRate ?? null;
  const ringOffset =
    captureRate === null ? 433 : 433 - Math.round((captureRate / 100) * 433);
  const menusWaiting = overview ? overview.menus.total - overview.menus.live : 0;
  const storefrontsWaiting = overview
    ? overview.storefronts.total - overview.storefronts.live
    : 0;

  return (
    <>
      <section className="qosp-overview">
        <div className="qosp-hero">
          <p className="qosp-eyebrow">
            <span className="qosp-eyebrow-star" aria-hidden="true">
              ✦
            </span>
            {overviewDateLine(locale, now)}
            <span className="qosp-eyebrow-line" aria-hidden="true" />
          </p>
          <p className="qosp-greeting">
            {overviewGreeting(locale, now.getHours(), "\u2068" + personName + "\u2069")}
          </p>
          <h1>
            {copy("heroTitleLead")}
            <br />
            {copy("heroTitleBefore")}
            <em>{copy("heroTitleEmphasis")}</em>
          </h1>
          <p className="qosp-hero-description">
            {copy("heroDescriptionLead")}
            <br />
            {copy("heroDescriptionTail")}
          </p>
          <div className="qosp-hero-actions">
            <Link
              href={staffNavHref(tenantId, "orders") ?? "#"}
              className="qosp-btn"
              data-variant="primary"
            >
              {copy("manageOrders")}
              <span aria-hidden="true">
                <ArrowUpRight size={16} className="qosp-flip-rtl" />
              </span>
            </Link>
            <Link
              href={staffNavHref(tenantId, "analytics") ?? "#"}
              className="qosp-underlined"
            >
              {copy("viewPerformance")}
              <Icon name="arrow-right" size={13} className="qosp-flip-rtl" />
            </Link>
          </div>
          {menusWaiting > 0 ? (
            <Link
              href={staffNavHref(tenantId, "menus") ?? "#"}
              className="qosp-attention-link"
            >
              <span className="qosp-dot" aria-hidden="true" />
              {overviewCount(locale, "menusNotLive", menusWaiting)}
              <Icon name="arrow-right" size={13} className="qosp-flip-rtl" />
            </Link>
          ) : storefrontsWaiting > 0 ? (
            <Link
              href={staffNavHref(tenantId, "store") ?? "#"}
              className="qosp-attention-link"
            >
              <span className="qosp-dot" aria-hidden="true" />
              {overviewCount(locale, "storefrontsInDraft", storefrontsWaiting)}
              <Icon name="arrow-right" size={13} className="qosp-flip-rtl" />
            </Link>
          ) : null}
        </div>

        <aside className="qosp-rail qosp-glass" aria-label={copy("businessPulse")}>
          <div className="qosp-rail-top">
            <span>{copy("businessPulse")}</span>
            <Icon name="bar-chart-3" size={13} />
          </div>
          <div className="qosp-orbit">
            <svg viewBox="0 0 160 160" aria-hidden="true">
              <defs>
                <linearGradient id="qosp-ring" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0" stopColor="#b3a1ef" />
                  <stop offset="1" stopColor="#eec9b4" />
                </linearGradient>
              </defs>
              <circle className="qosp-orbit-track" cx="80" cy="80" r="69" />
              <circle
                className="qosp-orbit-progress"
                cx="80"
                cy="80"
                r="69"
                style={{ strokeDashoffset: ringOffset }}
              />
            </svg>
            <div>
              {captureRate === null ? (
                <>
                  <strong>—</strong>
                  <small>{copy("noPaymentsYet")}</small>
                </>
              ) : (
                <>
                  <strong dir="ltr">
                    {captureRate}
                    <span>%</span>
                  </strong>
                  <small>{copy("paymentsCaptured")}</small>
                </>
              )}
            </div>
          </div>
          <div className="qosp-rail-revenue" style={{ textAlign: "center" }}>
            <span style={{ fontSize: 12, color: "#c9cbd6" }}>{copy("revenueToday")}</span>
            <strong style={{ display: "block", fontSize: 29, fontWeight: 400 }}>
              <small style={{ fontSize: 12, color: "#c9cbd6" }}>
                {overview ? overviewCurrencyLabel(locale, overview.currency) : ""}
              </small>{" "}
              {overview ? formatMinorAmount(overview.payments.revenueMinorToday) : "—"}
            </strong>
          </div>
          <div className="qosp-rail-split">
            <div>
              <strong>{overview?.payments.capturedToday ?? "—"}</strong>
              <span>{copy("paymentsToday")}</span>
            </div>
            <div>
              <strong dir="ltr">
                {overview?.locations.active ?? "—"}
                <span>/{overview?.locations.total ?? "—"}</span>
              </strong>
              <span>{copy("locationsActive")}</span>
            </div>
          </div>
          <div className="qosp-rail-bottom">
            <span>
              <span>{copy("menusLive")}</span>
              <b dir="ltr">
                {overview?.menus.live ?? 0}/{overview?.menus.total ?? 0}
              </b>
            </span>
            <div className="qosp-rail-bar">
              <i
                style={{
                  width: `${
                    overview && overview.menus.total > 0
                      ? (overview.menus.live / overview.menus.total) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
          </div>
        </aside>

        <p className="qosp-caption" aria-hidden="true">
          <span className="qosp-caption-line" />
          {copy("captionLead")}
          <br />
          {copy("captionTail")}
        </p>

        <nav
          className="qosp-dock"
          data-held={held || undefined}
          aria-label={copy("modules")}
          onMouseLeave={() => setHeld(false)}
        >
          <LightWave />
          {DOCK.map((item, index) => {
            const href = staffNavHref(tenantId, item.id);
            return (
              <Link
                key={item.id}
                href={href ?? "#"}
                className="qosp-dock-item"
                data-index={index}
                data-selected={selected === index || undefined}
                onMouseEnter={() => {
                  setSelected(index);
                  setHeld(true);
                }}
                onFocus={() => {
                  setSelected(index);
                  setHeld(true);
                }}
                onBlur={() => setHeld(false)}
              >
                <span className="qosp-dock-wash" aria-hidden="true" />
                <span className="qosp-dock-icon" aria-hidden="true">
                  <Icon name={item.icon} size={19} />
                </span>
                <span className="qosp-dock-copy">
                  <strong>{copy(item.title)}</strong>
                  <span>{copy(item.line)}</span>
                </span>
                <span className="qosp-dock-arrow" aria-hidden="true">
                  <Icon name="arrow-right" size={15} className="qosp-flip-rtl" />
                </span>
                <small className="qosp-dock-index" aria-hidden="true">
                  0{index + 1}
                </small>
              </Link>
            );
          })}
        </nav>

        <div className="qosp-overview-footer">
          <span>
            <span className="qosp-dot" aria-hidden="true" />
            <bdi>{tenantName}</bdi> · {copy("liveBusinessData")}
          </span>
          <button type="button" onClick={onToggleMotion} aria-pressed={!motion}>
            <Icon name={motion ? "pause" : "play"} size={11} />
            {motion ? copy("motionOn") : copy("motionPaused")}
          </button>
        </div>
      </section>

      <section className="qosp-summary">
        <div className="qosp-section-title">
          <div>
            <p className="qosp-eyebrow">{copy("bigPicture")}</p>
            <h2>{copy("everythingConnected")}</h2>
          </div>
        </div>

        {loadFailed ? (
          <div className="qos-alert" data-tone="error" role="alert">
            <div className="qos-alert-body">{copy("loadError")}</div>
          </div>
        ) : null}

        <div className="qosp-summary-grid">
          <div className="qosp-panel qosp-glass">
            <div className="qosp-panel-heading">
              <h3>{copy("recentActivity")}</h3>
              <Icon name="clock" size={16} />
            </div>
            {overview?.activity.length ? (
              overview.activity.map((event) => (
                <div className="qosp-activity-row" key={event.id}>
                  <span className="qosp-activity-icon" aria-hidden="true">
                    <Icon name="check" size={13} />
                  </span>
                  <span>
                    {tenantAuditActionLabel(event.action, locale)}
                    <small>
                      {tenantAuditEntityLabel(event.entityType, locale)} ·{" "}
                      {overviewActivityTime(locale, new Date(event.occurredAt))}
                    </small>
                  </span>
                </div>
              ))
            ) : loaded ? (
              <p className="qosp-empty">{copy("activityEmpty")}</p>
            ) : null}
          </div>

          <div className="qosp-panel qosp-glass">
            <div className="qosp-panel-heading">
              <h3>{copy("acrossLocations")}</h3>
              <Icon name="map-pin" size={16} />
            </div>
            {branches.length ? (
              branches.map((branch) => (
                <Link
                  key={branch.publicId}
                  className="qosp-branch-row"
                  href={`/tenants/${tenantId}/locations/${branch.publicId}/availability`}
                >
                  <span>
                    <bdi>{branch.name}</bdi>
                    <small dir="ltr">{branch.timezone}</small>
                  </span>
                  <span
                    className="qos-badge"
                    data-tone={branch.status === "active" ? "success" : "neutral"}
                  >
                    {overviewLocationStatus(locale, branch.status)}
                  </span>
                </Link>
              ))
            ) : loaded ? (
              <p className="qosp-empty">{copy("noLocations")}</p>
            ) : null}
          </div>

          <div className="qosp-focus-card qosp-glass">
            <Icon name="book-open" size={26} />
            <p className="qosp-eyebrow">{copy("readyWhenYouAre")}</p>
            <h3>
              {copy("freshMenuLead")}
              <br />
              {copy("freshMenuTail")}
            </h3>
            <p>
              {menusWaiting > 0
                ? overviewCount(locale, "menusInDraft", menusWaiting)
                : copy("allMenusPublished")}
            </p>
            <Link href={staffNavHref(tenantId, "menus") ?? "#"} className="qosp-text-button">
              {copy("openMenus")}
              <Icon name="arrow-right" size={14} className="qosp-flip-rtl" />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
