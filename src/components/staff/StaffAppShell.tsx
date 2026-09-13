"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Badge } from "@/components/Badge";
import { Button } from "@/components/Button";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { StaffSideNav } from "@/components/staff/StaffSideNav";
import { staffUiCopy } from "@/lib/staff/locale";
import { activeStaffNavIdFromPath } from "@/lib/staff/nav";
import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";
import {
  fetchStaffSession,
  signOutStaff,
} from "@/lib/staff/staff-session-client";

type StaffAppShellProps = {
  tenantId: string;
  children: ReactNode;
};

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

  const membership = memberships.find((entry) => entry.tenantId === tenantId);
  const activeId = useMemo(
    () => activeStaffNavIdFromPath(pathname ?? ""),
    [pathname],
  );

  useEffect(() => {
    let cancelled = false;

    fetchStaffSession().then((result) => {
      if (cancelled) {
        return;
      }

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

  async function handleSignOut() {
    await signOutStaff();
    router.replace("/staff/sign-in");
  }

  return (
    <div
      data-qos-theme="light"
      style={{
        display: "flex",
        height: "100vh",
        overflow: "hidden",
        background: "var(--surface-canvas)",
        color: "var(--text-primary)",
      }}
    >
      <StaffSideNav
        tenantId={tenantId}
        activeId={activeId}
        email={email}
        role={membership?.role ?? null}
        onSignOut={() => {
          void handleSignOut();
        }}
      />
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        <header className="qos-topbar">
          {memberships.length > 1 ? (
            <a
              href="/staff/businesses"
              className="qos-btn"
              data-variant="secondary"
              data-size="sm"
            >
              {membership?.tenantName ?? staffUiCopy(locale, "chooseBusiness")}
            </a>
          ) : (
            <span style={{ fontSize: "var(--text-body-sm-size)", fontWeight: 600 }}>
              {membership?.tenantName ?? "QOS"}
            </span>
          )}
          <div style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 6 }}>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocale(locale === "en" ? "ar" : "en")}
            >
              {locale === "en" ? "العربية" : "English"}
            </Button>
            <Badge tone="processing" dot pulse>
              {staffUiCopy(locale, "development")}
            </Badge>
          </div>
        </header>
        <main style={{ flex: 1, overflowY: "auto" }}>
          <div
            style={{
              maxWidth: "var(--layout-canvas-max)",
              margin: "0 auto",
              padding: "24px var(--layout-gutter) 64px",
            }}
          >
            {!ready ? (
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
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
