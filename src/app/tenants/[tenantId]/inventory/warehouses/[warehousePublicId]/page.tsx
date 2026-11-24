import { WarehouseEditorScreen } from "../../warehouse-editor";

type PageProps = {
  params: Promise<{ tenantId: string; warehousePublicId: string }>;
};

export default async function InventoryWarehousePage({ params }: PageProps) {
  const { tenantId, warehousePublicId } = await params;
  return <WarehouseEditorScreen tenantId={tenantId} warehousePublicId={warehousePublicId} />;
}
