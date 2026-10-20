"use client";

import { useEffect, useState } from "react";

import { MenuExtractionReview } from "@/app/tenants/[tenantId]/catalogue/menu-extraction/menu-extraction-review";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default function MenuExtractionPage({ params }: PageProps) {
  const { locale } = useStaffLocale();
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ tenantId: resolvedTenantId }) => {
      setTenantId(resolvedTenantId);
    });
  }, [params]);

  if (!tenantId) {
    return null;
  }

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <MenuExtractionReview tenantId={tenantId} uiLocale={locale} />
    </div>
  );
}
