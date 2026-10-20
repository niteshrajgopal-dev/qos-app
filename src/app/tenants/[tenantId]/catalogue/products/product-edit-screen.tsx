"use client";

import { useEffect, useState } from "react";

import { ProductEditor } from "@/app/tenants/[tenantId]/catalogue/products/product-editor";
import { ProductModifierGroupsPanel } from "@/app/tenants/[tenantId]/catalogue/products/product-modifier-groups-panel";
import { ProductVariantsPanel } from "@/app/tenants/[tenantId]/catalogue/products/product-variants-panel";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import {
  productEditorPageTitle,
  type CatalogueProductEditorStatus,
} from "@/lib/catalogue/product-editor-copy";
import { staffApiFetch } from "@/lib/staff/dev-fetch";

type ProductEditScreenProps = {
  tenantId: string;
  productPublicId: string;
};

export function ProductEditScreen({
  tenantId,
  productPublicId,
}: ProductEditScreenProps) {
  const { locale } = useStaffLocale();
  const [status, setStatus] = useState<CatalogueProductEditorStatus>(null);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const response = await staffApiFetch(
          `/api/tenants/${tenantId}/catalogue/products/${productPublicId}`,
        );
        const payload = (await response.json()) as {
          product?: { status: CatalogueProductEditorStatus };
        };

        if (cancelled || !response.ok || !payload.product?.status) {
          return;
        }

        setStatus(payload.product.status);
      } catch {
        // Pre-load title falls back to draft-neutral copy when status is unknown.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [productPublicId, tenantId]);

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
        catalogueProductStatusHint={status}
        onStatusChange={setStatus}
      />
      <ProductVariantsPanel
        tenantId={tenantId}
        productPublicId={productPublicId}
        productStatus={status}
      />
      <ProductModifierGroupsPanel
        tenantId={tenantId}
        productPublicId={productPublicId}
        productStatus={status}
      />
    </StaffScreen>
  );
}
