"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import { Icon } from "@/components/Icon";
import { LightWave } from "@/components/portal/LightWave";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { formatMinorAmount } from "@/lib/staff/overview";
import type { TenantOverview, TenantOverviewBranch } from "@/lib/staff/overview";
import { staffNavHref } from "@/lib/staff/nav";

type PortalOverviewProps = {
  tenantId: string;
  tenantName: string;
  personName: string;
  motion: boolean;
  onToggleMotion: () => void;
};

/* Dock copy and the 3.4s advance are from the approved prototype. */
const DOCK = [
  { id: "orders", icon: "receipt", title: "Orders", line: "Keep every order moving." },
  { id: "catalogue", icon: "package", title: "Catalogue", line: "Curate your offering." },
  { id: "menus", icon: "book-open", title: "Menus", line: "Make every menu yours." },
  { id: "store", icon: "globe", title: "Storefronts", line: "Bring your brand to life." },
] as const;

const DOCK_ADVANCE_MS = 3400;

function greetingFor(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function auditActionLabel(action: string) {
  const [, verb] = action.split(".").slice(-2);
  return action
    .replace(/[._]/g, " ")
    .replace(/^\w/, (character) => character.toUpperCase())
    .concat(verb ? "" : "");
}

export function PortalOverview({
  tenantId,
  tenantName,
  personName,
  motion,
  onToggleMotion,
}: PortalOverviewProps) {
  const [overview, setOverview] = useState<TenantOverview | null>(null);
  const [branches, setBranches] = useState<TenantOverviewBranch[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    let cancelled = false;

    staffApiFetch(`/api/tenants/${tenantId}/overview`)
      .then(async (response) => {
        if (cancelled) {
          return;
        }

        if (!response.ok) {
          setError("Unable to load this business overview.");
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
          setError("Unable to load this business overview.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [tenantId]);

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
  const dateLine = now
    .toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })
    .toUpperCase();

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
            {dateLine}
            <span className="qosp-eyebrow-line" aria-hidden="true" />
          </p>
          <p className="qosp-greeting">
            {greetingFor(now.getHours())}, {personName}.
          </p>
          <h1>
            Your business.
            <br />
            In <em>perspective.</em>
          </h1>
          <p className="qosp-hero-description">
            Every order, every location, every detail.
            <br />
            A clear view of what&rsquo;s next.
          </p>
          <div className="qosp-hero-actions">
            <Link
              href={staffNavHref(tenantId, "orders") ?? "#"}
              className="qosp-btn"
              data-variant="primary"
            >
              Manage orders
              <span aria-hidden="true">
                <Icon name="arrow-right" size={15} />
              </span>
            </Link>
            <Link
              href={staffNavHref(tenantId, "analytics") ?? "#"}
              className="qosp-underlined"
            >
              View performance
              <Icon name="arrow-right" size={13} />
            </Link>
          </div>
          {menusWaiting > 0 ? (
            <Link
              href={staffNavHref(tenantId, "menus") ?? "#"}
              className="qosp-attention-link"
            >
              <span className="qosp-dot" aria-hidden="true" />
              {menusWaiting} menu{menusWaiting === 1 ? "" : "s"} not live yet
              <Icon name="arrow-right" size={13} />
            </Link>
          ) : storefrontsWaiting > 0 ? (
            <Link
              href={staffNavHref(tenantId, "store") ?? "#"}
              className="qosp-attention-link"
            >
              <span className="qosp-dot" aria-hidden="true" />
              {storefrontsWaiting} storefront{storefrontsWaiting === 1 ? "" : "s"} still
              in draft
              <Icon name="arrow-right" size={13} />
            </Link>
          ) : null}
        </div>

        <aside className="qosp-rail qosp-glass" aria-label="Business pulse">
          <div className="qosp-rail-top">
            <span>BUSINESS PULSE</span>
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
                  <small>no payments yet</small>
                </>
              ) : (
                <>
                  <strong>
                    {captureRate}
                    <span>%</span>
                  </strong>
                  <small>of payments captured</small>
                </>
              )}
            </div>
          </div>
          <div className="qosp-rail-revenue" style={{ textAlign: "center" }}>
            <span style={{ fontSize: 12, color: "#c9cbd6" }}>Revenue today</span>
            <strong style={{ display: "block", fontSize: 29, fontWeight: 400 }}>
              <small style={{ fontSize: 12, color: "#c9cbd6" }}>
                {overview?.currency ?? ""}
              </small>{" "}
              {overview ? formatMinorAmount(overview.payments.revenueMinorToday) : "—"}
            </strong>
          </div>
          <div className="qosp-rail-split">
            <div>
              <strong>{overview?.payments.capturedToday ?? "—"}</strong>
              <span>Payments today</span>
            </div>
            <div>
              <strong>
                {overview?.locations.active ?? "—"}
                <span>/{overview?.locations.total ?? "—"}</span>
              </strong>
              <span>Locations active</span>
            </div>
          </div>
          <div className="qosp-rail-bottom">
            <span>
              <span>Menus live</span>
              <b>
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
          ONE WORKSPACE
          <br />
          EVERY POSSIBILITY
        </p>

        <nav
          className="qosp-dock"
          data-held={held || undefined}
          aria-label="Modules"
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
                  <strong>{item.title}</strong>
                  <span>{item.line}</span>
                </span>
                <span className="qosp-dock-arrow" aria-hidden="true">
                  <Icon name="arrow-right" size={15} />
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
            {tenantName.toUpperCase()} · LIVE BUSINESS DATA
          </span>
          <button type="button" onClick={onToggleMotion} aria-pressed={!motion}>
            <Icon name={motion ? "pause" : "play"} size={11} />
            {motion ? "Ambient motion" : "Motion paused"}
          </button>
        </div>
      </section>

      <section className="qosp-summary">
        <div className="qosp-section-title">
          <div>
            <p className="qosp-eyebrow">THE BIG PICTURE</p>
            <h2>Everything, connected.</h2>
          </div>
        </div>

        {error ? (
          <div className="qos-alert" data-tone="error" role="alert">
            <div className="qos-alert-body">{error}</div>
          </div>
        ) : null}

        <div className="qosp-summary-grid">
          <div className="qosp-panel qosp-glass">
            <div className="qosp-panel-heading">
              <h3>Recent activity</h3>
              <Icon name="clock" size={16} />
            </div>
            {overview?.activity.length ? (
              overview.activity.map((event) => (
                <div className="qosp-activity-row" key={event.id}>
                  <span className="qosp-activity-icon" aria-hidden="true">
                    <Icon name="check" size={13} />
                  </span>
                  <span>
                    {auditActionLabel(event.action)}
                    <small>
                      {event.entityType.replace(/_/g, " ")} ·{" "}
                      {new Date(event.occurredAt).toLocaleString("en-GB", {
                        day: "numeric",
                        month: "short",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </span>
                </div>
              ))
            ) : loaded ? (
              <p className="qosp-empty">
                The audit trail is visible to administrators. Nothing to show here yet.
              </p>
            ) : null}
          </div>

          <div className="qosp-panel qosp-glass">
            <div className="qosp-panel-heading">
              <h3>Across your locations</h3>
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
                    {branch.name}
                    <small>{branch.timezone}</small>
                  </span>
                  <span
                    className="qos-badge"
                    data-tone={branch.status === "active" ? "success" : "neutral"}
                  >
                    {branch.status}
                  </span>
                </Link>
              ))
            ) : loaded ? (
              <p className="qosp-empty">No locations yet.</p>
            ) : null}
          </div>

          <div className="qosp-focus-card qosp-glass">
            <Icon name="book-open" size={26} />
            <p className="qosp-eyebrow">READY WHEN YOU ARE</p>
            <h3>
              A fresh menu.
              <br />
              One release away.
            </h3>
            <p>
              {menusWaiting > 0
                ? `${menusWaiting} menu${menusWaiting === 1 ? " is" : "s are"} still in draft, ready to publish when you are.`
                : "Every menu in this business is published."}
            </p>
            <Link href={staffNavHref(tenantId, "menus") ?? "#"} className="qosp-text-button">
              Open menus
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
