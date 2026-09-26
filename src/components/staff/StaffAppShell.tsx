"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { MobilePlatform } from "@/components/platform/mobile-platform";
import {
  Avatar,
  Badge,
  CommandPalette,
  IconButton,
  Logo,
  SideNav,
  TenantSwitcher,
  TopBar,
} from "@/design-system";
import type { SideNavProps } from "@/design-system";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffUiCopy } from "@/lib/staff/locale";
import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";
import { activeStaffNavIdFromPath, staffNavHref } from "@/lib/staff/nav";
import { NAV } from "@/mocks/platform";
import {
  fetchStaffSession,
  signOutStaff,
} from "@/lib/staff/staff-session-client";

type StaffAppShellProps = {
  tenantId: string;
  children: ReactNode;
};

type ThemeName = "light" | "dark";

function personName(email: string) {
  const local = email.split("@")[0] ?? "";
  if (!local) return "Staff";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function shellGroups(): NonNullable<SideNavProps["groups"]> {
  return NAV.map((group) => ({
    label: group.label,
    items: group.items.map((item) => {
      if (item.id === "catalogue") {
        const children =
          "children" in item && item.children ? item.children : [];
        return {
          ...item,
          children: [...children, { id: "import", label: "Import" }],
        };
      }
      if (item.id === "team") {
        return {
          ...item,
          children: [
            { id: "team", label: "Members" },
            { id: "access", label: "Access requests" },
            { id: "audit", label: "Audit" },
          ],
        };
      }
      return item;
    }),
  }));
}

export function StaffAppShell({ tenantId, children }: StaffAppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, setLocale } = useStaffLocale();
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<ActiveStaffMembershipSummary[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState<ThemeName>(() => {
    if (typeof window === "undefined") return "light";
    const storedTheme = localStorage.getItem("qos-theme");
    if (storedTheme === "dark" || storedTheme === "light") {
      return storedTheme;
    }
    return "light";
  });
  const [collapsed, setCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    const storedNav = localStorage.getItem("qos-nav-collapsed");
    return storedNav != null ? storedNav === "1" : window.innerWidth < 1180;
  });
  const [viewport, setViewport] = useState(() => (typeof window === "undefined" ? 1440 : window.innerWidth));

  const narrow = viewport < 1180;
  const phone = viewport < 768;
  const navOverlay = phone && !collapsed;
  const activeId = useMemo(
    () => activeStaffNavIdFromPath(pathname ?? ""),
    [pathname],
  );
  const membership = memberships.find((entry) => entry.tenantId === tenantId);
  const name = personName(email);
  const roleLabel =
    membership?.role === "administrator" ? "Administrator" : "User";

  useEffect(() => {
    const onResize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStaffSession().then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        if (result.status === 401) {
          router.replace("/staff/sign-in");
          return;
        }
        setError(result.error);
        setReady(true);
        return;
      }
      setEmail(result.data.email);
      setMemberships(result.data.memberships);
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setCommandOpen(true);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function go(id: string) {
    const href = staffNavHref(tenantId, id);
    if (href) router.push(href);
    if (phone) setCollapsed(true);
  }

  function toggleNav() {
    setCollapsed((current) => {
      localStorage.setItem("qos-nav-collapsed", current ? "0" : "1");
      return !current;
    });
  }

  function toggleTheme() {
    setTheme((current) => {
      const next = current === "dark" ? "light" : "dark";
      localStorage.setItem("qos-theme", next);
      return next;
    });
  }

  async function handleSignOut() {
    await signOutStaff();
    router.replace("/staff/sign-in");
  }

  const tenants = memberships.map((entry) => ({
    id: entry.tenantId,
    name: entry.tenantName,
  }));

  const workspace = !ready ? (
    <p style={{ color: "var(--text-secondary)" }}>
      {staffUiCopy(locale, "loadingWorkspace")}
    </p>
  ) : error ? (
    <div className="qos-alert" data-tone="error" role="alert">
      <div>
        <div className="qos-alert-title">Unable to load staff workspace</div>
        <div className="qos-alert-body">{error}</div>
      </div>
    </div>
  ) : !membership ? (
    <div className="qos-alert" data-tone="warning" role="status">
      <div>
        <div className="qos-alert-title">No access to this business</div>
        <div className="qos-alert-body">
          Your staff account does not have an active membership here.
        </div>
      </div>
    </div>
  ) : (
    children
  );

  if (phone && ready && membership && !error) {
    return (
      <div
        data-qos-theme={theme}
        style={{
          height: "100vh",
          overflow: "auto",
          background: "var(--surface-canvas)",
          color: "var(--text-primary)",
        }}
      >
        <MobilePlatform theme={theme} />
      </div>
    );
  }

  return (
    <div
      data-qos-theme={theme}
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--surface-canvas)",
        color: "var(--text-primary)",
      }}
    >
      <div
        style={{
          display: "flex",
          flex: "none",
          width: phone ? "var(--layout-nav-width-collapsed)" : undefined,
          position: "relative",
          zIndex: 30,
        }}
      >
        <div
          style={{
            display: "flex",
            height: "100%",
            position: navOverlay ? "absolute" : "relative",
            top: 0,
            left: 0,
            boxShadow: navOverlay ? "var(--shadow-xl)" : "none",
          }}
        >
          <SideNav
            collapsed={collapsed}
            brand={
              collapsed ? (
                <img
                  src="/brand/app-icon.png"
                  alt="QOS"
                  style={{ width: 28, height: 28, borderRadius: 8, display: "block" }}
                />
              ) : (
                <Logo variant={theme === "dark" ? "navy" : "light"} height={17} />
              )
            }
            groups={shellGroups()}
            activeId={activeId}
            onNavigate={go}
            footer={
              collapsed ? (
                <button
                  type="button"
                  className="qos-nav-item"
                  title={name}
                  onClick={() => {
                    void handleSignOut();
                  }}
                  style={{ height: 40, justifyContent: "center" }}
                >
                  <Avatar name={name} size="sm" />
                </button>
              ) : (
                <button
                  type="button"
                  className="qos-nav-item"
                  onClick={() => {
                    void handleSignOut();
                  }}
                  style={{ height: 40 }}
                >
                  <Avatar name={name} size="sm" />
                  <span style={{ flex: 1, minWidth: 0, textAlign: "left", lineHeight: 1.2 }}>
                    {name}
                    <span
                      style={{
                        display: "block",
                        fontSize: 10,
                        color: "var(--text-tertiary)",
                        fontWeight: 400,
                      }}
                    >
                      {roleLabel}
                    </span>
                  </span>
                </button>
              )
            }
          />
        </div>
      </div>
      {navOverlay ? (
        <div
          onClick={() => setCollapsed(true)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(11,15,26,.48)",
            zIndex: 20,
          }}
        />
      ) : null}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <TopBar>
          <IconButton
            icon={collapsed ? "panel-left-open" : "panel-left-close"}
            label={collapsed ? "Expand navigation" : "Collapse navigation"}
            onClick={toggleNav}
          />
          <TenantSwitcher
            tenants={tenants.length ? tenants : [{ id: tenantId, name: "QOS" }]}
            value={tenantId}
            onChange={(id) => router.push(`/tenants/${id}`)}
          />
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            style={{
              flex: 1,
              minWidth: 0,
              maxWidth: 380,
              height: 34,
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "0 12px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-default)",
              background: "var(--surface-subtle)",
              color: "var(--text-placeholder)",
              fontSize: 13,
              cursor: "pointer",
              overflow: "hidden",
            }}
          >
            <span
              className="qos-badge"
              style={{
                border: "none",
                background: "none",
                padding: 0,
                color: "var(--text-tertiary)",
                flex: "none",
              }}
            >
              ⌕
            </span>
            {phone ? null : (
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "left",
                }}
              >
                Search businesses, orders, products, locations…
              </span>
            )}
            {narrow ? null : (
              <span className="qos-kbd" style={{ flex: "none" }}>
                ⌘K
              </span>
            )}
          </button>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            {narrow ? null : (
              <Badge tone="processing" dot pulse>
                Development
              </Badge>
            )}
            <IconButton
              icon={theme === "dark" ? "sun" : "moon"}
              label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              onClick={toggleTheme}
            />
            <button
              type="button"
              className="qos-btn"
              data-variant="ghost"
              data-size="sm"
              onClick={() => setLocale(locale === "en" ? "ar" : "en")}
            >
              {locale === "en" ? "العربية" : "English"}
            </button>
            {phone ? null : <IconButton icon="circle-help" label="Help" />}
            <span style={{ position: "relative", display: "inline-flex" }}>
              <IconButton icon="bell" label="Notifications" />
              <span
                style={{
                  position: "absolute",
                  top: 5,
                  right: 5,
                  width: 7,
                  height: 7,
                  borderRadius: 999,
                  background: "var(--status-error-solid)",
                  border: "1.5px solid var(--surface-default)",
                }}
              />
            </span>
            <Avatar name={name} size="sm" />
          </div>
        </TopBar>
        <main style={{ flex: 1, overflow: "auto" }}>
          <div
            style={{
              maxWidth: "var(--layout-canvas-max)",
              minWidth: phone ? 720 : undefined,
              margin: "0 auto",
              padding: "24px var(--layout-gutter) 64px",
            }}
          >
            {workspace}
          </div>
        </main>
      </div>
      <CommandPalette
        open={commandOpen}
        query={query}
        onQueryChange={setQuery}
        onClose={() => setCommandOpen(false)}
        onSelect={(item) => {
          setCommandOpen(false);
          if (item && typeof item === "object" && "screen" in item && item.screen) {
            go(String(item.screen));
          }
        }}
        groups={[
          {
            label: "Suggested by QOS Intelligence",
            items: [
              {
                id: "ai1",
                label: "9 orders failed to reach Lightspeed",
                meta: "Marina Walk · since 14:02",
                kind: "Anomaly",
                intelligence: true,
                screen: "orders",
              },
            ],
          },
          {
            label: "Orders",
            items: [
              {
                id: "o1",
                label: "QO-10428 · A. Rahman",
                meta: "Online Store · 184.00 AED",
                kind: "Order",
                icon: "receipt",
                screen: "orders",
              },
              {
                id: "o2",
                label: "QO-10427 · L. Fernandes",
                meta: "POS · 62.50 AED",
                kind: "Order",
                icon: "receipt",
                screen: "orders",
              },
            ],
          },
          {
            label: "Catalogue",
            items: [
              {
                id: "p1",
                label: "Flat white",
                meta: "Coffee · 3 variants",
                kind: "Product",
                icon: "package",
                screen: "catalogue",
              },
              {
                id: "p2",
                label: "Main menu",
                meta: "6 sections · 84 items",
                kind: "Menu",
                icon: "book-open",
                screen: "catalogue",
              },
            ],
          },
          {
            label: "Locations",
            items: [
              {
                id: "l1",
                label: "Marina Walk",
                meta: "Integration error",
                kind: "Location",
                icon: "map-pin",
                screen: "locations",
              },
            ],
          },
        ]}
      />
    </div>
  );
}
