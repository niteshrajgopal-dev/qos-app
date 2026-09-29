"use client";

import { PortalOverview } from "@/components/portal/PortalOverview";
import { usePortalShell } from "@/components/portal/portal-shell-context";

export default function TenantOverviewPage() {
  const { tenantId, tenantName, personName, motion, toggleMotion } = usePortalShell();

  return (
    <PortalOverview
      tenantId={tenantId}
      tenantName={tenantName}
      personName={personName}
      motion={motion}
      onToggleMotion={toggleMotion}
    />
  );
}
