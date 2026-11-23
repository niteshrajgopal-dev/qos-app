import { ItemEditorScreen } from "../../item-editor";

type PageProps = {
  params: Promise<{ tenantId: string; itemPublicId: string }>;
};

export default async function InventoryItemPage({ params }: PageProps) {
  const { tenantId, itemPublicId } = await params;
  return <ItemEditorScreen tenantId={tenantId} itemPublicId={itemPublicId} />;
}
