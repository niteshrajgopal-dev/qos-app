"use client";

import { useParams, useRouter } from "next/navigation";

import { OnlineStoreManagement } from "@/app/tenants/[tenantId]/channels/online-store/online-store-management";
import { Breadcrumbs, PageHeader } from "@/design-system";

export default function OnlineStorePage() {
  const params = useParams<{ tenantId: string }>();
  const router = useRouter();

  return (
    <>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[{ id: "channels", label: "Sales Channels" }, { label: "Online Store" }]}
            onNavigate={() => router.push(`/tenants/${params.tenantId}/channels`)}
          />
        }
        title="Online Store"
        subtitle="Theme, content blocks, and immutable storefront releases. Publishing never mutates the live release in place."
      />
      <div style={{ marginTop: 20 }}>
        <OnlineStoreManagement tenantId={params.tenantId} />
      </div>
    </>
  );
}
