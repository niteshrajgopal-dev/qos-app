"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/Icon";
import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";
import {
  fetchStaffSession,
  signOutStaff,
} from "@/lib/staff/staff-session-client";

type StaffAppShellPrototypeProps = {
  tenantId: string;
  children: ReactNode;
};

type NavItem = {
  id: string;
  label: string;
  path: string;
};

const PRIMARY_NAV: NavItem[] = [
  { id: "overview", label: "Overview", path: "" },
  { id: "orders", label: "Orders", path: "/orders" },
  { id: "catalogue", label: "Catalogue", path: "/catalogue" },
  { id: "menus", label: "Menus", path: "/catalogue/menus" },
  { id: "storefronts", label: "Storefronts", path: "/channels/online-store" },
];

const MORE_NAV: NavItem[] = [
  { id: "inventory", label: "Inventory", path: "/locations" },
  { id: "finance", label: "Finance", path: "/analytics" },
  { id: "integrations", label: "Integrations", path: "/integrations" },
  { id: "branches", label: "Branches", path: "/locations" },
  { id: "settings", label: "Settings", path: "/settings" },
];

const SEARCH_DESTINATIONS = [
  ...PRIMARY_NAV,
  ...MORE_NAV,
];

function personName(email: string) {
  const local = email.split("@")[0] ?? "";
  if (!local) return "Staff";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function initials(email: string) {
  const local = email.split("@")[0] ?? "";
  return local.slice(0, 2).toUpperCase() || "QO";
}

export function StaffAppShellPrototype({
  tenantId,
  children,
}: StaffAppShellPrototypeProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<ActiveStaffMembershipSummary[]>(
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);

  const membership = memberships.find((entry) => entry.tenantId === tenantId);
  const name = personName(email);
  const roleLabel =
    membership?.role === "administrator" ? "Administrator" : "User";

  const tenantPrefix = `/tenants/${tenantId}`;
  const currentPath = pathname?.slice(tenantPrefix.length) || "";
  
  const activeNavId = PRIMARY_NAV.find((item) => {
    if (item.path === "" && currentPath === "") return true;
    if (item.path !== "" && currentPath.startsWith(item.path)) return true;
    return false;
  })?.id || MORE_NAV.find((item) => {
    if (item.path !== "" && currentPath.startsWith(item.path)) return true;
    return false;
  })?.id;

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
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationsOpen(false);
        setWorkspaceSwitcherOpen(false);
        setMoreOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  function navigate(path: string) {
    router.push(`${tenantPrefix}${path}`);
    setSearchOpen(false);
    setMoreOpen(false);
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
    <p style={{ color: "var(--text-secondary)", padding: "24px" }}>
      Loading workspace…
    </p>
  ) : error ? (
    <div
      style={{
        padding: "24px",
        background: "var(--status-error-bg)",
        border: "1px solid var(--status-error-border)",
        borderRadius: "var(--radius-lg)",
        color: "var(--status-error-fg)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        Unable to load staff workspace
      </div>
      <div>{error}</div>
    </div>
  ) : !membership ? (
    <div
      style={{
        padding: "24px",
        background: "var(--status-warning-bg)",
        border: "1px solid var(--status-warning-border)",
        borderRadius: "var(--radius-lg)",
        color: "var(--status-warning-fg)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        No access to this business
      </div>
      <div>Your staff account does not have an active membership here.</div>
    </div>
  ) : (
    children
  );

  return (
    <div
      data-qos-theme="dark"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--surface-canvas)",
        color: "var(--text-primary)",
        fontFamily: "var(--font-sans)",
      }}
    >
      {/* Header */}
      <header
        style={{
          display: "flex",
          alignItems: "center",
          gap: 24,
          height: 60,
          padding: "0 24px",
          borderBottom: "1px solid var(--border-subtle)",
          background: "var(--surface-default)",
          flexShrink: 0,
        }}
      >
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            QOS
          </div>
          <div
            style={{
              fontSize: 11,
              color: "var(--text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            WORKSPACE
          </div>
        </div>

        {/* Primary Nav */}
        <nav style={{ display: "flex", gap: 4, marginLeft: 16 }}>
          {PRIMARY_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                color:
                  activeNavId === item.id
                    ? "var(--text-primary)"
                    : "var(--text-secondary)",
                background:
                  activeNavId === item.id ? "var(--surface-selected)" : "transparent",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (activeNavId !== item.id) {
                  e.currentTarget.style.background = "var(--surface-hover)";
                  e.currentTarget.style.color = "var(--text-primary)";
                }
              }}
              onMouseLeave={(e) => {
                if (activeNavId !== item.id) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }
              }}
            >
              {item.label}
            </button>
          ))}

          {/* More Dropdown */}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setMoreOpen(!moreOpen)}
              style={{
                padding: "8px 16px",
                fontSize: 13,
                fontWeight: 500,
                color: moreOpen ? "var(--text-primary)" : "var(--text-secondary)",
                background: moreOpen ? "var(--surface-selected)" : "transparent",
                border: "none",
                borderRadius: "var(--radius-md)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 4,
                transition: "all 0.15s ease",
              }}
              onMouseEnter={(e) => {
                if (!moreOpen) {
                  e.currentTarget.style.background = "var(--surface-hover)";
                  e.currentTarget.style.color = "var(--text-primary)";
                }
              }}
              onMouseLeave={(e) => {
                if (!moreOpen) {
                  e.currentTarget.style.background = "transparent";
                  e.currentTarget.style.color = "var(--text-secondary)";
                }
              }}
            >
              More
              <Icon name="chevron-down" size={14} />
            </button>

            {moreOpen && (
              <div
                style={{
                  position: "absolute",
                  top: "calc(100% + 4px)",
                  left: 0,
                  minWidth: 180,
                  background: "var(--surface-overlay)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-lg)",
                  boxShadow: "var(--shadow-xl)",
                  padding: "8px",
                  zIndex: 50,
                }}
              >
                {MORE_NAV.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => navigate(item.path)}
                    style={{
                      width: "100%",
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      padding: "10px 12px",
                      fontSize: 14,
                      fontWeight: 500,
                      color:
                        activeNavId === item.id
                          ? "var(--text-primary)"
                          : "var(--text-secondary)",
                      background:
                        activeNavId === item.id
                          ? "var(--surface-selected)"
                          : "transparent",
                      border: "none",
                      borderRadius: "var(--radius-md)",
                      cursor: "pointer",
                      textAlign: "left",
                      transition: "all 0.15s ease",
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "var(--surface-hover)";
                      e.currentTarget.style.color = "var(--text-primary)";
                    }}
                    onMouseLeave={(e) => {
                      if (activeNavId !== item.id) {
                        e.currentTarget.style.background = "transparent";
                        e.currentTarget.style.color = "var(--text-secondary)";
                      } else {
                        e.currentTarget.style.background = "var(--surface-selected)";
                      }
                    }}
                  >
                    {item.label}
                    <Icon
                      name="arrow-right"
                      size={14}
                      style={{ marginLeft: "auto", opacity: 0.6 }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        </nav>

        {/* Right Controls */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          {/* Search */}
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: "var(--surface-subtle)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-tertiary)",
              fontSize: 13,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = "var(--border-strong)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--border-default)";
            }}
          >
            <Icon name="search" size={14} />
            <span>Search workspace</span>
            <kbd
              style={{
                fontSize: 11,
                padding: "2px 6px",
                background: "var(--surface-default)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "4px",
              }}
            >
              ⌘K
            </kbd>
          </button>

          {/* Notifications */}
          <button
            type="button"
            onClick={() => setNotificationsOpen(true)}
            style={{
              position: "relative",
              width: 36,
              height: 36,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "transparent",
              border: "none",
              borderRadius: "var(--radius-md)",
              color: "var(--text-secondary)",
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "var(--text-secondary)";
            }}
          >
            <Icon name="bell" size={18} />
            <span
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                width: 6,
                height: 6,
                background: "var(--status-error-solid)",
                borderRadius: "50%",
                border: "1.5px solid var(--surface-default)",
              }}
            />
          </button>

          {/* Workspace Switcher */}
          <button
            type="button"
            onClick={() => setWorkspaceSwitcherOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 12px",
              background: "transparent",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              color: "var(--text-secondary)",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--surface-hover)";
              e.currentTarget.style.borderColor = "var(--border-strong)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.borderColor = "var(--border-default)";
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "var(--surface-brand)",
                borderRadius: "4px",
                fontSize: 10,
                fontWeight: 600,
                color: "var(--text-on-brand)",
              }}
            >
              Q
            </div>
            <span>{membership?.tenantName || "Quotes"}</span>
          </button>

          {/* Profile */}
          <button
            type="button"
            onClick={() => void handleSignOut()}
            style={{
              width: 32,
              height: 32,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "var(--surface-brand)",
              border: "none",
              borderRadius: "50%",
              color: "var(--text-on-brand)",
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              transition: "all 0.15s ease",
            }}
            title={name}
          >
            {initials(email)}
          </button>
        </div>
      </header>

      {/* Main Content */}
      <main
        style={{
          flex: 1,
          overflow: "auto",
          background: "var(--surface-canvas)",
        }}
      >
        {workspace}
      </main>

      {/* Search Overlay */}
      {searchOpen && (
        <>
          <div
            onClick={() => setSearchOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "var(--surface-scrim)",
              zIndex: 100,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: "20%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "90%",
              maxWidth: 600,
              background: "var(--surface-overlay)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-xl)",
              padding: "32px",
              zIndex: 101,
            }}
          >
            <h2
              style={{
                fontSize: 32,
                fontWeight: 600,
                fontFamily: "var(--font-display)",
                marginBottom: 8,
                letterSpacing: "-0.02em",
              }}
            >
              Find your next move.
            </h2>
            <p
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                marginBottom: 24,
              }}
            >
              Search modules, orders and products.
            </p>

            <div
              style={{
                position: "relative",
                marginBottom: 24,
              }}
            >
              <Icon
                name="search"
                size={16}
                style={{
                  position: "absolute",
                  left: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: "var(--text-tertiary)",
                }}
              />
              <input
                type="text"
                placeholder="Try orders, menus or latte…"
                autoFocus
                style={{
                  width: "100%",
                  padding: "12px 14px 12px 42px",
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-lg)",
                  color: "var(--text-primary)",
                  fontSize: 14,
                  outline: "none",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-focus)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-default)";
                }}
              />
              <kbd
                style={{
                  position: "absolute",
                  right: 14,
                  top: "50%",
                  transform: "translateY(-50%)",
                  fontSize: 11,
                  padding: "2px 6px",
                  background: "var(--surface-default)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "4px",
                  color: "var(--text-tertiary)",
                }}
              >
                ⌘ K
              </kbd>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {SEARCH_DESTINATIONS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.path)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "12px 14px",
                    background: "transparent",
                    border: "none",
                    borderRadius: "var(--radius-md)",
                    color: "var(--text-primary)",
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: "pointer",
                    textAlign: "left",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "var(--surface-hover)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span>{item.label}</span>
                  <Icon name="arrow-right" size={14} style={{ opacity: 0.5 }} />
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Notifications Panel */}
      {notificationsOpen && (
        <>
          <div
            onClick={() => setNotificationsOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "var(--surface-scrim)",
              zIndex: 100,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: "20%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "90%",
              maxWidth: 600,
              background: "var(--surface-overlay)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-xl)",
              padding: "32px",
              zIndex: 101,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 24,
              }}
            >
              <h2
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  fontFamily: "var(--font-display)",
                  letterSpacing: "-0.02em",
                }}
              >
                Your attention, please.
              </h2>
              <button
                type="button"
                onClick={() => setNotificationsOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                }}
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            <p
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                marginBottom: 24,
              }}
            >
              QOS · Interactive design prototype
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div
                style={{
                  padding: "16px",
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-lg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "start",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--surface-default)",
                      borderRadius: "var(--radius-md)",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="receipt" size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        marginBottom: 4,
                      }}
                    >
                      4 orders need attention
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary)",
                        marginBottom: 12,
                      }}
                    >
                      Review orders in progress.
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate("/orders")}
                      style={{
                        padding: "6px 12px",
                        background: "var(--action-secondary)",
                        border: "none",
                        borderRadius: "var(--radius-md)",
                        color: "var(--text-primary)",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      Review orders
                      <Icon
                        name="arrow-right"
                        size={14}
                        style={{ marginLeft: 6, display: "inline-block" }}
                      />
                    </button>
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "16px",
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-lg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "start",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--surface-default)",
                      borderRadius: "var(--radius-md)",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="book-open" size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        marginBottom: 4,
                      }}
                    >
                      Menu draft ready for review
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary)",
                        marginBottom: 12,
                      }}
                    >
                      Check Arabic content before publishing.
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate("/catalogue/menus")}
                      style={{
                        padding: "6px 12px",
                        background: "var(--action-secondary)",
                        border: "none",
                        borderRadius: "var(--radius-md)",
                        color: "var(--text-primary)",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      Review menus
                      <Icon
                        name="arrow-right"
                        size={14}
                        style={{ marginLeft: 6, display: "inline-block" }}
                      />
                    </button>
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: "16px",
                  background: "var(--surface-subtle)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-lg)",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "start",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--surface-default)",
                      borderRadius: "var(--radius-md)",
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="package" size={18} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        marginBottom: 4,
                      }}
                    >
                      Materials running low
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary)",
                        marginBottom: 12,
                      }}
                    >
                      Review minimum stock levels.
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate("/locations")}
                      style={{
                        padding: "6px 12px",
                        background: "var(--action-secondary)",
                        border: "none",
                        borderRadius: "var(--radius-md)",
                        color: "var(--text-primary)",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      Review inventory
                      <Icon
                        name="arrow-right"
                        size={14}
                        style={{ marginLeft: 6, display: "inline-block" }}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Workspace Switcher */}
      {workspaceSwitcherOpen && (
        <>
          <div
            onClick={() => setWorkspaceSwitcherOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              background: "var(--surface-scrim)",
              zIndex: 100,
            }}
          />
          <div
            style={{
              position: "fixed",
              top: "20%",
              left: "50%",
              transform: "translateX(-50%)",
              width: "90%",
              maxWidth: 480,
              background: "var(--surface-overlay)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-xl)",
              boxShadow: "var(--shadow-xl)",
              padding: "32px",
              zIndex: 101,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 24,
              }}
            >
              <h2
                style={{
                  fontSize: 32,
                  fontWeight: 600,
                  fontFamily: "var(--font-display)",
                  letterSpacing: "-0.02em",
                }}
              >
                Your workspace
              </h2>
              <button
                type="button"
                onClick={() => setWorkspaceSwitcherOpen(false)}
                style={{
                  width: 32,
                  height: 32,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "transparent",
                  border: "none",
                  borderRadius: "var(--radius-md)",
                  color: "var(--text-tertiary)",
                  cursor: "pointer",
                }}
              >
                <Icon name="x" size={20} />
              </button>
            </div>

            <p
              style={{
                fontSize: 14,
                color: "var(--text-secondary)",
                marginBottom: 24,
              }}
            >
              QOS · Interactive design prototype
            </p>

            {tenants.map((tenant) => (
              <div
                key={tenant.id}
                style={{
                  padding: "16px",
                  background:
                    tenant.id === tenantId
                      ? "var(--surface-selected)"
                      : "var(--surface-subtle)",
                  border: "1px solid var(--border-default)",
                  borderRadius: "var(--radius-lg)",
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "start",
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      background: "var(--surface-brand)",
                      borderRadius: "var(--radius-md)",
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--text-on-brand)",
                      flexShrink: 0,
                    }}
                  >
                    Q
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 16,
                        fontWeight: 600,
                        marginBottom: 4,
                      }}
                    >
                      {tenant.name}
                    </div>
                    <div
                      style={{
                        fontSize: 13,
                        color: "var(--text-secondary)",
                      }}
                    >
                      3 branches · {roleLabel}
                    </div>
                  </div>
                  {tenant.id === tenantId && (
                    <div
                      style={{
                        padding: "4px 10px",
                        background: "var(--status-success-bg)",
                        border: "1px solid var(--status-success-border)",
                        borderRadius: "var(--radius-md)",
                        color: "var(--status-success-fg)",
                        fontSize: 12,
                        fontWeight: 600,
                      }}
                    >
                      Selected
                    </div>
                  )}
                </div>
              </div>
            ))}

            <p
              style={{
                fontSize: 13,
                color: "var(--text-tertiary)",
                marginTop: 16,
                lineHeight: 1.5,
              }}
            >
              This prototype contains the Quotes sample workspace. Tenant switching
              will use authenticated QOS memberships.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
