"use client";

import { useParams, useRouter } from "next/navigation";

import { HomeScreen } from "@/components/platform/home-screen";
import { staffNavHref } from "@/lib/staff/nav";

export default function TenantHomePage() {
  const params = useParams<{ tenantId: string }>();
  const router = useRouter();

  return (
    <HomeScreen
      onNavigate={(id: string) => {
        const href = staffNavHref(params.tenantId, id);
        if (href) router.push(href);
      }}
    />
  );
}
