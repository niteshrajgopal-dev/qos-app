"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Icon } from "@/components/Icon";
import {
  isStaffMoreNavId,
  staffNavHref,
  STAFF_MORE_NAV_GROUPS,
  STAFF_TOP_NAV,
} from "@/lib/staff/nav";

type PortalTopBarProps = {
  tenantId: string;
  tenantName: string;
  tenants: Array<{ id: string; name: string }>;
  activeId: string;
  personName: string;
  roleLabel: string;
  locale: "en" | "ar";
  onToggleLocale: () => void;
  onOpenSearch: () => void;
  onSelectTenant: (tenantId: string) => void;
  onSignOut: () => void;
};

/* The approved 94px header: white QOS mark with WORKSPACE beneath it, five
   destinations centred with More, then search, notifications, the business
   picker and the profile. */
export function PortalTopBar({
  tenantId,
  tenantName,
  tenants,
  activeId,
  personName,
  roleLabel,
  locale,
  onToggleLocale,
  onOpenSearch,
  onSelectTenant,
  onSignOut,
}: PortalTopBarProps) {
  const [openMenu, setOpenMenu] = useState<"more" | "workspace" | "profile" | null>(
    null,
  );
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!openMenu) {
      return;
    }

    function onPointerDown(event: PointerEvent) {
      if (!headerRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpenMenu(null);
      }
    }

    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openMenu]);

  const initial = (tenantName.trim()[0] ?? "Q").toUpperCase();
  const initials = personName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();

  return (
    <header className="qosp-topbar" ref={headerRef}>
      <Link
        href={staffNavHref(tenantId, "home") ?? "/"}
        className="qosp-brand"
        aria-label="QOS workspace overview"
      >
        {/* Brand geometry is unchanged; the white treatment is a CSS filter. */}
        <Image src="/brand/qos-logo-original.png" alt="QOS" width={126} height={42} priority />
        <span>WORKSPACE</span>
      </Link>

      <nav className="qosp-nav" aria-label="Primary">
        {STAFF_TOP_NAV.map((item) => {
          const href = staffNavHref(tenantId, item.id);
          if (!href) {
            return null;
          }

          return (
            <Link
              key={item.id}
              href={href}
              className="qosp-nav-link"
              data-active={activeId === item.id || undefined}
            >
              {item.label}
            </Link>
          );
        })}
        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="qosp-nav-link"
            data-active={isStaffMoreNavId(activeId) || undefined}
            aria-haspopup="menu"
            aria-expanded={openMenu === "more"}
            onClick={() => setOpenMenu(openMenu === "more" ? null : "more")}
          >
            More
            <Icon name="chevron-down" size={14} />
          </button>
          {openMenu === "more" ? (
            <div
              className="qos-menu"
              role="menu"
              style={{ top: 46, insetInlineStart: "50%", transform: "translateX(-50%)" }}
            >
              {STAFF_MORE_NAV_GROUPS.map((group) => (
                <div key={group.label}>
                  <div className="qos-cmd-group">{group.label}</div>
                  {group.items.map((item) => {
                    const href = staffNavHref(tenantId, item.id);
                    if (!href) {
                      return null;
                    }

                    return (
                      <Link
                        key={item.id}
                        href={href}
                        role="menuitem"
                        className="qos-menu-item"
                        data-selected={activeId === item.id || undefined}
                        onClick={() => setOpenMenu(null)}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </nav>

      <div className="qosp-top-actions">
        <button
          type="button"
          className="qosp-search-trigger"
          onClick={onOpenSearch}
          aria-label="Search this business"
        >
          <Icon name="search" size={15} />
          <kbd>⌘K</kbd>
        </button>
        <button
          type="button"
          className="qosp-icon-button qosp-notification"
          aria-label="Notifications"
        >
          <Icon name="alert-circle" size={17} />
          <i aria-hidden="true" />
        </button>
        <span className="qosp-top-divider" aria-hidden="true" />

        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="qosp-workspace-picker"
            aria-haspopup="listbox"
            aria-expanded={openMenu === "workspace"}
            onClick={() => setOpenMenu(openMenu === "workspace" ? null : "workspace")}
          >
            <span className="qosp-workspace-avatar" aria-hidden="true">
              {initial}
            </span>
            <span>
              {tenantName}
              <Icon name="chevron-down" size={14} />
            </span>
          </button>
          {openMenu === "workspace" ? (
            <div
              className="qos-menu"
              role="listbox"
              style={{ top: 44, insetInlineEnd: 0, minWidth: 260 }}
            >
              <div className="qos-cmd-group">Switch business</div>
              {tenants.map((tenant) => (
                <button
                  key={tenant.id}
                  type="button"
                  role="option"
                  aria-selected={tenant.id === tenantId}
                  className="qos-menu-item"
                  data-selected={tenant.id === tenantId || undefined}
                  onClick={() => {
                    setOpenMenu(null);
                    onSelectTenant(tenant.id);
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0 }}>{tenant.name}</span>
                  {tenant.id === tenantId ? <Icon name="check" size={14} /> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div style={{ position: "relative" }}>
          <button
            type="button"
            className="qosp-avatar"
            aria-haspopup="menu"
            aria-expanded={openMenu === "profile"}
            aria-label={`${personName}, ${roleLabel}`}
            onClick={() => setOpenMenu(openMenu === "profile" ? null : "profile")}
          >
            {initials || "QO"}
          </button>
          {openMenu === "profile" ? (
            <div
              className="qos-menu"
              role="menu"
              style={{ top: 44, insetInlineEnd: 0, minWidth: 220 }}
            >
              <div className="qos-cmd-group">
                {personName} · {roleLabel}
              </div>
              <button
                type="button"
                role="menuitem"
                className="qos-menu-item"
                onClick={() => {
                  setOpenMenu(null);
                  onToggleLocale();
                }}
              >
                <Icon name="globe" size={15} />
                <span style={{ flex: 1 }}>
                  {locale === "en" ? "العربية" : "English"}
                </span>
              </button>
              <div className="qos-menu-sep" />
              <button
                type="button"
                role="menuitem"
                className="qos-menu-item"
                onClick={() => {
                  setOpenMenu(null);
                  onSignOut();
                }}
              >
                <Icon name="log-out" size={15} />
                <span style={{ flex: 1 }}>Sign out</span>
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </header>
  );
}
