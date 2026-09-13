"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { StatusBadge } from "@/components/StatusBadge";
import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";
import { resolveStaffDestinationAfterSignIn } from "@/lib/staff/post-sign-in";
import { fetchStaffSession } from "@/lib/staff/staff-session-client";

export function BusinessPicker() {
  const router = useRouter();
  const [memberships, setMemberships] = useState<
    ActiveStaffMembershipSummary[] | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchStaffSession().then((result) => {
      if (!result.ok) {
        if (result.status === 401) {
          router.replace("/staff/sign-in");
          return;
        }
        setError(result.error);
        setMemberships([]);
        return;
      }

      if (result.data.memberships.length === 1) {
        router.replace(resolveStaffDestinationAfterSignIn(result.data.memberships));
        return;
      }

      setMemberships(result.data.memberships);
    });
  }, [router]);

  if (error) {
    return (
      <div className="qos-alert" data-tone="error" role="alert">
        <div className="qos-alert-body">{error}</div>
      </div>
    );
  }

  if (memberships === null) {
    return <p style={{ color: "var(--text-secondary)" }}>Loading businesses…</p>;
  }

  if (memberships.length === 0) {
    return (
      <div className="qos-empty" data-tone="brand">
        <div className="qos-empty-title">No business access yet</div>
        <p className="qos-empty-body">
          Ask an administrator for an invitation, or request access to an
          existing business.
        </p>
        <a className="qos-btn" data-variant="primary" href="/staff/request-access">
          Request staff access
        </a>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      {memberships.map((membership) => (
        <button
          key={membership.membershipId}
          type="button"
          className="qos-card"
          data-padding="sm"
          data-interactive="true"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            textAlign: "left",
            width: "100%",
          }}
          onClick={() => router.push(`/tenants/${membership.tenantId}`)}
        >
          <span className="qos-avatar" data-size="lg" data-tone="brand">
            {membership.tenantName.slice(0, 1)}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", fontWeight: 600, fontSize: 15 }}>
              {membership.tenantName}
            </span>
            <span
              style={{
                display: "block",
                fontSize: 12,
                color: "var(--text-secondary)",
                textTransform: "capitalize",
              }}
            >
              {membership.role}
            </span>
          </span>
          <StatusBadge state="live" />
        </button>
      ))}
    </div>
  );
}
