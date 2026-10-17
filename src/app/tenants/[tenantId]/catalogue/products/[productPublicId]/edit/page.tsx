import { ProductEditScreen } from "@/app/tenants/[tenantId]/catalogue/products/product-edit-screen";

type PageProps = {
  params: Promise<{ tenantId: string; productPublicId: string }>;
};

export default async function EditCatalogueProductPage({ params }: PageProps) {
  const { tenantId, productPublicId } = await params;

  return (
    <ProductEditScreen tenantId={tenantId} productPublicId={productPublicId} />
  );
}
