"use client";

import { PortalOverview } from "@/components/portal/PortalOverview";
import { PortalScene } from "@/components/portal/PortalScene";
import { PortalTopBar } from "@/components/portal/PortalTopBar";
import type { TenantOverview, TenantOverviewBranch } from "@/lib/staff/overview";

const FIXTURE_OVERVIEW: TenantOverview = {
  currency: "AED",
  timezone: "Asia/Dubai",
  payments: {
    capturedToday: 42,
    revenueMinorToday: 2486000,
    succeeded: 48,
    attempts: 50,
    captureRate: 96,
  },
  menus: { total: 2, live: 2 },
  locations: { total: 3, active: 3 },
  storefronts: { total: 2, live: 1 },
  products: { total: 152 },
  activity: [],
};

const FIXTURE_BRANCHES: TenantOverviewBranch[] = [
  {
    publicId: "loc_hbz",
    name: "HBZ Stadium",
    timezone: "Asia/Dubai",
    status: "active",
  },
];

/** Static overview shell for layout measurement (Playwright / local QA). */
export default function OverviewLayoutHarnessPage() {
  return (
    <div className="qosp-app" data-portal-surface="overview">
      <PortalScene motion={false} />
      <PortalTopBar
        tenantId="harness-tenant"
        tenantName="Quotes"
        tenants={[{ id: "harness-tenant", name: "Quotes" }]}
        activeId="home"
        personName="Staff Demo"
        roleLabel="Administrator"
        locale="en"
        onToggleLocale={() => undefined}
        onOpenSearch={() => undefined}
        onSelectTenant={() => undefined}
        onSignOut={() => undefined}
      />
      <PortalOverview
        tenantId="harness-tenant"
        tenantName="Quotes"
        personName="Staff Demo"
        motion={false}
        onToggleMotion={() => undefined}
        layoutPreview={{
          overview: FIXTURE_OVERVIEW,
          branches: FIXTURE_BRANCHES,
        }}
      />
    </div>
  );
}
