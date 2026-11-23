import { ItemEditorScreen } from "../../item-editor";

type PageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function NewInventoryItemPage({ params }: PageProps) {
  const { tenantId } = await params;
  return <ItemEditorScreen tenantId={tenantId} />;
}
