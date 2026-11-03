"use client";

import { ProductEditor } from "@/app/tenants/[tenantId]/catalogue/products/product-editor";
import {
  PortalArea,
  PortalPageHeader,
} from "@/components/portal/workspace/PortalWorkspace";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import { staffUiCopy } from "@/lib/staff/locale";

type ProductNewScreenProps = {
  tenantId: string;
  businessProfile: "hospitality" | "generic_retail";
};

export function ProductNewScreen({ tenantId, businessProfile }: ProductNewScreenProps) {
  const { locale } = useStaffLocale();

  return (
    <PortalArea>
      <PortalPageHeader
        back={{
          href: `/tenants/${tenantId}/catalogue`,
          label: staffUiCopy(locale, "catalogue"),
        }}
        title={staffUiCopy(locale, "newDraftProductTitle")}
        description={staffUiCopy(locale, "newDraftProductSubtitle")}
      />
      <ProductEditor tenantId={tenantId} initialBusinessProfile={businessProfile} />
    </PortalArea>
  );
}
