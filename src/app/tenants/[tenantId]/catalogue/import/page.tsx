"use client";

import { useEffect, useState } from "react";

import {
  PortalArea,
  PortalFilterTabs,
  PortalPageHeader,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { CatalogueImportPanel } from "@/app/tenants/[tenantId]/catalogue/import/catalogue-import-panel";
import { WorkbookImportPanel } from "@/app/tenants/[tenantId]/catalogue/import/workbook-import-panel";
import { staffUiCopy } from "@/lib/staff/locale";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

type ImportProfile = "current" | "workbook";

export default function CatalogueImportPage({ params }: PageProps) {
  const { locale } = useStaffLocale();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [profile, setProfile] = useState<ImportProfile>("current");

  useEffect(() => {
    void params.then(({ tenantId: resolvedTenantId }) => {
      setTenantId(resolvedTenantId);
    });
  }, [params]);

  if (!tenantId) {
    return null;
  }

  return (
    <PortalArea>
      <PortalPageHeader
        title={staffUiCopy(locale, "importTitle")}
        description={staffUiCopy(locale, "importDescription")}
      />
      <div className="qosp-stack">
        <PortalFilterTabs
          label={staffUiCopy(locale, "importProfileLabel")}
          tabs={[
            { id: "current", label: staffUiCopy(locale, "importProfileCurrent") },
            { id: "workbook", label: staffUiCopy(locale, "importProfileWorkbook") },
          ]}
          value={profile}
          onChange={(id) => setProfile(id as ImportProfile)}
          controls="catalogue-import-profile"
        />
        <div id="catalogue-import-profile">
          {profile === "current" ? (
            <CatalogueImportPanel tenantId={tenantId} />
          ) : (
            <WorkbookImportPanel tenantId={tenantId} onUseCurrentProfile={() => setProfile("current")} />
          )}
        </div>
      </div>
    </PortalArea>
  );
}
