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

  return (
    <div style={{ display: "grid", gap: "var(--space-6)" }}>
      <div className="qos-pagehead">
        <div>
          <h1 className="qos-pagetitle">Catalogue import</h1>
          <p className="qos-pagesub">
            Preview a file, then apply it. Nothing is written until you confirm.
          </p>
        </div>
      </div>
      <CatalogueImportPanel tenantId={tenantId} />
    </div>
  );
}
