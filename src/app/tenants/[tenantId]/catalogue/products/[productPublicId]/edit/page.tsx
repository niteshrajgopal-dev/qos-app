import { ProductEditor } from "@/app/tenants/[tenantId]/catalogue/products/product-editor";
import { ProductModifierGroupsPanel } from "@/app/tenants/[tenantId]/catalogue/products/product-modifier-groups-panel";
import { ProductVariantsPanel } from "@/app/tenants/[tenantId]/catalogue/products/product-variants-panel";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export default async function EditCatalogueProductPage({ params }: PageProps) {
  const { tenantId, productPublicId } = await params;

  return (
    <StaffScreen
      title="Edit draft product"
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
      <ProductEditor tenantId={tenantId} productPublicId={productPublicId} />
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
