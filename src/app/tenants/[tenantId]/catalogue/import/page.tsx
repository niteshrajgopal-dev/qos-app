"use client";

import { useEffect, useState } from "react";

import { CatalogueImportPanel } from "@/app/tenants/[tenantId]/catalogue/import/catalogue-import-panel";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default function CatalogueImportPage({ params }: PageProps) {
  const [tenantId, setTenantId] = useState<string | null>(null);

  useEffect(() => {
    void params.then(({ tenantId: resolvedTenantId }) => {
      setTenantId(resolvedTenantId);
    });
  }, [params]);

  if (!tenantId) {
    return null;
  }

  return <CatalogueImportPanel tenantId={tenantId} />;
}
