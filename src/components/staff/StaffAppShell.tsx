"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { PortalScene } from "@/components/portal/PortalScene";
import { PortalShellProvider } from "@/components/portal/portal-shell-context";
import { PortalTopBar } from "@/components/portal/PortalTopBar";
import { useAmbientMotion } from "@/components/portal/use-ambient-motion";
import { CommandPalette } from "@/design-system";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffUiCopy } from "@/lib/staff/locale";
import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";
import {
  activeStaffNavIdFromPath,
  staffNavHref,
  STAFF_MORE_NAV_GROUPS,
  STAFF_TOP_NAV,
} from "@/lib/staff/nav";
import {
  fetchStaffSession,
  signOutStaff,
} from "@/lib/staff/staff-session-client";

type StaffAppShellProps = {
  tenantId: string;
  children: ReactNode;
};

function personName(email: string) {
  const local = email.split("@")[0] ?? "";
  if (!local) return "Staff";
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

/* The staff portal shell: the approved 94px header over the fixed portal scene.
   The Overview is full-bleed; every other screen renders on a blurred, quieted
   version of the same scene so its data stays legible. */
export function StaffAppShell({ tenantId, children }: StaffAppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { locale, setLocale } = useStaffLocale();
  const { motion, toggleMotion } = useAmbientMotion();
  const [email, setEmail] = useState("");
  const [memberships, setMemberships] = useState<ActiveStaffMembershipSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");

  const activeId = useMemo(
    () => activeStaffNavIdFromPath(pathname ?? ""),
    [pathname],
  );
  const isOverview = activeId === "home";
  const membership = memberships.find((entry) => entry.tenantId === tenantId);
  const name = personName(email);
  const roleLabel = membership?.role === "administrator" ? "Administrator" : "User";
  const tenantName = membership?.tenantName ?? "QOS";

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
  }

  async function handleSignOut() {
    await signOutStaff();
    router.replace("/staff/sign-in");
  }

  /* The palette moves you around this business. It lists real destinations only;
     record search will arrive with the screens that own those records. */
  const commandGroups = useMemo(() => {
    const term = query.trim().toLowerCase();
    const matches = (label: string) => !term || label.toLowerCase().includes(term);

    const groups = [
      {
        label: "Go to",
        items: STAFF_TOP_NAV.filter((item) => matches(item.label)).map((item) => ({
          id: item.id,
          label: item.label,
          kind: "Screen",
          screen: item.id,
        })),
      },
      ...STAFF_MORE_NAV_GROUPS.map((group) => ({
        label: group.label ?? "More",
        items: group.items
          .filter((item) => matches(item.label))
          .map((item) => ({
            id: item.id,
            label: item.label,
            kind: "Screen",
            screen: item.id,
          })),
      })),
    ];

    return groups.filter((group) => group.items.length > 0);
  }, [query]);

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

  const showOverview = isOverview && ready && !error && Boolean(membership);

  return (
    <PortalShellProvider
      value={{ tenantId, tenantName, personName: name, roleLabel, motion, toggleMotion }}
    >
      <div className="qosp-app" data-portal-surface={showOverview ? "overview" : "workspace"}>
        <PortalScene motion={motion} />
        <PortalTopBar
          tenantId={tenantId}
          tenantName={tenantName}
          tenants={memberships.map((entry) => ({
            id: entry.tenantId,
            name: entry.tenantName,
          }))}
          activeId={activeId}
          personName={name}
          roleLabel={roleLabel}
          locale={locale}
          onToggleLocale={() => setLocale(locale === "en" ? "ar" : "en")}
          onOpenSearch={() => setCommandOpen(true)}
          onSelectTenant={(id) => router.push(`/tenants/${id}`)}
          onSignOut={() => {
            void handleSignOut();
          }}
        />
        {showOverview ? (
          workspace
        ) : (
          <main className="qosp-workspace">
            <div className="qosp-workspace-inner">{workspace}</div>
          </main>
        )}
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
        groups={commandGroups}
      />
    </PortalShellProvider>
  );
}
