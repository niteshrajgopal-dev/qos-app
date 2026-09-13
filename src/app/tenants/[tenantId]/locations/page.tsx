"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { staffApiFetch } from "@/lib/staff/dev-fetch";

type LocationSummary = {
  publicId: string;
  name: string;
  slug: string;
};

export default function TenantLocationsPage() {
  const { tenantId } = useParams<{ tenantId: string }>();
  const [locations, setLocations] = useState<LocationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    staffApiFetch(`/api/tenants/${tenantId}/staff/locations`).then(
      async (response) => {
        const payload = (await response.json()) as {
          locations?: LocationSummary[];
          error?: string;
        };

        if (!response.ok) {
          setError(
            payload.error ??
              "Location administration is available to Administrators.",
          );
          return;
        }

        setLocations(payload.locations ?? []);
      },
    );
  }, [tenantId]);

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <div className="qos-pagehead">
        <div>
          <h1 className="qos-pagetitle">Locations</h1>
          <p className="qos-pagesub">
            Branch availability, hours, and stop-sales. A full location editor is
            not part of this slice.
          </p>
        </div>
      </div>
      {error ? (
        <div className="qos-alert" data-tone="warning" role="status">
          <div className="qos-alert-body">{error}</div>
        </div>
      ) : locations.length === 0 ? (
        <div className="qos-empty">
          <div className="qos-empty-title">No locations</div>
          <p className="qos-empty-body">This business has no locations yet.</p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 16,
          }}
        >
          {locations.map((location) => (
            <Link
              key={location.publicId}
              href={`/tenants/${tenantId}/locations/${location.publicId}/availability`}
              className="qos-card"
              data-padding="sm"
              data-interactive="true"
            >
              <strong>{location.name}</strong>
              <p className="qos-card-sub">{location.slug}</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
