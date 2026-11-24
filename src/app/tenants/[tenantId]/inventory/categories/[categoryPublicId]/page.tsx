import { CategoryEditorScreen } from "../../category-editor";

type PageProps = {
  params: Promise<{ tenantId: string; categoryPublicId: string }>;
};

export default async function InventoryCategoryPage({ params }: PageProps) {
  const { tenantId, categoryPublicId } = await params;
  return <CategoryEditorScreen tenantId={tenantId} categoryPublicId={categoryPublicId} />;
}
