import { ProductEditor } from "@/app/tenants/[tenantId]/catalogue/products/product-editor";
import { StaffScreen } from "@/components/staff/StaffScreen";
import { db } from "@/db";
import { findTenantById } from "@/lib/tenant/repository";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewCatalogueProductPage({ params }: PageProps) {
  const { tenantId } = await params;
  const tenant = await findTenantById(db, tenantId);

  return (
    <StaffScreen
      title="New draft product"
      subtitle="Create bilingual EN and AR copy. Both translations must be approved before the item can go live."
    >
      <ProductEditor
        tenantId={tenantId}
        initialBusinessProfile={tenant?.businessProfile ?? "generic_retail"}
      />
    </StaffScreen>
  );
}
