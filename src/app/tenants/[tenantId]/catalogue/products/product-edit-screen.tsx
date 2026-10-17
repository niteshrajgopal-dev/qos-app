"use client";

import { useState } from "react";

import { ProductEditor } from "@/app/tenants/[tenantId]/catalogue/products/product-editor";
import { ProductModifierGroupsPanel } from "@/app/tenants/[tenantId]/catalogue/products/product-modifier-groups-panel";
import { ProductVariantsPanel } from "@/app/tenants/[tenantId]/catalogue/products/product-variants-panel";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";
import {
  productEditorPageTitle,
  type CatalogueProductEditorStatus,
} from "@/lib/catalogue/product-editor-copy";
import { readStoredStaffLocale } from "@/lib/staff/locale";

type ProductEditScreenProps = {
  tenantId: string;
  productPublicId: string;
};

export function ProductEditScreen({
  tenantId,
  productPublicId,
}: ProductEditScreenProps) {
  const locale = readStoredStaffLocale();
  const [status, setStatus] = useState<CatalogueProductEditorStatus>(null);

  return (
    <StaffScreen
      title={productEditorPageTitle(status, locale)}
      subtitle={productPublicId}
      actions={
        <>
          <ButtonLink
            href={`/tenants/${tenantId}/catalogue/products/${productPublicId}/translations`}
            variant="secondary"
            size="sm"
          >
            Translation review
          </ButtonLink>
          <ButtonLink
            href={`/tenants/${tenantId}/catalogue/products/${productPublicId}/location-prices`}
            variant="secondary"
            size="sm"
          >
            Location prices
          </ButtonLink>
        </>
      }
    >
      <ProductEditor
        tenantId={tenantId}
        productPublicId={productPublicId}
        onStatusChange={setStatus}
      />
      <ProductVariantsPanel
        tenantId={tenantId}
        productPublicId={productPublicId}
      />
      <ProductModifierGroupsPanel
        tenantId={tenantId}
        productPublicId={productPublicId}
      />
    </StaffScreen>
  );
}
