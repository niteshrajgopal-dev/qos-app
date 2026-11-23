import { SupplierEditorScreen } from "../../supplier-editor";

type PageProps = {
  params: Promise<{ tenantId: string; supplierPublicId: string }>;
};

export default async function InventorySupplierPage({ params }: PageProps) {
  const { tenantId, supplierPublicId } = await params;
  return <SupplierEditorScreen tenantId={tenantId} supplierPublicId={supplierPublicId} />;
}
