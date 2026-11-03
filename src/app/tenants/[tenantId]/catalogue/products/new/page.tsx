import { ProductNewScreen } from "@/app/tenants/[tenantId]/catalogue/products/product-new-screen";
import { db } from "@/db";
import { findTenantById } from "@/lib/tenant/repository";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewCatalogueProductPage({ params }: PageProps) {
  const { tenantId } = await params;
  const tenant = await findTenantById(db, tenantId);

  return (
    <ProductNewScreen
      tenantId={tenantId}
      businessProfile={tenant?.businessProfile ?? "generic_retail"}
    />
  );
}
