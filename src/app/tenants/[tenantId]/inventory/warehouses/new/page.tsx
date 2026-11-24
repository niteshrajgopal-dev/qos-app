import { WarehouseEditorScreen } from "../../warehouse-editor";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewInventoryWarehousePage({ params }: PageProps) {
  const { tenantId } = await params;
  return <WarehouseEditorScreen tenantId={tenantId} />;
}
