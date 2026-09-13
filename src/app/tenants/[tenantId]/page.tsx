"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";

import { TenantHome } from "@/app/tenants/[tenantId]/tenant-home";
import type { ActiveStaffMembershipSummary } from "@/lib/staff/memberships";
import { fetchStaffSession } from "@/lib/staff/staff-session-client";

export default function TenantHomePage() {
  const params = useParams<{ tenantId: string }>();
  const tenantId = params.tenantId;
  const [membership, setMembership] =
    useState<ActiveStaffMembershipSummary | null>(null);

  useEffect(() => {
    fetchStaffSession().then((result) => {
      if (!result.ok) {
        return;
      }
      setMembership(
        result.data.memberships.find((entry) => entry.tenantId === tenantId) ??
          null,
      );
    });
  }, [tenantId]);

  return <TenantHome tenantId={tenantId} membership={membership} />;
}
