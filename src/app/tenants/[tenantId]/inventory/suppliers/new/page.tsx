import { SupplierEditorScreen } from "../../supplier-editor";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewInventorySupplierPage({ params }: PageProps) {
  const { tenantId } = await params;
  return <SupplierEditorScreen tenantId={tenantId} />;
}
