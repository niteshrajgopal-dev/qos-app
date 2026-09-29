"use client";

import { useRouter } from "next/navigation";
import React from "react";

import { useStaffResource } from "@/components/staff/use-staff-resource";
import { Alert, Card, Chip, DataTable, EmptyState, Icon, PageHeader, SearchInput, SkeletonText, StatusBadge, TableToolbar } from "@/design-system";

type TenantLocation = {
  id: string;
  publicId: string;
  name: string;
  slug: string;
  timezone: string;
  status: "active" | "suspended";
};

type StatusFilter = "all" | TenantLocation["status"];

export function LocationsScreen({ tenantId }: { tenantId: string }) {
  const router = useRouter();
  const { data, error, loading } = useStaffResource<{ locations: TenantLocation[] }>(
    `/api/tenants/${tenantId}/staff/locations`,
    "Unable to load locations.",
  );
  const [query, setQuery] = React.useState("");
  const [status, setStatus] = React.useState<StatusFilter>("all");

  const locations = data?.locations ?? [];
  const suspendedCount = locations.filter((l) => l.status === "suspended").length;
  const needle = query.trim().toLowerCase();
  const rows = locations.filter(
    (l) =>
      (status === "all" || l.status === status) &&
      (!needle || l.name.toLowerCase().includes(needle) || l.slug.toLowerCase().includes(needle)),
  );

  return (
    <>
      <PageHeader
        title="Locations"
        subtitle="Branches are the unit of operational control: hours, exceptions and stop-sales all resolve per location."
      />
      <div style={{ marginTop: 20 }}>
        {error ? (
          <Alert tone="error" title="Locations unavailable">{error}</Alert>
        ) : (
          <Card padding="none">
            <TableToolbar>
              <SearchInput placeholder="Search locations" value={query} onChange={(e) => setQuery(e.target.value)} style={{ width: 220 }} />
              <Chip selected={status === "all"} count={locations.length} onClick={() => setStatus("all")}>All</Chip>
              <Chip selected={status === "active"} count={locations.length - suspendedCount} onClick={() => setStatus("active")}>Active</Chip>
              <Chip icon="alert-triangle" selected={status === "suspended"} count={suspendedCount} onClick={() => setStatus("suspended")}>Suspended</Chip>
            </TableToolbar>
            {loading ? (
              <div style={{ padding: "var(--card-padding)" }}><SkeletonText lines={4} /></div>
            ) : rows.length === 0 ? (
              <EmptyState
                icon="map-pin"
                title={locations.length === 0 ? "No locations yet" : "No locations match"}
                body={locations.length === 0 ? "Locations are created when the business is provisioned." : "Try a different search or filter."}
              />
            ) : (
              <DataTable
                columns={[
                  { key: "name", header: "Branch", render: (r: TenantLocation) => <span><strong style={{ fontWeight: 500 }}>{r.name}</strong><span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)" }}>{r.slug}</span></span> },
                  { key: "status", header: "Operational status", render: (r: TenantLocation) => <StatusBadge state={r.status} /> },
                  { key: "timezone", header: "Timezone", render: (r: TenantLocation) => <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>{r.timezone}</span> },
                  { key: "open", header: "", width: 180, render: () => <span style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 6, fontSize: 12, color: "var(--text-secondary)" }}>Hours & availability <Icon name="chevron-right" size={14} /></span> },
                ]}
                rows={rows}
                rowKey="publicId"
                onRowClick={(r) => router.push(`/tenants/${tenantId}/locations/${r.publicId}/availability`)}
              />
            )}
          </Card>
        )}
      </div>
    </>
  );
}
