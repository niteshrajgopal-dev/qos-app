"use client";

import { useRouter } from "next/navigation";
import React from "react";

import { Grid } from "@/components/platform/layout";
import { useStaffResource } from "@/components/staff/use-staff-resource";
import { Alert, Card, EmptyState, Icon, PageHeader, SkeletonText, StatusBadge } from "@/design-system";

type StorefrontSummary = {
  publicId: string;
  internalName: string;
  slug: string;
  status: "draft" | "active" | "archived";
  draftVersion: number;
  primaryHostname: string | null;
  activeRelease: {
    releasePublicId: string;
    releaseVersion: number;
    publishedAt: string;
    publishedBySubject: string;
  } | null;
};

const DATE_TIME_FORMAT = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
      <span style={{ color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value}</span>
    </span>
  );
}

function storefrontState(storefront: StorefrontSummary) {
  if (storefront.status === "archived") return "archived";
  return storefront.activeRelease ? "live" : "draft";
}

export function ChannelsScreen({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const { data, error, loading } = useStaffResource<{ storefronts: StorefrontSummary[] }>(
    `/api/tenants/${tenantId}/storefronts`,
    "Unable to load sales channels.",
  );
  const storefronts = data?.storefronts ?? [];

  return (
    <>
      <PageHeader
        title="Sales Channels"
        subtitle="Every channel consumes the same catalogue and location configuration from QOS."
      />
      <div style={{ marginTop: 20 }}>
        {error ? (
          <Alert tone="error" title="Sales channels unavailable">{error}</Alert>
        ) : loading ? (
          <Card><SkeletonText lines={4} /></Card>
        ) : (
          <Grid cols={3}>
            {storefronts.map((s) => (
              <Card key={s.publicId} padding="none" interactive onClick={() => router.push(`/tenants/${tenantId}/channels/online-store`)}>
                <div style={{ padding: "var(--card-padding)", display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span style={{ width: 36, height: 36, borderRadius: "var(--radius-md)", background: "var(--surface-subtle)", display: "grid", placeItems: "center", color: "var(--text-secondary)", flex: "none" }}><Icon name="store" size={17} /></span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <strong style={{ fontSize: 15, fontWeight: 600 }}>{s.internalName}</strong>
                      <StatusBadge state={storefrontState(s)} />
                    </span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>Online Store · {s.slug}</span>
                  </span>
                </div>
                <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "12px var(--card-padding)", display: "grid", gap: 7, fontSize: 12 }}>
                  <Row label="Domain" value={s.primaryHostname ?? "Not assigned"} />
                  <Row label="Active release" value={s.activeRelease ? `Release ${s.activeRelease.releaseVersion}` : "Not published"} />
                  <Row label="Draft version" value={s.draftVersion} />
                </div>
                <div style={{ borderTop: "1px solid var(--border-subtle)", padding: "10px var(--card-padding)", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--text-secondary)" }}>
                  <Icon name="history" size={13} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {s.activeRelease ? `Published ${DATE_TIME_FORMAT.format(new Date(s.activeRelease.publishedAt))}` : "No release published yet"}
                  </span>
                  <Icon name="chevron-right" size={14} />
                </div>
              </Card>
            ))}
            <Card padding="none">
              <EmptyState
                icon="plug"
                title={storefronts.length === 0 ? "No sales channels yet" : "More channels"}
                body={storefronts.length === 0 ? "An Online Store is created when the business is provisioned." : "POS, kiosk and marketplace channels are not connected on this platform yet."}
              />
            </Card>
          </Grid>
        )}
      </div>
    </>
  );
}
