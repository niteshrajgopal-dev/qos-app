"use client";

import Link from "next/link";
import { useMemo } from "react";

import { Icon } from "@/components/Icon";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { StaffWordmark } from "@/components/staff/StaffWordmark";
import { staffNavLabel, staffUiCopy, type StaffLocale } from "@/lib/staff/locale";
import {
  STAFF_NAV_GROUPS,
  staffNavHref,
  type StaffNavItem,
} from "@/lib/staff/nav";

type StaffSideNavProps = {
  tenantId: string;
  activeId: string;
  email: string;
  role: "administrator" | "user" | null;
  onSignOut: () => void;
};

function initials(email: string) {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "QO";
}

function NavRow({
  item,
  tenantId,
  activeId,
  open,
  locale,
}: {
  item: StaffNavItem;
  tenantId: string;
  activeId: string;
  open?: boolean;
  locale: StaffLocale;
}) {
  const href = staffNavHref(tenantId, item.id);
  const hasChildren = Boolean(item.children?.length);
  const childActive = item.children?.some((child) => child.id === activeId);
  const selected = activeId === item.id || Boolean(childActive && !open);
  const ready = item.availability === "ready" && href;

  const content = (
    <>
      {item.icon ? <Icon name={item.icon} size={16} /> : null}
      <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}>
        {staffNavLabel(locale, item.id, item.label)}
      </span>
      {item.availability === "soon" ? (
        <span className="qos-nav-item-count">{staffUiCopy(locale, "soon")}</span>
      ) : null}
      {hasChildren ? (
        <Icon
          name={open ? "chevron-down" : locale === "ar" ? "chevron-left" : "chevron-right"}
          size={13}
          style={{ color: "var(--text-tertiary)" }}
        />
      ) : null}
    </>
  );

  if (!ready) {
    return (
      <button
        type="button"
        className="qos-nav-item"
        aria-disabled="true"
        disabled
        title={staffUiCopy(locale, "soon")}
      >
        {content}
      </button>
    );
  }

  return (
    <Link
      href={href}
      className="qos-nav-item"
      data-selected={selected || undefined}
    >
      {content}
    </Link>
  );
}

export function StaffSideNav({
  tenantId,
  activeId,
  email,
  role,
  onSignOut,
}: StaffSideNavProps) {
  const { locale } = useStaffLocale();
  const open = useMemo(() => {
    const next: Record<string, boolean> = {};
    for (const group of STAFF_NAV_GROUPS) {
      for (const item of group.items) {
        if (
          item.id === activeId ||
          item.children?.some((child) => child.id === activeId)
        ) {
          next[item.id] = true;
        }
      }
    }
    return next;
  }, [activeId]);

  return (
    <nav className="qos-sidenav" aria-label="Staff">
      <div className="qos-sidenav-brand">
        <StaffWordmark height={17} />
      </div>
      <div className="qos-sidenav-scroll">
        {STAFF_NAV_GROUPS.map((group, groupIndex) => (
          <div key={group.label ?? groupIndex}>
            {group.label ? (
              <div className="qos-nav-group-label">
                {group.label === "Commerce"
                  ? staffUiCopy(locale, "commerce")
                  : group.label === "Platform"
                    ? staffUiCopy(locale, "platform")
                    : group.label}
              </div>
            ) : null}
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {group.items.map((item) => {
                const isOpen = Boolean(open[item.id]);
                return (
                  <div key={`${item.id}-${item.label}`}>
                    <NavRow
                      item={item}
                      tenantId={tenantId}
                      activeId={activeId}
                      open={isOpen}
                      locale={locale}
                    />
                    {item.children && isOpen ? (
                      <div className="qos-nav-sub">
                        {item.children.map((child) => (
                          <NavRow
                            key={`${child.id}-${child.label}`}
                            item={child}
                            tenantId={tenantId}
                            activeId={activeId}
                            locale={locale}
                          />
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      <div style={{ padding: "var(--space-3)", borderTop: "1px solid var(--border-subtle)" }}>
        <div className="qos-nav-item" style={{ height: 40, cursor: "default" }}>
          <span className="qos-avatar" data-size="sm" data-tone="brand">
            {initials(email)}
          </span>
          <span style={{ flex: 1, minWidth: 0, textAlign: "start", lineHeight: 1.2 }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
              {email}
            </span>
            <span
              style={{
                display: "block",
                fontSize: 10,
                color: "var(--text-tertiary)",
                fontWeight: 400,
                textTransform: "capitalize",
              }}
            >
              {role ?? "Staff"}
            </span>
          </span>
        </div>
        <button type="button" className="qos-nav-item" onClick={onSignOut}>
          <Icon name="log-out" size={16} />
          <span>{staffUiCopy(locale, "signOut")}</span>
        </button>
      </div>
    </nav>
  );
}
