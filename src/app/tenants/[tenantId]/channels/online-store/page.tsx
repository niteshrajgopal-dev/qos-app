"use client";

import { useParams, useRouter } from "next/navigation";

import { OnlineStore } from "@/components/platform/channels-screen";

export default function OnlineStorePage() {
  const params = useParams<{ tenantId: string }>();
  const router = useRouter();

  return (
    <OnlineStore
      onBack={() => router.push(`/tenants/${params.tenantId}/channels`)}
    />
  );
}
