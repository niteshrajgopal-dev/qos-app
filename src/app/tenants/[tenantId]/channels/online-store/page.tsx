"use client";

import { useParams } from "next/navigation";

import { OnlineStoreManagement } from "@/app/tenants/[tenantId]/channels/online-store/online-store-management";

export default function OnlineStorePage() {
  const params = useParams<{ tenantId: string }>();

  return <OnlineStoreManagement tenantId={params.tenantId} />;
}
