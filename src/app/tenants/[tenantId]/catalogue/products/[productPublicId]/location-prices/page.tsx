import { LocationPriceOverrides } from "@/app/tenants/[tenantId]/catalogue/products/[productPublicId]/location-prices/location-price-overrides";
import { ButtonLink } from "@/components/ButtonLink";
import { StaffScreen } from "@/components/staff/StaffScreen";

type PageProps = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export default async function ProductLocationPricesPage({ params }: PageProps) {
  const { tenantId, productPublicId } = await params;

  return (
    <StaffScreen
      title="Location prices"
      subtitle={`Inherited and overridden branch prices for ${productPublicId}.`}
      actions={
        <ButtonLink
          href={`/tenants/${tenantId}/catalogue/products/${productPublicId}/edit`}
          variant="ghost"
        >
          Back to product
        </ButtonLink>
      }
    >
      <LocationPriceOverrides
        tenantId={tenantId}
        productPublicId={productPublicId}
      />
    </StaffScreen>
  );
}
