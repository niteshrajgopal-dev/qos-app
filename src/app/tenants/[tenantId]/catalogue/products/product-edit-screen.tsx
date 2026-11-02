"use client";

import { useEffect, useState } from "react";

import { ProductEditor } from "@/app/tenants/[tenantId]/catalogue/products/product-editor";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";
import { useStaffLocale } from "@/components/staff/StaffLocaleProvider";
import {
  productEditorPageTitle,
  type CatalogueProductEditorStatus,
} from "@/lib/catalogue/product-editor-copy";
import { staffApiFetch } from "@/lib/staff/dev-fetch";
import { staffUiCopy } from "@/lib/staff/locale";

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
            {staffUiCopy(locale, "productEditorTranslationReview")}
          </ButtonLink>
          <ButtonLink
            href={`/tenants/${tenantId}/catalogue/products/${productPublicId}/location-prices`}
            variant="secondary"
            size="sm"
          >
            {staffUiCopy(locale, "productEditorLocationPrices")}
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
    </StaffScreen>
  );
}
